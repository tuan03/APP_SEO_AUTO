import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock("../app/shopify.server", () => ({
  unauthenticated: {
    admin: async () => ({ admin: { graphql: mocks.graphql } }),
  },
}));
vi.mock("../app/db.server", () => ({
  default: { store: { findUnique: async () => ({ active: true }) } },
}));
import { writeBackup } from "../app/services/shopify-api.server";
import type { Snapshot } from "../app/core/content";
const snapshot: Snapshot = {
  id: "gid://shopify/Product/1",
  kind: "PRODUCT",
  title: "Test",
  descriptionHtml: "",
  handle: "test",
  seo: { title: null, description: null },
  faqs: [],
  images: [],
  context: {},
};
beforeEach(() => {
  mocks.graphql.mockReset();
  mocks.graphql.mockImplementation(async (query: string) => ({
    json: async () => ({
      data: query.trimStart().startsWith("query")
        ? {
            node: {
              metafields: {
                nodes: [{ key: "b_old_0" }, { key: "faqs" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }
        : { operation: { userErrors: [] } },
    }),
  }));
});
it("publishes the latest backup before deleting old chunks", async () => {
  await writeBackup("test.myshopify.com", snapshot, "application123");
  const calls = mocks.graphql.mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[1][1].variables.metafields[0].key).toBe("b_application123_0");
  expect(calls[2][1].variables.metafields[0].key).toBe("backup_latest");
  expect(calls[3][1].variables.metafields).toEqual([
    { ownerId: snapshot.id, namespace: "seo_aeo", key: "b_old_0" },
  ]);
});
it("keeps the previous backup if publishing the new manifest fails", async () => {
  mocks.graphql.mockImplementationOnce(async () => ({
    json: async () => ({
      data: {
        node: {
          metafields: {
            nodes: [{ key: "b_old_0" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
  }));
  mocks.graphql.mockImplementationOnce(async () => ({
    json: async () => ({ data: { operation: { userErrors: [] } } }),
  }));
  mocks.graphql.mockRejectedValueOnce(new Error("network failure"));
  await expect(
    writeBackup("test.myshopify.com", snapshot, "application123"),
  ).rejects.toThrow("network failure");
  expect(
    mocks.graphql.mock.calls.some(([query]) =>
      query.includes("metafieldsDelete"),
    ),
  ).toBe(false);
});
