import {
  keywordDashboard,
  saveIntentProposal,
  rejectIntentProposal,
} from "./keyword-dashboard.server";
import { decideOverlap } from "./keywords.server";
import { performanceComparisons } from "./analytics.server";
import type { DashboardData } from "../core/dashboard";
import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { tenant, audit } from "./tenant.server";
import { filterWhere } from "./catalog.server";
import { createJob, nextRun } from "./jobs.server";
import { approveProposal, requestRestore } from "./apply.server";
import { approveKnowledge, rebaseKnowledge } from "./knowledge.server";
import {
  properties,
  chooseProperty,
  googleConnect,
} from "./search-console.server";
import { schemaAudit } from "./schema-audit.server";
import { readSnapshot } from "./shopify-api.server";
import { settingsSchema, contentHash } from "../core/content";
const filterSchema = z.object({
  kind: z.enum(["PRODUCT", "COLLECTION"]).optional(),
  q: z.string().max(200).optional(),
  vendor: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  collection: z.string().max(200).optional(),
  status: z.string().max(30).optional(),
  productType: z.string().max(200).optional(),
  optimization: z.enum(["", "UNSCANNED", "SCANNED"]).optional(),
  ids: z.array(z.string()).max(100).optional(),
  after: z.string().optional(),
});
const rule = z.enum(["UNSCANNED", "CHANGED", "AGED", "ALL"]),
  days = z.coerce.number().int().min(1).max(3650);
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
function filters(url: URL, kind?: string) {
  return filterSchema.parse({
    ...Object.fromEntries(
      [...url.searchParams].filter(([k]) =>
        [
          "kind",
          "q",
          "vendor",
          "tag",
          "collection",
          "status",
          "productType",
          "optimization",
          "after",
        ].includes(k),
      ),
    ),
    ...(kind ? { kind } : {}),
  });
}
export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<DashboardData> {
  const { store } = await tenant(request);
  const page = params.page || "overview",
    url = new URL(request.url),
    selected = url.searchParams.get("id"),
    offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const data: Record<string, unknown> = {
    page,
    store: {
      domain: store.domain,
      website: store.website,
      timezone: store.timezone,
      settings: store.settings,
      connected: !!store.gscToken,
      property: store.gscProperty,
      lastSync: store.lastSync,
    },
    offset,
    filter: {},
  };
  if (page === "overview") {
    data.counts = await Promise.all([
      db.resource.count({
        where: { storeId: store.id, deleted: false, kind: "PRODUCT" },
      }),
      db.resource.count({
        where: { storeId: store.id, deleted: false, kind: "COLLECTION" },
      }),
      db.proposal.count({ where: { storeId: store.id, status: "PENDING" } }),
      db.scanJob.count({
        where: { storeId: store.id, status: { in: ["QUEUED", "RUNNING"] } },
      }),
    ]);
    data.usage = await db.usage.aggregate({
      where: { storeId: store.id },
      _sum: {
        input: true,
        output: true,
        thinking: true,
        cached: true,
        estimatedUsd: true,
        searches: true,
      },
    });
    data.knowledge = await db.knowledge.findFirst({
      where: { storeId: store.id, status: "APPROVED" },
      orderBy: { approvedAt: "desc" },
      select: { id: true },
    });
    data.recent = await db.audit.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  } else if (["products", "collections"].includes(page)) {
    const filter = filters(url, page === "products" ? "PRODUCT" : "COLLECTION");
    data.filter = filter;
    const where = filterWhere(store.id, filter);
    data.total = await db.resource.count({ where });
    data.rows = await db.resource.findMany({
      where,
      orderBy: { id: "asc" },
      skip: offset,
      take: 25,
      select: {
        id: true,
        gid: true,
        title: true,
        handle: true,
        vendor: true,
        status: true,
        lastScannedAt: true,
        _count: { select: { proposals: true } },
      },
    });
  } else if (page === "keywords") {
    data.keywordMap = await keywordDashboard(store.id, url);
  } else if (page === "knowledge") {
    data.rows = await db.knowledge.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    data.sources = await db.source.findMany({
      where: { storeId: store.id },
      select: { url: true, fetchedAt: true },
      take: 100,
    });
  } else if (page === "review") {
    data.rows = await db.proposal.findMany({
      where: { storeId: store.id },
      include: { resource: { select: { title: true, kind: true } } },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: 25,
    });
    if (selected) {
      const proposal = await db.proposal.findFirstOrThrow({
        where: { id: selected, storeId: store.id },
        include: { resource: true },
      });
      data.selected = proposal;
      const current = await readSnapshot(store.domain, proposal.resource.gid);
      data.current = current;
      data.currentHash = contentHash(current);
    }
  } else if (page === "jobs") {
    data.rows = await db.scanJob.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { items: true } } },
    });
    data.schedules = await db.schedule.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
    });
    if (selected) {
      await db.scanJob.findFirstOrThrow({
        where: { id: selected, storeId: store.id },
      });
      data.items = await db.scanItem.findMany({
        where: { jobId: selected },
        include: { resource: { select: { title: true } } },
        orderBy: { id: "asc" },
        skip: offset,
        take: 50,
      });
      data.itemCounts = await db.scanItem.groupBy({
        by: ["status"],
        where: { jobId: selected },
        _count: true,
      });
    }
    data.filter = filters(url);
  } else if (page === "history")
    data.rows = await db.application.findMany({
      where: { storeId: store.id },
      include: { resource: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: 25,
    });
  else if (page === "performance") {
    data.comparison = await performanceComparisons(store.id, store.website);
    data.cutoff = new Date(Date.now() - 28 * 86400000)
      .toISOString()
      .slice(0, 10);
    const since = new Date(Date.now() - 56 * 86400000)
      .toISOString()
      .slice(0, 10);
    data.daily = await db.searchMetric.groupBy({
      by: ["date"],
      where: { storeId: store.id, date: { gte: since } },
      _sum: { clicks: true, impressions: true },
      orderBy: { date: "desc" },
    });
    data.rows = await db.searchMetric.findMany({
      where: { storeId: store.id },
      orderBy: { date: "desc" },
      take: 100,
    });
    data.events = await db.application.findMany({
      where: { storeId: store.id, status: "APPLIED" },
      include: { resource: { select: { title: true } } },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
  } else if (page === "settings")
    data.properties = store.gscToken
      ? await properties(store.id).catch(() => [])
      : [];
  else throw new Response("Not found", { status: 404 });
  return json(data);
}
export async function action({ request }: ActionFunctionArgs) {
  const { store, actor } = await tenant(request);
  const form = await request.formData(),
    intent = String(form.get("intent") || ""),
    id = String(form.get("id") || "");
  try {
    if (["sync", "research", "searchSync"].includes(intent))
      await createJob(
        store.id,
        actor,
        intent === "sync"
          ? "SYNC"
          : intent === "research"
            ? "KNOWLEDGE"
            : "SEARCH",
      );
    else if (intent === "scan") {
      const filter = filterSchema.parse(
        JSON.parse(String(form.get("filter") || "{}")),
      );
      if (form.get("selection") === "selected") {
        filter.ids = z
          .array(z.string())
          .min(1)
          .max(100)
          .parse(form.getAll("selected"));
      }
      await createJob(
        store.id,
        actor,
        "SCAN",
        filter,
        rule.parse(form.get("rule")),
        days.parse(form.get("ageDays") || 30),
      );
    } else if (intent === "knowledgeApprove")
      await approveKnowledge(
        store.id,
        id,
        JSON.parse(String(form.get("content"))),
        actor,
      );
    else if (intent === "knowledgeRebase") await rebaseKnowledge(store.id, id);
    else if (intent === "knowledgeReject")
      await db.knowledge.updateMany({
        where: { id, storeId: store.id, status: "PENDING" },
        data: { status: "REJECTED" },
      });
    else if (intent === "keywordIndex")
      await createJob(store.id, actor, "KEYWORDS");
    else if (intent === "keywordDecision")
      await decideOverlap(
        store.id,
        actor,
        id,
        String(form.get("otherId")),
        String(form.get("pairKey")),
        String(form.get("decision")),
        String(form.get("reason")),
      );
    else if (intent === "recheckProposal") {
      await db.proposal.findFirstOrThrow({
        where: {
          id,
          storeId: store.id,
          status: { in: ["PENDING", "CONFLICT"] },
        },
      });
      await createJob(store.id, actor, "RECHECK", { proposalId: id });
    } else if (intent === "saveProposal") {
      await saveIntentProposal(
        store.id,
        id,
        Number(form.get("revision")),
        JSON.parse(String(form.get("content"))),
        form.get("researchPlan")
          ? JSON.parse(String(form.get("researchPlan")))
          : null,
        actor,
      );
    } else if (intent === "approve" || intent === "forceApprove") {
      const p = await db.proposal.findFirstOrThrow({
        where: { id, storeId: store.id },
        include: { resource: true },
      });
      if (p.revision !== Number(form.get("revision")))
        throw Error("Proposal revision changed; refresh before approving");
      if (intent === "forceApprove") {
        const live = await readSnapshot(store.domain, p.resource.gid);
        if (contentHash(live) !== form.get("currentHash"))
          throw Error(
            "Store changed again; refresh comparison before overwriting",
          );
      }
      await approveProposal(
        store.id,
        id,
        actor,
        intent === "forceApprove",
        Number(form.get("revision")),
        String(form.get("currentHash") || ""),
      );
    } else if (intent === "approveMany") {
      const ids = z
        .array(z.string())
        .min(1)
        .max(25)
        .parse(form.getAll("selected"));
      const results = [];
      for (const pid of ids) {
        try {
          const [id, rev] = pid.split("|");
          const p = await db.proposal.findFirstOrThrow({
            where: { id, storeId: store.id },
          });
          if (p.revision !== Number(rev)) throw Error("Revision changed");
          await approveProposal(store.id, id, actor, false, Number(rev));
          results.push(`${id}: queued`);
        } catch (e) {
          results.push(`${pid}: ${String(e)}`);
        }
      }
      return { ok: true, message: results.join("\n") };
    } else if (intent === "reject")
      await rejectIntentProposal(store.id, id, actor);
    else if (intent === "restore") await requestRestore(store.id, id, actor);
    else if (intent === "retryApply")
      await db.application.updateMany({
        where: { id, storeId: store.id, status: { in: ["FAILED", "PARTIAL"] } },
        data: { status: "QUEUED", error: null },
      });
    else if (["pause", "resume", "cancel", "retryJob"].includes(intent)) {
      const job = await db.scanJob.findFirstOrThrow({
        where: { id, storeId: store.id },
      });
      if (intent === "retryJob")
        await db.scanItem.updateMany({
          where: { jobId: id, status: "FAILED" },
          data: { status: "QUEUED", attempts: 0, error: null },
        });
      const allowed =
        intent === "pause"
          ? ["QUEUED", "RUNNING"]
          : intent === "cancel"
            ? ["QUEUED", "RUNNING", "PAUSED"]
            : intent === "resume"
              ? ["PAUSED"]
              : ["FAILED", "COMPLETED_WITH_ERRORS"];
      if (!allowed.includes(job.status))
        throw Error("This action is not available for the current job state");
      await db.scanJob.update({
        where: { id },
        data: {
          status:
            intent === "pause"
              ? "PAUSED"
              : intent === "cancel"
                ? "CANCELED"
                : "QUEUED",
          error: null,
        },
      });
    } else if (intent === "schedule") {
      const timezone = String(form.get("timezone") || store.timezone);
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      const frequency = z
        .enum(["once", "daily", "weekly", "monthly", "continuous"])
        .parse(form.get("frequency"));
      const hour = z.coerce
          .number()
          .int()
          .min(0)
          .max(23)
          .parse(form.get("hour")),
        day = z.coerce
          .number()
          .int()
          .min(1)
          .max(28)
          .parse(form.get("day") || 1),
        weekday = z.coerce
          .number()
          .int()
          .min(0)
          .max(6)
          .parse(form.get("weekday") || 1);
      const cron = ["daily", "continuous"].includes(frequency)
        ? `0 ${hour} * * *`
        : frequency === "weekly"
          ? `0 ${hour} * * ${weekday}`
          : frequency === "monthly"
            ? `0 ${hour} ${day} * *`
            : null;
      const run = cron
        ? nextRun(cron, timezone)
        : new Date(String(form.get("once")));
      if (!Number.isFinite(run.getTime()) || run <= new Date())
        throw Error("Choose a future date/time, including a timezone offset");
      await db.schedule.create({
        data: {
          storeId: store.id,
          name: String(form.get("name") || frequency).slice(0, 120),
          cron,
          timezone,
          filter: json(
            filterSchema.parse(JSON.parse(String(form.get("filter") || "{}"))),
          ),
          rule: rule.parse(form.get("rule")),
          ageDays: days.parse(form.get("ageDays") || 30),
          nextRun: run,
        },
      });
    } else if (intent === "toggleSchedule") {
      const s = await db.schedule.findFirstOrThrow({
        where: { id, storeId: store.id },
      });
      if (!s.active && !s.cron && s.nextRun <= new Date())
        throw Error("Create a new future one-time schedule");
      await db.schedule.update({
        where: { id },
        data: {
          active: !s.active,
          ...(!s.active && s.cron
            ? { nextRun: nextRun(s.cron, s.timezone) }
            : {}),
        },
      });
    } else if (intent === "settings") {
      const settings = settingsSchema.parse(
        JSON.parse(String(form.get("content"))),
      );
      await db.store.update({
        where: { id: store.id },
        data: {
          settings: { ...(store.settings as Prisma.JsonObject), ...settings },
        },
      });
    } else if (intent === "googleConnect")
      return {
        ok: true,
        message: "Continue to Google to connect this store.",
        connectUrl: await googleConnect(store.id),
      };
    else if (intent === "property")
      await chooseProperty(store.id, String(form.get("property")));
    else if (intent === "disconnectGoogle")
      await db.store.update({
        where: { id: store.id },
        data: { gscToken: null, gscProperty: null },
      });
    else if (intent === "schemaAudit") {
      const result = await schemaAudit(store.id);
      await db.store.update({
        where: { id: store.id },
        data: {
          settings: {
            ...(store.settings as Prisma.JsonObject),
            schemaAudit: json(result),
          },
        },
      });
    } else throw Error("Unknown action");
    await audit(
      store.id,
      actor,
      `ACTION_${intent.toUpperCase()}`,
      id || undefined,
    );
    return {
      ok: true,
      message:
        "Saved. Background jobs continue while this dashboard is closed.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
