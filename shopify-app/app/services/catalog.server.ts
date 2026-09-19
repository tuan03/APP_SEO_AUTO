import { checkpointJob } from "./job-state.server";
import type { Prisma, ScanJob, Store } from "@prisma/client";
import db from "../db.server";
import { graphql, saveResource, type ShopifyNode } from "./shopify-api.server";
import type { Snapshot } from "../core/content";
type CatalogFilter = {
  kind?: string;
  ids?: string[];
  q?: string;
  vendor?: string;
  tag?: string;
  collection?: string;
  status?: string;
  productType?: string;
  optimization?: string;
  after?: string;
};
export const filterWhere = (
  storeId: string,
  input: unknown,
): Prisma.ResourceWhereInput => {
  const filter = input as CatalogFilter;
  return {
    storeId,
    deleted: false,
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.ids?.length ? { id: { in: filter.ids } } : {}),
    ...(filter.q ? { title: { contains: filter.q, mode: "insensitive" } } : {}),
    ...(filter.vendor ? { vendor: filter.vendor } : {}),
    ...(filter.tag ? { tags: { has: filter.tag } } : {}),
    ...(filter.collection ? { collectionIds: { has: filter.collection } } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.productType ? { productType: filter.productType } : {}),
    ...(filter.optimization === "UNSCANNED" ? { lastScannedAt: null } : {}),
    ...(filter.optimization === "SCANNED"
      ? { lastScannedAt: { not: null } }
      : {}),
    ...(filter.after ? { syncedAt: { gte: new Date(filter.after) } } : {}),
  };
};
export const bulkQuery = (kind: string) =>
  kind === "PRODUCT"
    ? `{products{edges{node{id title handle descriptionHtml status vendor productType tags seo{title description} media{edges{node{... on MediaImage{id alt image{url}}}}} variants{edges{node{id title sku price selectedOptions{name value}}}} collections{edges{node{id title}}} metafields{edges{node{id namespace key value type}}}}}}}`
    : `{collections{edges{node{id title handle descriptionHtml seo{title description} image{id url altText} metafields{edges{node{id namespace key value type}}}}}}}`;
export async function syncCatalogStep(job: ScanJob, store: Store) {
  const cp = (job.checkpoint || {}) as {
    kind?: "PRODUCT" | "COLLECTION";
    bulkId?: string;
    loaded?: boolean;
    cursor?: string;
  };
  const kind = cp.kind || "PRODUCT";
  if (!cp.bulkId) {
    const info: {
      shop: { primaryDomain: { url: string }; ianaTimezone: string };
    } = await graphql(
      store.domain,
      `
        {
          shop {
            name
            ianaTimezone
            primaryDomain {
              url
            }
          }
        }
      `,
    );
    await db.store.update({
      where: { id: store.id },
      data: {
        website: info.shop.primaryDomain.url,
        timezone: info.shop.ianaTimezone,
      },
    });
    const r: { bulkOperationRunQuery: { bulkOperation: { id: string } } } =
      await graphql(
        store.domain,
        `
          mutation ($query: String!) {
            bulkOperationRunQuery(query: $query) {
              bulkOperation {
                id
                status
              }
              userErrors {
                message
              }
            }
          }
        `,
        { query: bulkQuery(kind) },
      );
    await checkpointJob({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        checkpoint: { kind, bulkId: r.bulkOperationRunQuery.bulkOperation.id },
      },
    });
    return;
  }
  const r: {
    node: {
      status: string;
      url: string | null;
      errorCode: string | null;
    } | null;
  } = await graphql(
    store.domain,
    `
      query ($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            url
            errorCode
          }
        }
      }
    `,
    { id: cp.bulkId },
  );
  const op = r.node;
  if (!op) throw new Error("Bulk operation disappeared");
  if (["FAILED", "CANCELED", "EXPIRED"].includes(op.status))
    throw new Error(`Bulk sync ${op.status}: ${op.errorCode}`);
  if (op.status !== "COMPLETED") return;
  if (!cp.loaded) {
    if (op.url) {
      const u = new URL(op.url);
      if (
        u.protocol !== "https:" ||
        !(
          u.hostname.endsWith(".googleapis.com") ||
          u.hostname.endsWith(".shopify.com")
        )
      )
        throw new Error("Unexpected bulk download host");
      const response = await fetch(u, {
        redirect: "error",
        signal: AbortSignal.timeout(600000),
      });
      if (!response.ok || !response.body)
        throw new Error("Cannot download bulk result");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      let rows: Prisma.CatalogRowCreateManyInput[] = [];
      const flush = async () => {
        if (!rows.length) return;
        await db.catalogRow.createMany({ data: rows, skipDuplicates: true });
        rows = [];
      };
      const line = async (text: string) => {
        if (!text.trim()) return;
        const value = JSON.parse(text);
        rows.push({
          jobId: job.id,
          gid: value.__parentId ? `${value.__parentId}|${value.id}` : value.id,
          parentId: value.__parentId || null,
          value,
        });
        if (rows.length >= 200) await flush();
      };
      let downloading = true;
      while (downloading) {
        const { done, value } = await reader.read();
        if (done) {
          downloading = false;
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          await line(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
        if (buffer.length > 20000000) throw new Error("Oversized catalog row");
      }
      await line(buffer + decoder.decode());
      await flush();
    }
    await checkpointJob({
      where: { id: job.id },
      data: { checkpoint: { ...cp, loaded: true } },
    });
    return;
  }
  const roots = await db.catalogRow.findMany({
    where: {
      jobId: job.id,
      parentId: null,
      ...(cp.cursor ? { id: { gt: cp.cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: 100,
  });
  for (const row of roots) {
    const n = row.value as unknown as ShopifyNode;
    const children = (
      await db.catalogRow.findMany({ where: { jobId: job.id, parentId: n.id } })
    ).map((r) => r.value as unknown as ShopifyNode);
    let faqs = [];
    const f = children.find(
      (c) => c.namespace === "seo_aeo" && c.key === "faqs",
    );
    if (f) faqs = JSON.parse(f.value);
    const snapshot: Snapshot = {
      id: n.id,
      kind,
      title: n.title,
      descriptionHtml: n.descriptionHtml || "",
      handle: n.handle,
      seo: n.seo,
      faqs,
      images:
        kind === "PRODUCT"
          ? children
              .filter((c) => c.image?.url)
              .map((i) => ({ id: i.id, url: i.image!.url, alt: i.alt || "" }))
          : n.image
            ? [
                {
                  id: n.image.id || n.id,
                  url: n.image.url,
                  alt: n.image.altText || "",
                },
              ]
            : [],
      context:
        kind === "PRODUCT"
          ? {
              status: n.status,
              vendor: n.vendor,
              productType: n.productType,
              tags: n.tags,
              variants: children.filter((c) => c.selectedOptions),
              collections: children.filter((c) =>
                c.id?.includes("/Collection/"),
              ),
              metafields: children.filter(
                (c) =>
                  c.namespace &&
                  c.namespace !== "seo_aeo" &&
                  !c.namespace.startsWith("app--"),
              ),
            }
          : {
              metafields: children.filter(
                (c) =>
                  c.namespace &&
                  c.namespace !== "seo_aeo" &&
                  !c.namespace.startsWith("app--"),
              ),
            },
    };
    await saveResource(store.id, snapshot);
  }
  if (roots.length) {
    await checkpointJob({
      where: { id: job.id },
      data: { checkpoint: { ...cp, cursor: roots.at(-1)!.id } },
    });
    return;
  }
  await db.resource.updateMany({
    where: { storeId: store.id, kind, syncedAt: { lt: job.createdAt } },
    data: { deleted: true },
  });
  await db.catalogRow.deleteMany({ where: { jobId: job.id } });
  if (kind === "PRODUCT")
    await checkpointJob({
      where: { id: job.id },
      data: { checkpoint: { kind: "COLLECTION" } },
    });
  else {
    await checkpointJob({
      where: { id: job.id },
      data: { status: "COMPLETED" },
    });
    await db.store.update({
      where: { id: store.id },
      data: { lastSync: new Date() },
    });
  }
}
