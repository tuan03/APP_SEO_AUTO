import "dotenv/config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("../app/shopify.server", () => ({
  authenticate: {},
  unauthenticated: { admin: vi.fn() },
}));
vi.mock("../app/services/shopify-api.server", () => ({
  readSnapshot: vi.fn(),
  writeBackup: vi.fn(),
  writeCore: vi.fn(),
  writeImage: vi.fn(),
  setMetafields: vi.fn(),
  saveResource: vi.fn(),
}));
import db from "../app/db.server";
import { filterWhere } from "../app/services/catalog.server";
import { scheduleTick, nextRun } from "../app/services/jobs.server";
import { approveProposal, requestRestore } from "../app/services/apply.server";
import { readSnapshot } from "../app/services/shopify-api.server";
import { contentHash, sourceHash, type Snapshot } from "../app/core/content";
const run = randomUUID();
let a: string, b: string, rid: string;
const snapshot: Snapshot = {
  id: "gid://shopify/Product/123",
  kind: "PRODUCT",
  title: "Product",
  handle: "stable-url",
  descriptionHtml: "<p>Product</p>",
  seo: { title: null, description: null },
  faqs: [],
  images: [],
  context: {},
};
beforeAll(async () => {
  a = (
    await db.store.create({
      data: {
        domain: `test-a-${run}.myshopify.com`,
        settings: { wordsMin: 0, faqMin: 0 },
      },
    })
  ).id;
  b = (
    await db.store.create({ data: { domain: `test-b-${run}.myshopify.com` } })
  ).id;
  rid = (
    await db.resource.create({
      data: {
        storeId: a,
        gid: snapshot.id,
        kind: "PRODUCT",
        title: "Product",
        handle: "stable-url",
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        sourceHash: sourceHash(snapshot),
      },
    })
  ).id;
  vi.mocked(readSnapshot).mockResolvedValue(snapshot);
});
afterAll(async () => {
  await db.store.deleteMany({ where: { id: { in: [a, b].filter(Boolean) } } });
  await db.$disconnect();
});
it("never allows a selected resource ID to cross a store filter", async () => {
  expect(
    await db.resource.findMany({ where: filterWhere(b, { ids: [rid] }) }),
  ).toEqual([]);
  expect(
    await db.resource.count({ where: filterWhere(a, { ids: [rid] }) }),
  ).toBe(1);
});
it("materializes one schedule once under concurrent scheduler ticks", async () => {
  const s = await db.schedule.create({
    data: {
      storeId: a,
      name: "test",
      timezone: "Asia/Ho_Chi_Minh",
      filter: { kind: "PRODUCT" },
      rule: "UNSCANNED",
      nextRun: new Date(Date.now() - 1000),
    },
  });
  await Promise.all([scheduleTick(), scheduleTick()]);
  expect(
    await db.scanJob.count({
      where: { storeId: a, actor: `schedule:${s.id}` },
    }),
  ).toBe(1);
  expect(
    (await db.schedule.findUniqueOrThrow({ where: { id: s.id } })).active,
  ).toBe(false);
});
it("approves the same proposal exactly once under concurrent requests", async () => {
  const k = await db.knowledge.create({
    data: { storeId: a, status: "APPROVED", content: {} },
  });
  const p = await db.proposal.create({
    data: {
      storeId: a,
      resourceId: rid,
      sourceSnapshot: JSON.parse(JSON.stringify(snapshot)),
      sourceHash: contentHash(snapshot),
      knowledgeId: k.id,
      promptVersion: "test",
      content: {
        title: "New",
        descriptionHtml: "<p>New</p>",
        seoTitle: "New",
        seoDescription: "New product",
        faqs: [],
        imageAlts: [],
        facts: [],
        warnings: [],
        knowledgeSuggestions: [],
      },
    },
  });
  const result = await Promise.allSettled([
    approveProposal(a, p.id, "one"),
    approveProposal(a, p.id, "two"),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.application.count({ where: { storeId: a, proposalId: p.id } }),
  ).toBe(1);
  await expect(approveProposal(b, p.id, "intruder")).rejects.toThrow();
});
it("uses the store time zone across DST", () => {
  expect(
    nextRun(
      "0 9 * * *",
      "America/New_York",
      new Date("2026-03-07T15:00:00Z"),
    ).toISOString(),
  ).toBe("2026-03-08T13:00:00.000Z");
});
it("restores content without reverting a URL or reviving deleted images", async () => {
  const before = {
    ...snapshot,
    handle: "old-url",
    images: [
      { id: "deleted", url: "https://cdn.shopify.com/deleted.png", alt: "old" },
    ],
  };
  const current = {
    ...snapshot,
    handle: "new-url",
    images: [
      { id: "new", url: "https://cdn.shopify.com/new.png", alt: "new image" },
    ],
  };
  vi.mocked(readSnapshot).mockResolvedValueOnce(current);
  const previous = await db.application.create({
    data: {
      storeId: a,
      resourceId: rid,
      target: JSON.parse(JSON.stringify(snapshot)),
      before: JSON.parse(JSON.stringify(before)),
      expectedHash: contentHash(snapshot),
      actor: "test",
      status: "APPLIED",
    },
  });
  await requestRestore(a, previous.id, "test");
  const restored = await db.application.findFirstOrThrow({
    where: { storeId: a, restoreOf: previous.id },
  });
  expect((restored.target as unknown as Snapshot).handle).toBe("new-url");
  expect((restored.target as unknown as Snapshot).images).toEqual(
    current.images,
  );
});

it("preserves checkpoints without reviving paused or canceled jobs", async () => {
  const { checkpointJob } = await import("../app/services/job-state.server");
  const job = await db.scanJob.create({
    data: { storeId: a, actor: "test", status: "PAUSED" },
  });
  await checkpointJob({
    where: { id: job.id },
    data: { status: "COMPLETED", checkpoint: { cursor: "saved" } },
  });
  expect(await db.scanJob.findUnique({ where: { id: job.id } })).toMatchObject({
    status: "PAUSED",
    checkpoint: { cursor: "saved" },
  });
  await db.scanJob.update({
    where: { id: job.id },
    data: { status: "CANCELED" },
  });
  await checkpointJob({
    where: { id: job.id },
    data: { status: "RUNNING", checkpoint: { cursor: "later" } },
  });
  expect(await db.scanJob.findUnique({ where: { id: job.id } })).toMatchObject({
    status: "CANCELED",
    checkpoint: { cursor: "saved" },
  });
});
it("serializes competing knowledge approvals against the same baseline", async () => {
  const { approveKnowledge } = await import("../app/services/knowledge.server");
  const content = {
    brand: "Test",
    positioning: "Test",
    tone: "Factual",
    markets: [],
    facts: [],
    audienceHypotheses: [],
    searchIntents: [],
    policies: [],
    prohibitedClaims: [],
  };
  const one = await db.knowledge.create({ data: { storeId: b, content } });
  const two = await db.knowledge.create({ data: { storeId: b, content } });
  const results = await Promise.allSettled([
    approveKnowledge(b, one.id, content, "one"),
    approveKnowledge(b, two.id, content, "two"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.knowledge.count({ where: { storeId: b, status: "APPROVED" } }),
  ).toBe(1);
});

it("weights search position by impressions and isolates store metrics", async () => {
  const { metrics } = await import("../app/services/analytics.server");
  await db.searchMetric.createMany({
    data: [
      {
        storeId: a,
        date: "2026-09-01",
        page: "https://store.test/a",
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 2,
      },
      {
        storeId: a,
        date: "2026-09-01",
        page: "https://store.test/b",
        clicks: 10,
        impressions: 900,
        ctr: 10 / 900,
        position: 10,
      },
      {
        storeId: b,
        date: "2026-09-01",
        page: "https://other.test/a",
        clicks: 999,
        impressions: 999,
        ctr: 1,
        position: 1,
      },
    ],
  });
  const result = await metrics(a, "2026-09-01", "2026-09-02");
  expect(result).toEqual({
    clicks: 20,
    impressions: 1000,
    ctr: 0.02,
    position: 9.2,
    days: 1,
  });
  expect(
    (await metrics(a, "2026-09-01", "2026-09-02", "https://store.test/a"))
      .position,
  ).toBe(2);
});

it("loads real tenant performance data including comparison windows", async () => {
  const tenantService = await import("../app/services/tenant.server");
  const store = await db.store.findUniqueOrThrow({ where: { id: a } });
  const mock = vi
    .spyOn(tenantService, "tenant")
    .mockResolvedValue({ store } as Awaited<
      ReturnType<typeof tenantService.tenant>
    >);
  try {
    const { loader } = await import("../app/services/dashboard.server");
    const result = await loader({
      request: new Request("https://app.test/app/performance"),
      url: new URL("https://app.test/app/performance"),
      pattern: "/app/:page",
      params: { page: "performance" },
      context: {},
    });
    expect(result.page).toBe("performance");
    if (result.page === "performance") {
      expect(result.comparison.periods).toHaveLength(2);
      expect(result.comparison.periods[0].clicks).toBe(20);
    }
  } finally {
    mock.mockRestore();
  }
});

it("waits for full catalog sync before materializing all filtered results", async () => {
  const { scanStep } = await import("../app/services/jobs.server");
  const store = await db.store.findUniqueOrThrow({ where: { id: a } });
  const job = await db.scanJob.create({
    data: { storeId: a, actor: "test", type: "SCAN" },
  });
  await scanStep(job, store);
  const saved = await db.scanJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(saved.materialized).toBe(false);
  expect(saved.error).toContain("Waiting for catalog sync");
  expect(await db.scanItem.count({ where: { jobId: job.id } })).toBe(0);
});
