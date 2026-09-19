import "dotenv/config";
import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import {
  seedResource,
  lockMap,
  publishTarget,
  approveTarget,
  overlaps,
  overlapPage,
  pairKey,
  decideOverlap,
  activateTarget,
} from "../app/services/keywords.server";
import { syncQueryDay } from "../app/services/search-console.server";
import { contentHash, type Snapshot } from "../app/core/content";
import type { Research } from "../app/core/keywords";
import { saveIntentProposal } from "../app/services/keyword-dashboard.server";
let storeId: string, otherStore: string;
const snap: Snapshot = {
  id: "gid://shopify/Product/1",
  kind: "PRODUCT",
  title: "Ghost rug",
  handle: "ghost",
  descriptionHtml: "<p>Ghost print rug</p>",
  seo: { title: null, description: null },
  faqs: [],
  images: [],
  context: {},
};
const plan: Research = {
  primary: "ghost print rug",
  secondary: [],
  cluster: "halloween rugs",
  intent: "TRANSACTIONAL",
  buyerNeed: "Buy a ghost print rug",
  rationale: "Matches visible design",
  changeScope: "CLARIFICATION",
  candidates: [
    {
      keyword: "ghost print rug",
      origin: "AGENT_PROPOSED",
      reason: "Design",
      evidenceIds: ["product"],
    },
  ],
  questions: [],
  limitations: [],
};
beforeAll(async () => {
  const token = randomUUID();
  storeId = (
    await db.store.create({
      data: { domain: `keywords-${token}.myshopify.com` },
    })
  ).id;
  otherStore = (
    await db.store.create({
      data: { domain: `other-keywords-${token}.myshopify.com` },
    })
  ).id;
});
afterAll(async () => {
  await db.store.deleteMany({
    where: { id: { in: [storeId, otherStore].filter(Boolean) } },
  });
  await db.$disconnect();
});
async function resource() {
  return db.resource.create({
    data: {
      storeId,
      gid: randomUUID(),
      kind: "PRODUCT",
      title: snap.title,
      handle: randomUUID(),
      snapshot: JSON.parse(JSON.stringify(snap)),
      sourceHash: contentHash(snap),
    },
  });
}
async function target(resourceId: string, suffix: string) {
  return db.$transaction((tx) =>
    publishTarget(tx, {
      storeId,
      resourceId,
      proposalId: randomUUID(),
      market: "USA",
      plan: { ...plan, primary: `${plan.primary} ${suffix}`, cluster: suffix },
      fingerprint: randomUUID(),
      evidenceLevel: "HYPOTHESIS_ONLY",
    }),
  );
}
it("indexes existing catalog content idempotently without claiming verified targeting", async () => {
  const r = await resource();
  const seed = () =>
    db.$transaction(
      async (tx) => {
        await lockMap(tx, storeId);
        return seedResource(tx, storeId, r.id, "USA");
      },
      { maxWait: 10000 },
    );
  await Promise.all([seed(), seed()]);
  expect(
    await db.keywordTarget.count({
      where: { resourceId: r.id, state: "BASELINE" },
    }),
  ).toBe(1);
  expect((await seed()).evidenceLevel).toBe("UNVERIFIED_BASELINE");
});
it("blocks concurrent competing proposals until a version-specific merchant decision", async () => {
  const left = await target((await resource()).id, "concurrent");
  const right = await target((await resource()).id, "concurrent");
  const results = await Promise.allSettled(
    [left, right].map((t) =>
      db.$transaction((tx) => approveTarget(tx, storeId, t.proposalId!)),
    ),
  );
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  const match = (await overlaps(db, left)).find(
    (c) => c.other.id === right.id,
  )!;
  await expect(
    decideOverlap(
      otherStore,
      "intruder",
      left.id,
      right.id,
      match.pairKey,
      "ACCEPT_OVERLAP",
      "Legitimate distinct product variants",
    ),
  ).rejects.toThrow();
  await decideOverlap(
    storeId,
    "merchant",
    left.id,
    right.id,
    match.pairKey,
    "DISTINCT_INTENT",
    "Different sizes serve different room needs",
  );
  await db.$transaction((tx) => approveTarget(tx, storeId, left.proposalId!));
  expect(
    (await db.keywordTarget.findUniqueOrThrow({ where: { id: left.id } }))
      .state,
  ).toBe("APPROVED");
  await db.keywordTarget.update({
    where: { id: right.id },
    data: { contentFingerprint: "edited-revision" },
  });
  expect(
    (await overlaps(db, left)).find((c) => c.other.id === right.id)?.decision,
  ).toBeNull();
});
it("activates only after application and preserves archived history on restore", async () => {
  const r = await resource();
  const t = await target(r.id, "lifecycle");
  expect(t.state).toBe("PROPOSED");
  await db.$transaction((tx) =>
    activateTarget(tx, storeId, r.id, t.proposalId, snap),
  );
  expect(
    (await db.keywordTarget.findUniqueOrThrow({ where: { id: t.id } })).state,
  ).toBe("ACTIVE");
  await db.$transaction((tx) => activateTarget(tx, storeId, r.id, null, snap));
  expect(
    (await db.keywordTarget.findUniqueOrThrow({ where: { id: t.id } })).state,
  ).toBe("ARCHIVED");
  expect(
    await db.keywordTarget.count({
      where: { resourceId: r.id, state: "BASELINE" },
    }),
  ).toBe(1);
});
it("persists query dimensions separately and retains the previous snapshot on fetch failure", async () => {
  await syncQueryDay(
    storeId,
    "2026-09-01",
    "test",
    async (_id, _path, body) => {
      expect(body).toMatchObject({
        dimensions: ["page", "query", "country", "device"],
      });
      return {
        rows: [
          {
            keys: [
              "https://shop.test/products/ghost",
              "ghost rug",
              "usa",
              "mobile",
            ],
            clicks: 2,
            impressions: 30,
            position: 8,
          },
        ],
      };
    },
  );
  expect(await db.queryMetric.findFirst({ where: { storeId } })).toMatchObject({
    query: "ghost rug",
    country: "usa",
    device: "MOBILE",
    clicks: 2,
  });
  await expect(
    syncQueryDay(storeId, "2026-09-01", "test", async () => {
      throw Error("Network unavailable");
    }),
  ).rejects.toThrow();
  expect(await db.queryMetric.count({ where: { storeId } })).toBe(1);
  expect(await db.searchMetric.count({ where: { storeId } })).toBe(0);
});

it("refuses proposal edits while an earlier application can still retry its saved content", async () => {
  const r = await resource();
  const content = {
    title: "New",
    descriptionHtml: "<p>New</p>",
    seoTitle: "New",
    seoDescription: "New rug",
    faqs: [],
    imageAlts: [],
    facts: [],
    warnings: [],
    knowledgeSuggestions: [],
  };
  const p = await db.proposal.create({
    data: {
      storeId,
      resourceId: r.id,
      knowledgeId: "test",
      promptVersion: "v2",
      status: "CONFLICT",
      sourceSnapshot: JSON.parse(JSON.stringify(snap)),
      sourceHash: contentHash(snap),
      content,
    },
  });
  await db.application.create({
    data: {
      storeId,
      resourceId: r.id,
      proposalId: p.id,
      status: "PARTIAL",
      target: JSON.parse(JSON.stringify(snap)),
      expectedHash: contentHash(snap),
      actor: "merchant",
    },
  });
  await expect(
    saveIntentProposal(storeId, p.id, 1, content, null, "merchant"),
  ).rejects.toThrow(/application/i);
  expect(
    (await db.proposal.findUniqueOrThrow({ where: { id: p.id } })).revision,
  ).toBe(1);
});

it("checks beyond the first conflict page before approving and bounds preview results", async () => {
  const r = await resource(),
    peerResource = await resource();
  const t = await target(r.id, "pagination");
  const prefix = randomUUID();
  await db.keywordTarget.createMany({
    data: Array.from({ length: 201 }, (_, i) => ({
      ...t,
      id: `${prefix}-${String(i).padStart(3, "0")}`,
      resourceId: peerResource.id,
      proposalId: null,
    })),
  });
  const peers = await db.keywordTarget.findMany({
    where: { storeId, resourceId: peerResource.id },
    orderBy: { id: "asc" },
  });
  await db.keywordDecision.createMany({
    data: peers.slice(0, 200).map((p) => ({
      storeId,
      pairKey: pairKey(t, p),
      leftId: t.id,
      rightId: p.id,
      decision: "ACCEPT_OVERLAP",
      reason: "Explicitly reviewed distinct designs",
      actor: "merchant",
    })),
  });
  const preview = await overlapPage(db, t);
  expect(preview.matches).toHaveLength(100);
  expect(preview.nextCursor).not.toBeNull();
  await expect(
    db.$transaction((tx) => approveTarget(tx, storeId, t.proposalId!), {
      timeout: 15000,
    }),
  ).rejects.toThrow(/overlap/i);
  expect(
    (await db.keywordTarget.findUniqueOrThrow({ where: { id: t.id } })).state,
  ).toBe("PROPOSED");
});

it("keeps a merchant overlap decision valid when the exact approved version becomes active", async () => {
  const left = await target((await resource()).id, "stable-decision");
  const right = await target((await resource()).id, "stable-decision");
  const key = pairKey(left, right);
  await decideOverlap(
    storeId,
    "merchant",
    left.id,
    right.id,
    key,
    "DISTINCT_INTENT",
    "These designs answer distinct buying needs",
  );
  await db.$transaction((tx) =>
    activateTarget(tx, storeId, left.resourceId, left.proposalId, snap),
  );
  const active = await db.keywordTarget.findUniqueOrThrow({
    where: { id: left.id },
  });
  expect(pairKey(active, right)).toBe(key);
  expect(
    (await overlaps(db, active)).find((c) => c.other.id === right.id)?.decision
      ?.decision,
  ).toBe("DISTINCT_INTENT");
});
