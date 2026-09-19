import type { Profile } from "../core/dashboard";
import { checkpointJob } from "./job-state.server";
import type { ScanJob, Store } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import db from "../db.server";
import { eligible, hash, sourceHash, contentHash } from "../core/content";
import { filterWhere, syncCatalogStep } from "./catalog.server";
import { readSnapshot, saveResource } from "./shopify-api.server";
import { buildKnowledge } from "./knowledge.server";
import {
  optimize,
  observeImages,
  generate,
  PROMPT_VERSION,
} from "./gemini.server";
import { executeApplication } from "./apply.server";
import { syncSearchDay } from "./search-console.server";
const json = (x: unknown) => JSON.parse(JSON.stringify(x));
export async function createJob(
  storeId: string,
  actor: string,
  type = "SCAN",
  filter: unknown = {},
  rule = "UNSCANNED",
  ageDays = 30,
) {
  if (!["SCAN", "SYNC", "KNOWLEDGE", "SEARCH", "AUDIT"].includes(type))
    throw new Error("Unknown job type");
  return db.scanJob.create({
    data: { storeId, actor, type, filter: json(filter), rule, ageDays },
  });
}
export function nextRun(cron: string, timezone: string, now = new Date()) {
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: now })
    .next()
    .toDate();
}
export async function scheduleTick() {
  const now = new Date();
  for (const s of await db.schedule.findMany({
    where: { active: true, nextRun: { lte: now }, store: { active: true } },
    take: 100,
  })) {
    await db.$transaction(async (tx) => {
      const next = s.cron ? nextRun(s.cron, s.timezone, now) : s.nextRun;
      const claimed = await tx.schedule.updateMany({
        where: { id: s.id, nextRun: s.nextRun, active: true },
        data: { nextRun: next, active: !!s.cron },
      });
      if (!claimed.count) return;
      if (
        s.lastJobId &&
        (await tx.scanJob.count({
          where: {
            id: s.lastJobId,
            status: { in: ["QUEUED", "RUNNING", "PAUSED"] },
          },
        }))
      )
        return;
      const job = await tx.scanJob.create({
        data: {
          storeId: s.storeId,
          actor: `schedule:${s.id}`,
          filter: json(s.filter),
          rule: s.rule,
          ageDays: s.ageDays,
        },
      });
      await tx.schedule.update({
        where: { id: s.id },
        data: { lastJobId: job.id },
      });
    });
  }
}
export async function scanStep(job: ScanJob, store: Store) {
  if (
    !job.materialized &&
    (!store.lastSync ||
      (await db.scanJob.count({
        where: {
          storeId: store.id,
          type: "SYNC",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      })))
  ) {
    await checkpointJob({
      where: { id: job.id },
      data: {
        error:
          "Waiting for catalog sync to complete before selecting scan items",
      },
    });
    return;
  }
  const knowledge = await db.knowledge.findFirst({
    where: { storeId: store.id, status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
  });
  if (!knowledge) throw new Error("Approve store knowledge before scanning");
  if (!job.materialized) {
    const cp = job.checkpoint as { cursor?: string; day?: string };
    const resources = await db.resource.findMany({
      where: {
        AND: [
          filterWhere(store.id, job.filter),
          cp.cursor ? { id: { gt: cp.cursor } } : {},
        ],
      },
      orderBy: { id: "asc" },
      take: 500,
    });
    await db.$transaction(async (tx) => {
      await tx.scanItem.createMany({
        data: resources
          .filter((r) => eligible(job.rule, r, job.ageDays, job.createdAt))
          .map((r) => ({ jobId: job.id, resourceId: r.id })),
        skipDuplicates: true,
      });
      await checkpointJob(
        {
          where: { id: job.id },
          data: {
            status: "RUNNING",
            materialized: resources.length < 500,
            error: null,
            checkpoint: { cursor: resources.at(-1)?.id || cp.cursor || "" },
          },
        },
        tx,
      );
    });
    return;
  }
  const item = await db.scanItem.findFirst({
    where: { jobId: job.id, status: { in: ["QUEUED", "RUNNING"] } },
    include: { resource: true },
    orderBy: { id: "asc" },
  });
  if (!item) {
    const failed = await db.scanItem.count({
      where: { jobId: job.id, status: "FAILED" },
    });
    await checkpointJob({
      where: { id: job.id },
      data: { status: failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED" },
    });
    return;
  }
  await db.scanItem.update({
    where: { id: item.id },
    data: { status: "RUNNING", attempts: { increment: 1 }, error: null },
  });
  try {
    const snapshot = await readSnapshot(store.domain, item.resource.gid);
    await saveResource(store.id, snapshot);
    let cp = item.checkpoint as {
      sourceHash?: string;
      images?: Record<string, unknown>;
      collectionDone?: boolean;
      memberCursor?: string;
      collectionSummaries?: string[];
    };
    if (cp.sourceHash !== hash(snapshot)) {
      cp = { sourceHash: hash(snapshot), images: {} };
      await db.scanItem.update({
        where: { id: item.id },
        data: { checkpoint: json(cp) },
      });
    }
    const observations = await observeImages(
      store.id,
      snapshot,
      cp.images || {},
      async (images) => {
        cp = { ...cp, images };
        await db.scanItem.update({
          where: { id: item.id },
          data: { checkpoint: json(cp) },
        });
      },
    );
    if (snapshot.kind === "COLLECTION" && !cp.collectionDone) {
      const members = await db.resource.findMany({
        where: {
          storeId: store.id,
          kind: "PRODUCT",
          deleted: false,
          collectionIds: { has: snapshot.id },
          ...(cp.memberCursor ? { id: { gt: cp.memberCursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (members.length) {
        const summary = await generate(
          store.id,
          "COLLECTION_SUMMARY",
          `Summarize verified product facts and ranges for this collection; preserve exceptions and representative product IDs.\n${JSON.stringify(members.map((m) => ({ id: m.gid, title: m.title, vendor: m.vendor, type: m.productType, tags: m.tags })))}`,
        );
        cp = {
          ...cp,
          collectionSummaries: [...(cp.collectionSummaries || []), summary],
          memberCursor: members.at(-1)!.id,
        };
        if (cp.collectionSummaries!.join("\n").length > 50000)
          cp.collectionSummaries = [
            await generate(
              store.id,
              "COLLECTION_REDUCE",
              `Consolidate these collection evidence summaries; preserve facts and exceptions:\n${cp.collectionSummaries!.join("\n")}`,
            ),
          ];
        await db.scanItem.update({
          where: { id: item.id },
          data: { checkpoint: json(cp), attempts: 0 },
        });
        return;
      }
      cp.collectionDone = true;
    }
    const content = await optimize(
      store.id,
      snapshot,
      knowledge.id,
      store.settings,
      observations,
      (cp.collectionSummaries || []).join("\n"),
    );
    await db.$transaction(async (tx) => {
      const still = await tx.scanJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (still.status === "CANCELED") return;
      await tx.proposal.create({
        data: {
          storeId: store.id,
          resourceId: item.resourceId,
          sourceSnapshot: json(snapshot),
          sourceHash: contentHash(snapshot),
          knowledgeId: knowledge.id,
          promptVersion: PROMPT_VERSION,
          content: json(content),
        },
      });
      if (content.knowledgeSuggestions.length) {
        const profile = knowledge.content as unknown as Profile;
        await tx.knowledge.create({
          data: {
            storeId: store.id,
            baseId: knowledge.id,
            content: {
              ...profile,
              facts: [
                ...profile.facts,
                ...content.knowledgeSuggestions.map((s) => ({
                  claim: s.claim,
                  source: s.source,
                })),
              ],
            },
          },
        });
      }
      await tx.resource.update({
        where: { id: item.resourceId },
        data: { lastScannedAt: new Date(), scannedHash: sourceHash(snapshot) },
      });
      await tx.scanItem.update({
        where: { id: item.id },
        data: { status: "COMPLETED", checkpoint: json(cp) },
      });
    });
  } catch (e) {
    await db.scanItem.update({
      where: { id: item.id },
      data: {
        status: item.attempts >= 2 ? "FAILED" : "QUEUED",
        error: String(e),
      },
    });
  }
}
export async function storeTick(storeId: string) {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store?.active) return;
  const app = await db.application.findFirst({
    where: { storeId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
  });
  if (app) {
    await executeApplication(app.id);
    return;
  }
  // Drain at most one targeted refresh, then give the long-running queue a turn.
  const refresh = await db.scanJob.findFirst({
    where: { storeId, type: "REFRESH", status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
  });
  if (refresh) {
    try {
      await checkpointJob({
        where: { id: refresh.id },
        data: { status: "RUNNING" },
      });
      const gid = (refresh.filter as { gid: string }).gid;
      await saveResource(storeId, await readSnapshot(store.domain, gid));
      await checkpointJob({
        where: { id: refresh.id },
        data: { status: "COMPLETED" },
      });
    } catch (error) {
      await checkpointJob({
        where: { id: refresh.id },
        data: { status: "FAILED", error: String(error) },
      });
    }
  }
  // Reconciliation must also progress while a multi-day scan is running.
  if (
    (!store.lastSync || Date.now() - store.lastSync.getTime() > 86400000) &&
    !(await db.scanJob.count({
      where: {
        storeId,
        type: "SYNC",
        status: { in: ["QUEUED", "RUNNING", "PAUSED"] },
      },
    }))
  )
    await createJob(store.id, "reconcile", "SYNC");
  const sync = await db.scanJob.findFirst({
    where: { storeId, type: "SYNC", status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
  });
  if (sync) {
    try {
      await syncCatalogStep(sync, store);
    } catch (error) {
      await checkpointJob({
        where: { id: sync.id },
        data: { status: "FAILED", error: String(error) },
      });
    }
  }
  let job = await db.scanJob.findFirst({
    where: {
      storeId,
      type: { notIn: ["REFRESH", "SYNC"] },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!job) {
    if (
      store.gscProperty &&
      (!store.lastAnalytics ||
        Date.now() - store.lastAnalytics.getTime() > 86400000)
    )
      job = await createJob(store.id, "scheduler", "SEARCH");
    else return;
  }
  try {
    if (job.type === "REFRESH") {
      const gid = (job.filter as { gid: string }).gid;
      await saveResource(storeId, await readSnapshot(store.domain, gid));
      await checkpointJob({
        where: { id: job.id },
        data: { status: "COMPLETED" },
      });
    } else if (job.type === "SYNC") await syncCatalogStep(job, store);
    else if (job.type === "KNOWLEDGE") {
      await checkpointJob({
        where: { id: job.id },
        data: { status: "RUNNING" },
      });
      await buildKnowledge(storeId);
      await checkpointJob({
        where: { id: job.id },
        data: { status: "COMPLETED" },
      });
    } else if (job.type === "SEARCH") {
      const cp = job.checkpoint as { cursor?: string; day?: string };
      const day =
        cp.day ||
        new Date(Date.now() - (store.lastAnalytics ? 7 : 90) * 86400000)
          .toISOString()
          .slice(0, 10);
      if (
        day >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
      ) {
        await checkpointJob({
          where: { id: job.id },
          data: { status: "COMPLETED" },
        });
        await db.store.update({
          where: { id: storeId },
          data: { lastAnalytics: new Date() },
        });
      } else {
        await syncSearchDay(storeId, day);
        await checkpointJob({
          where: { id: job.id },
          data: {
            status: "RUNNING",
            checkpoint: {
              day: new Date(new Date(day).getTime() + 86400000)
                .toISOString()
                .slice(0, 10),
            },
          },
        });
      }
    } else await scanStep(job, store);
  } catch (e) {
    await checkpointJob({
      where: { id: job.id },
      data: { status: "FAILED", error: String(e) },
    });
  }
}
