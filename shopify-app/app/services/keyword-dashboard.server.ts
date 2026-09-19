import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { overlapPage, visibleStates, lockMap } from "./keywords.server";
import {
  keywordKeys,
  evidenceLevel,
  normalizeKeyword,
  validateResearch,
} from "../core/keywords";
import {
  INTENT_RESEARCH_VERSION,
  researchFingerprint,
  type ResearchRecord,
} from "./intent-research.server";
import { validateContent, type Snapshot } from "../core/content";

export function keywordFilter(
  storeId: string,
  url: URL,
): Prisma.KeywordTargetWhereInput {
  const q = (url.searchParams.get("q") || "").slice(0, 200);
  const state = url.searchParams.get("state") || "";
  const market = url.searchParams.get("market") || "";
  return {
    storeId,
    resource: { deleted: false },
    state:
      state && [...visibleStates, "ARCHIVED", "REJECTED"].includes(state)
        ? state
        : { in: visibleStates },
    ...(market ? { market } : {}),
    ...(q
      ? {
          OR: [
            { primary: { contains: q, mode: "insensitive" } },
            { cluster: { contains: q, mode: "insensitive" } },
            { resource: { title: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}
export async function keywordDashboard(storeId: string, url: URL) {
  const where = keywordFilter(storeId, url);
  const offset = Math.max(
    0,
    Math.floor(Number(url.searchParams.get("offset")) || 0),
  );
  const rows = await db.keywordTarget.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: offset,
    take: 25,
    include: {
      resource: { select: { title: true, kind: true, handle: true } },
    },
  });
  const checks = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      result: visibleStates.includes(row.state)
        ? await overlapPage(db, row, undefined, 25)
        : { matches: [], nextCursor: null },
    })),
  );
  const selected = url.searchParams.get("id");
  const detail = selected
    ? await db.keywordTarget.findFirst({
        where: { id: selected, storeId },
        include: {
          resource: { select: { title: true, kind: true, handle: true } },
        },
      })
    : null;
  const conflictPage =
    detail && visibleStates.includes(detail.state)
      ? await overlapPage(
          db,
          detail,
          url.searchParams.get("peerAfter") || undefined,
        )
      : { matches: [], nextCursor: null };
  const conflicts = conflictPage.matches;
  const decisions = detail
    ? await db.keywordDecision.findMany({
        where: { storeId, OR: [{ leftId: detail.id }, { rightId: detail.id }] },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  const total = await db.keywordTarget.count({ where });
  const resources = await db.resource.count({
    where: { storeId, deleted: false },
  });
  const indexed = await db.resource.count({
    where: {
      storeId,
      deleted: false,
      keywordTargets: {
        some: {
          state: { in: visibleStates },
          ...(url.searchParams.get("market")
            ? { market: url.searchParams.get("market")! }
            : {}),
        },
      },
    },
  });
  const queries = await db.queryMetric.findMany({
    where: { storeId },
    orderBy: [{ date: "desc" }, { clicks: "desc" }],
    take: 20,
  });
  return {
    rows: rows.map((row) => ({
      ...row,
      overlapsTruncated: !!checks.find((c) => c.id === row.id)!.result
        .nextCursor,
      overlaps: checks.find((c) => c.id === row.id)!.result.matches.length,
      blocking: checks
        .find((c) => c.id === row.id)!
        .result.matches.filter((c) => c.blocking && !c.decision).length,
    })),
    detail,
    conflicts,
    nextPeer: conflictPage.nextCursor,
    decisions,
    queries,
    total,
    resources,
    indexed,
    q: url.searchParams.get("q") || "",
    state: url.searchParams.get("state") || "",
    market: url.searchParams.get("market") || "",
  };
}

export async function saveIntentProposal(
  storeId: string,
  id: string,
  revision: number,
  rawContent: unknown,
  rawPlan: unknown,
  actor: string,
) {
  await db.$transaction(async (tx) => {
    await lockMap(tx, storeId);
    const p = await tx.proposal.findFirstOrThrow({
      where: { id, storeId, revision, status: { in: ["PENDING", "CONFLICT"] } },
      include: { store: true },
    });
    if (
      await tx.application.count({
        where: {
          storeId,
          proposalId: id,
          status: { in: ["QUEUED", "RUNNING", "PARTIAL", "FAILED"] },
        },
      })
    )
      throw Error(
        "Finish or resolve the existing application before editing this proposal",
      );
    const content = validateContent(
      rawContent,
      p.sourceSnapshot as unknown as Snapshot,
      p.store.settings,
    );
    let record = p.research as unknown as ResearchRecord | null;
    if (record && rawPlan) {
      record = {
        ...record,
        plan: validateResearch(
          rawPlan,
          record.evidence,
          record.version === INTENT_RESEARCH_VERSION,
        ),
      };
      // A human edit does not manufacture external demand evidence.
      const primary = record.plan.candidates.find(
        (c) =>
          normalizeKeyword(c.keyword) ===
          normalizeKeyword(record!.plan.primary),
      )!;
      record.evidenceLevel = evidenceLevel(primary, record.evidence);
    }
    const json = (x: unknown) => JSON.parse(JSON.stringify(x));
    await tx.proposal.update({
      where: { id },
      data: {
        content: json(content),
        ...(record
          ? {
              research: json(record),
              qa: { status: "STALE", issues: [], fingerprint: "" },
            }
          : {}),
        revision: { increment: 1 },
      },
    });
    if (record)
      await tx.keywordTarget.updateMany({
        where: { storeId, proposalId: id },
        data: {
          primary: record.plan.primary,
          secondary: record.plan.secondary,
          cluster: record.plan.cluster,
          clusterKey: normalizeKeyword(record.plan.cluster),
          keys: keywordKeys(record.plan.primary, record.plan.secondary),
          buyerNeed: record.plan.buyerNeed,
          rationale: record.plan.rationale,
          intent: record.plan.intent,
          evidenceLevel: record.evidenceLevel,
          contentFingerprint: researchFingerprint(content, record),
          state: "PROPOSED",
        },
      });
    await tx.audit.create({
      data: {
        storeId,
        actor,
        event: "PROPOSAL_EDITED",
        target: id,
        detail: { revision: revision + 1, qaInvalidated: !!record },
      },
    });
  });
}

export async function rejectIntentProposal(
  storeId: string,
  id: string,
  actor: string,
) {
  await db.$transaction(async (tx) => {
    await lockMap(tx, storeId);
    const changed = await tx.proposal.updateMany({
      where: { id, storeId, status: { in: ["PENDING", "CONFLICT"] } },
      data: { status: "REJECTED" },
    });
    if (!changed.count)
      throw Error("Proposal changed; refresh before rejecting");
    // An in-flight/partially applied version cannot be silently discarded.
    if (
      await tx.application.count({
        where: {
          storeId,
          proposalId: id,
          status: { in: ["QUEUED", "RUNNING", "PARTIAL"] },
        },
      })
    )
      throw Error(
        "Resolve the pending application before rejecting this version",
      );
    await tx.keywordTarget.updateMany({
      where: { storeId, proposalId: id },
      data: { state: "REJECTED" },
    });
    await tx.audit.create({
      data: { storeId, actor, event: "PROPOSAL_REJECTED", target: id },
    });
  });
}
