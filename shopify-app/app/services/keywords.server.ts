import type { KeywordTarget, Prisma } from "@prisma/client";
import db from "../db.server";
import {
  hash,
  contentHash,
  settingsSchema,
  type Snapshot,
} from "../core/content";
import {
  classifyOverlap,
  keywordKeys,
  normalizeKeyword,
  type Research,
} from "../core/keywords";

type Tx = Prisma.TransactionClient;
export const visibleStates = ["BASELINE", "PROPOSED", "APPROVED", "ACTIVE"];
const json = (x: unknown) => JSON.parse(JSON.stringify(x));
export async function lockMap(tx: Tx, storeId: string) {
  await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
}
export function pairKey(a: KeywordTarget, b: KeywordTarget) {
  return hash(
    [a, b]
      .map((t) => ({ id: t.id, fingerprint: t.contentFingerprint }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
export async function overlapPage(
  tx: Tx,
  target: KeywordTarget,
  after?: string,
  limit = 100,
) {
  const candidates = await tx.keywordTarget.findMany({
    where: {
      ...(after ? { id: { gt: after } } : {}),
      storeId: target.storeId,
      market: target.market,
      language: target.language,
      state: { in: visibleStates },
      resourceId: { not: target.resourceId },
      resource: { deleted: false },
      OR: [
        { keys: { hasSome: target.keys } },
        { clusterKey: target.clusterKey },
      ],
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    include: {
      resource: { select: { title: true, kind: true, handle: true } },
    },
  });
  const page = candidates.slice(0, limit);
  const resource = await tx.resource.findFirstOrThrow({
    where: { id: target.resourceId, storeId: target.storeId },
  });
  const decisions = await tx.keywordDecision.findMany({
    where: {
      storeId: target.storeId,
      pairKey: { in: page.map((t) => pairKey(target, t)) },
    },
  });
  const decisionsByKey = new Map(decisions.map((d) => [d.pairKey, d]));
  const matches = page.flatMap((other) => {
    const match = classifyOverlap(
      { ...target, kind: resource.kind },
      { ...other, kind: other.resource.kind },
    );
    return match
      ? [
          {
            ...match,
            other,
            pairKey: pairKey(target, other),
            decision: decisionsByKey.get(pairKey(target, other)) || null,
          },
        ]
      : [];
  });
  return {
    matches,
    nextCursor: candidates.length > limit ? page.at(-1)!.id : null,
  };
}
export async function overlaps(tx: Tx, target: KeywordTarget) {
  return (await overlapPage(tx, target)).matches;
}
export async function seedResource(
  tx: Tx,
  storeId: string,
  resourceId: string,
  market: string,
) {
  const r = await tx.resource.findFirstOrThrow({
    where: { id: resourceId, storeId, deleted: false },
  });
  const snapshot = r.snapshot as unknown as Snapshot;
  const fingerprint = contentHash(snapshot);
  // External changes invalidate a formerly applied map entry, not its history.
  await tx.keywordTarget.updateMany({
    where: {
      storeId,
      resourceId,
      market,
      state: { in: ["ACTIVE", "BASELINE"] },
      appliedContentHash: { not: fingerprint },
    },
    data: { state: "ARCHIVED" },
  });
  const existing = await tx.keywordTarget.findFirst({
    where: {
      storeId,
      resourceId,
      market,
      state: { in: ["ACTIVE", "BASELINE"] },
    },
  });
  if (existing) return existing;
  const primary = (snapshot.seo.title || snapshot.title).slice(0, 200);
  return tx.keywordTarget.create({
    data: {
      storeId,
      resourceId,
      market,
      language: "en",
      state: "BASELINE",
      primary,
      keys: keywordKeys(primary, []),
      cluster: primary,
      clusterKey: normalizeKeyword(primary),
      intent: "UNKNOWN",
      buyerNeed: "Not researched yet",
      rationale:
        "Inferred from the current SEO title or product title. This is not a verified keyword strategy.",
      evidenceLevel: "UNVERIFIED_BASELINE",
      contentFingerprint: fingerprint,
      appliedContentHash: fingerprint,
    },
  });
}
export async function publishTarget(
  tx: Tx,
  input: {
    storeId: string;
    resourceId: string;
    proposalId: string;
    market: string;
    plan: Research;
    fingerprint: string;
    evidenceLevel: string;
  },
) {
  await lockMap(tx, input.storeId);
  await tx.resource.findFirstOrThrow({
    where: { id: input.resourceId, storeId: input.storeId, deleted: false },
  });
  const { plan } = input;
  return tx.keywordTarget.create({
    data: {
      storeId: input.storeId,
      resourceId: input.resourceId,
      proposalId: input.proposalId,
      market: input.market,
      state: "PROPOSED",
      primary: plan.primary,
      secondary: plan.secondary,
      keys: keywordKeys(plan.primary, plan.secondary),
      cluster: plan.cluster,
      clusterKey: normalizeKeyword(plan.cluster),
      intent: plan.intent,
      buyerNeed: plan.buyerNeed,
      rationale: plan.rationale,
      evidenceLevel: input.evidenceLevel,
      contentFingerprint: input.fingerprint,
    },
  });
}
export async function approveTarget(
  tx: Tx,
  storeId: string,
  proposalId: string,
) {
  await lockMap(tx, storeId);
  const target = await tx.keywordTarget.findFirst({
    where: { storeId, proposalId },
  });
  if (!target) {
    const p = await tx.proposal.findFirst({
      where: { id: proposalId, storeId },
    });
    if (p?.research)
      throw Error("Keyword target is missing; rescan before approving");
    return;
  }
  let after: string | undefined;
  do {
    const page = await overlapPage(tx, target, after, 200);
    const unresolved = page.matches.find((c) => c.blocking && !c.decision);
    if (unresolved)
      throw Error(
        `Keyword overlap needs a decision: ${unresolved.other.primary}. Open Keyword Map.`,
      );
    after = page.nextCursor || undefined;
  } while (after);
  const other = await tx.keywordTarget.count({
    where: {
      storeId,
      resourceId: target.resourceId,
      state: "APPROVED",
      id: { not: target.id },
    },
  });
  if (other)
    throw Error("Another version for this page is still awaiting application");
  await tx.keywordTarget.update({
    where: { id: target.id },
    data: { state: "APPROVED" },
  });
}
export async function activateTarget(
  tx: Tx,
  storeId: string,
  resourceId: string,
  proposalId: string | null,
  snapshot: Snapshot,
) {
  await lockMap(tx, storeId);
  const target = proposalId
    ? await tx.keywordTarget.findFirst({
        where: { storeId, resourceId, proposalId },
      })
    : null;
  await tx.keywordTarget.updateMany({
    where: { storeId, resourceId, state: { in: ["ACTIVE", "BASELINE"] } },
    data: { state: "ARCHIVED" },
  });
  if (target)
    await tx.keywordTarget.update({
      where: { id: target.id },
      data: { state: "ACTIVE", appliedContentHash: contentHash(snapshot) },
    });
  else {
    const store = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
    await seedResource(
      tx,
      storeId,
      resourceId,
      settingsSchema.parse(store.settings).targetMarket,
    );
  }
}
export async function decideOverlap(
  storeId: string,
  actor: string,
  leftId: string,
  rightId: string,
  expectedPair: string,
  decision: string,
  reason: string,
) {
  if (
    !["DISTINCT_INTENT", "HIERARCHY", "ACCEPT_OVERLAP"].includes(decision) ||
    reason.trim().length < 15 ||
    reason.length > 2000
  )
    throw Error("Choose a decision and explain it (15–2000 characters)");
  await db.$transaction(
    async (tx) => {
      await lockMap(tx, storeId);
      const left = await tx.keywordTarget.findFirstOrThrow({
        where: {
          id: leftId,
          storeId,
          state: { in: visibleStates },
          resource: { deleted: false },
        },
      });
      const right = await tx.keywordTarget.findFirstOrThrow({
        where: {
          id: rightId,
          storeId,
          state: { in: visibleStates },
          resource: { deleted: false },
        },
        include: { resource: { select: { kind: true } } },
      });
      const resource = await tx.resource.findFirstOrThrow({
        where: { id: left.resourceId, storeId },
      });
      if (
        pairKey(left, right) !== expectedPair ||
        !classifyOverlap(
          { ...left, kind: resource.kind },
          { ...right, kind: right.resource.kind },
        )
      )
        throw Error("Map changed; refresh before deciding");
      await tx.keywordDecision.upsert({
        where: { storeId_pairKey: { storeId, pairKey: expectedPair } },
        create: {
          storeId,
          pairKey: expectedPair,
          leftId,
          rightId,
          decision,
          reason: reason.trim(),
          actor,
        },
        update: {
          decision,
          reason: reason.trim(),
          actor,
          createdAt: new Date(),
        },
      });
      await tx.audit.create({
        data: {
          storeId,
          actor,
          event: "KEYWORD_OVERLAP_DECISION",
          target: leftId,
          detail: { rightId, decision, reason },
        },
      });
    },
    { maxWait: 10000, timeout: 15000 },
  );
}
export async function keywordIndexStep(
  job: { id: string; storeId: string; checkpoint: unknown },
  market: string,
) {
  const cp = job.checkpoint as { cursor?: string; indexed?: number };
  const rows = await db.resource.findMany({
    where: {
      storeId: job.storeId,
      deleted: false,
      ...(cp.cursor ? { id: { gt: cp.cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: 50,
  });
  await db.$transaction(
    async (tx) => {
      await lockMap(tx, job.storeId);
      for (const r of rows) await seedResource(tx, job.storeId, r.id, market);
      await tx.scanJob.updateMany({
        where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: rows.length ? "RUNNING" : "COMPLETED",
          checkpoint: json({
            cursor: rows.at(-1)?.id || cp.cursor,
            indexed: (cp.indexed || 0) + rows.length,
            market,
          }),
        },
      });
    },
    { maxWait: 10000, timeout: 30000 },
  );
}
