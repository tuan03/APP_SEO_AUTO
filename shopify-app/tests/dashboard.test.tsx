import React from "react";
import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DashboardData } from "../app/core/dashboard";
const state = vi.hoisted(() => ({ data: {} as DashboardData }));
vi.mock("../app/services/dashboard.server", () => ({
  loader: vi.fn(),
  action: vi.fn(),
}));
vi.mock("react-router", async (original) => {
  const module = await original<typeof import("react-router")>();
  const React = await import("react");
  return {
    ...module,
    useLoaderData: () => state.data,
    useActionData: () => undefined,
    useNavigation: () => ({ state: "idle" }),
    useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
    Form: (props: React.ComponentProps<"form">) =>
      React.createElement("form", props),
  };
});
import { MemoryRouter } from "react-router";
import Dashboard from "../app/routes/app.$page";
const base = {
  store: {
    domain: "demo.myshopify.com",
    website: "https://demo.example",
    timezone: "Asia/Ho_Chi_Minh",
    settings: {},
    connected: false,
    property: null,
    lastSync: null,
  },
  offset: 0,
  filter: {},
};
const fixtures: DashboardData[] = [
  {
    ...base,
    page: "overview",
    counts: [12450, 86, 42, 3],
    usage: {
      _sum: {
        input: 420000,
        output: 83000,
        cached: 200000,
        thinking: 12000,
        estimatedUsd: null,
      },
    },
    knowledge: { id: "approved" },
    recent: [],
  },
  {
    ...base,
    page: "products",
    total: 1,
    rows: [
      {
        id: "one",
        gid: "gid://shopify/Product/1",
        title: "Linen summer shirt",
        handle: "linen-shirt",
        vendor: "Acme",
        status: "ACTIVE",
        lastScannedAt: null,
        _count: { proposals: 0 },
      },
    ],
  },
  { ...base, page: "collections", total: 0, rows: [] },
  { ...base, page: "knowledge", rows: [], sources: [] },
  {
    ...base,
    page: "review",
    rows: [],
    current: {
      id: "one",
      kind: "PRODUCT",
      title: "Original",
      handle: "original",
      descriptionHtml: "<p>Original</p>",
      seo: { title: "Original", description: "Original" },
      images: [],
      faqs: [],
      context: {},
    },
    currentHash: "hash",
  },
  { ...base, page: "jobs", rows: [], schedules: [], itemCounts: [] },
  { ...base, page: "history", rows: [] },
  {
    ...base,
    page: "performance",
    daily: [],
    rows: [],
    events: [],
    cutoff: "2026-09-01",
    comparison: {
      periods: [
        { clicks: 0, impressions: 0, ctr: null, position: null, days: 0 },
        { clicks: 0, impressions: 0, ctr: null, position: null, days: 0 },
      ],
      comparisons: [],
      recentStart: "2026-09-01",
      previousStart: "2026-08-04",
      end: "2026-09-29",
    },
  },
  {
    ...base,
    page: "keywords",
    keywordMap: {
      rows: [
        {
          id: "target-one",
          storeId: "store",
          resourceId: "page",
          proposalId: "proposal",
          state: "PROPOSED",
          market: "USA",
          language: "en",
          primary: "ghost print rug",
          secondary: ["ghost pattern mat"],
          keys: [],
          cluster: "Halloween rugs",
          clusterKey: "halloween rugs",
          intent: "TRANSACTIONAL",
          buyerNeed: "Decorate an entryway with a ghost print rug",
          rationale: "Matches the actual printed design",
          evidenceLevel: "HYPOTHESIS_ONLY",
          contentFingerprint: "revision",
          appliedContentHash: null,
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resource: {
            title: "Ghost print rug",
            kind: "PRODUCT",
            handle: "ghost-rug",
          },
          overlaps: 2,
          blocking: 1,
          overlapsTruncated: false,
        },
      ],
      detail: null,
      conflicts: [],
      nextPeer: null,
      decisions: [],
      queries: [],
      total: 1,
      resources: 12,
      indexed: 12,
      q: "",
      state: "",
      market: "",
    },
  },
  { ...base, page: "settings", properties: [] },
];
for (const data of fixtures) {
  it(`renders the ${data.page} dashboard without a Shopify auth bypass`, () => {
    state.data = data;
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(markup).toContain("demo.myshopify.com");
    expect(markup).toContain("<h1>");
    expect(markup).not.toContain("undefined");
    mkdirSync("test-results/ui", { recursive: true });
    const css = readFileSync("app/styles/dashboard.css", "utf8");
    writeFileSync(
      `test-results/ui/${data.page}.html`,
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard fixture</title><style>${css}</style><body>${markup}</body></html>`,
    );
  });
}
