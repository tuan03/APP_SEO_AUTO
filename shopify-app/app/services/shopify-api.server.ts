import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { contentHash, sourceHash, type Snapshot } from "../core/content";
import { packBackup } from "../core/backup";

export async function graphql<T = Record<string, unknown>>(
  domain: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!(await db.store.findUnique({ where: { domain } }))?.active)
    throw new Error("Store is inactive");
  const { admin } = await unauthenticated.admin(domain);
  const response = await admin.graphql(query, { variables, tries: 3 });
  const body = (await response.json()) as {
    errors?: { message: string }[];
    data?: T;
  };
  if (body.errors?.length)
    throw new Error(
      body.errors.map((e: { message: string }) => e.message).join("; "),
    );
  if (!body.data) throw new Error("Shopify returned no data");
  for (const v of Object.values(body.data) as {
    userErrors?: { message: string }[];
  }[])
    if (v?.userErrors?.length)
      throw new Error(v.userErrors.map((e) => e.message).join("; "));
  return body.data as T;
}
export type ShopifyNode = {
  id: string;
  title: string;
  descriptionHtml: string;
  handle: string;
  seo: Snapshot["seo"];
  status: string;
  vendor: string;
  productType: string;
  tags: string[];
  metafield?: { value: string };
  image?: { id: string; url: string; altText: string };
  alt: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
  selectedOptions?: { name: string; value: string }[];
};
type Node = ShopifyNode;
type Connection = {
  nodes: Node[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
const base = `id title descriptionHtml handle seo { title description } metafield(namespace:"seo_aeo",key:"faqs") { value }`;
export async function readSnapshot(
  domain: string,
  gid: string,
): Promise<Snapshot> {
  const kind = gid.includes("/Product/") ? "PRODUCT" : "COLLECTION";
  const data = await graphql<{ node: Node | null }>(
    domain,
    `query($id:ID!){node(id:$id){... on Product{${base} status vendor productType tags} ... on Collection{${base} image{id url altText}}}}`,
    { id: gid },
  );
  if (!data.node) throw new Error("Resource was deleted or is inaccessible");
  const n = data.node;
  const images: Snapshot["images"] = [];
  const context: Record<string, unknown> = {};
  if (kind === "PRODUCT") {
    for (const key of ["status", "vendor", "productType", "tags"])
      context[key] = n[key as keyof Node];
    let cursor: string | null = null;
    do {
      const r: { product: { media: Connection } } = await graphql(
        domain,
        `
          query ($id: ID!, $cursor: String) {
            product(id: $id) {
              media(first: 100, after: $cursor) {
                nodes {
                  ... on MediaImage {
                    id
                    alt
                    image {
                      url
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `,
        { id: gid, cursor },
      );
      const page = r.product.media;
      for (const i of page.nodes)
        if (i.image?.url)
          images.push({ id: i.id, url: i.image.url, alt: i.alt || "" });
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    for (const [field, selection] of [
      [
        "variants",
        "id title sku price selectedOptions{name value} image{id url}",
      ],
      ["metafields", "namespace key value type"],
      ["collections", "id title descriptionHtml"],
    ]) {
      const nodes: Node[] = [];
      cursor = null;
      do {
        const r: { product: Record<string, Connection> } = await graphql(
          domain,
          `query($id:ID!,$cursor:String){product(id:$id){${field}(first:100,after:$cursor){nodes{${selection}}pageInfo{hasNextPage endCursor}}}}`,
          { id: gid, cursor },
        );
        const page = r.product[field];
        nodes.push(...page.nodes);
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      context[field] =
        field === "metafields"
          ? nodes.filter(
              (v) =>
                v.namespace !== "seo_aeo" && !v.namespace.startsWith("app--"),
            )
          : nodes;
    }
  } else if (n.image)
    images.push({
      id: n.image.id || gid,
      url: n.image.url,
      alt: n.image.altText || "",
    });
  if (kind === "COLLECTION") {
    const nodes: Node[] = [];
    let cursor: string | null = null;
    do {
      const r: { collection: { metafields: Connection } } = await graphql(
        domain,
        `
          query ($id: ID!, $cursor: String) {
            collection(id: $id) {
              metafields(first: 100, after: $cursor) {
                nodes {
                  namespace
                  key
                  value
                  type
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `,
        { id: gid, cursor },
      );
      const page = r.collection.metafields;
      nodes.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    context.metafields = nodes.filter(
      (v) => v.namespace !== "seo_aeo" && !v.namespace.startsWith("app--"),
    );
  }
  let faqs = [];
  try {
    faqs = JSON.parse(n.metafield?.value || "[]");
  } catch {
    throw new Error("Existing FAQ metafield is not valid JSON");
  }
  return {
    id: gid,
    kind,
    title: n.title,
    descriptionHtml: n.descriptionHtml || "",
    handle: n.handle,
    seo: n.seo,
    images,
    faqs,
    context,
  };
}
export async function saveResource(storeId: string, s: Snapshot) {
  const data = {
    kind: s.kind,
    title: s.title,
    handle: s.handle,
    status: String(s.context.status || "ACTIVE"),
    vendor: String(s.context.vendor || ""),
    productType: String(s.context.productType || ""),
    tags: (s.context.tags || []) as string[],
    collectionIds: ((s.context.collections || []) as { id: string }[]).map(
      (c) => c.id,
    ),
    snapshot: JSON.parse(JSON.stringify(s)),
    sourceHash: sourceHash(s),
    syncedAt: new Date(),
    deleted: false,
  };
  return db.resource.upsert({
    where: { storeId_gid: { storeId, gid: s.id } },
    create: { storeId, gid: s.id, ...data },
    update: data,
  });
}
export async function setMetafields(
  domain: string,
  ownerId: string,
  values: { key: string; value: unknown }[],
) {
  for (let i = 0; i < values.length; i += 25)
    await graphql(
      domain,
      `
        mutation ($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
            }
            userErrors {
              message
            }
          }
        }
      `,
      {
        metafields: values.slice(i, i + 25).map((v) => ({
          ownerId,
          namespace: "seo_aeo",
          key: v.key,
          type: "json",
          value: JSON.stringify(v.value),
        })),
      },
    );
}
export async function writeBackup(
  domain: string,
  s: Snapshot,
  applicationId: string,
) {
  const { manifest, parts } = packBackup({ ...s, context: {} }, applicationId);
  const prefix = applicationId.slice(-16);
  const oldKeys: string[] = [];
  let cursor: string | null = null;
  do {
    const existing: {
      node: {
        metafields: {
          nodes: { key: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    } = await graphql<{
      node: {
        metafields: {
          nodes: { key: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(
      domain,
      `
        query ($id: ID!, $cursor: String) {
          node(id: $id) {
            ... on Product {
              metafields(first: 100, after: $cursor, namespace: "seo_aeo") {
                nodes {
                  key
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            ... on Collection {
              metafields(first: 100, after: $cursor, namespace: "seo_aeo") {
                nodes {
                  key
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
      { id: s.id, cursor },
    );
    if (!existing.node) throw new Error("Resource was deleted before backup");
    oldKeys.push(
      ...existing.node.metafields.nodes
        .map((m) => m.key)
        .filter(
          (key) =>
            /^b_[a-z0-9]+_\d+$/.test(key) && !key.startsWith(`b_${prefix}_`),
        ),
    );
    const page = existing.node.metafields.pageInfo;
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  await setMetafields(
    domain,
    s.id,
    parts.map((part, i) => ({ key: `b_${prefix}_${i}`, value: part })),
  );
  await setMetafields(domain, s.id, [
    { key: "backup_latest", value: { ...manifest, prefix } },
  ]);
  // Publish the new manifest first. A retry also discovers orphaned old chunks.
  for (let i = 0; i < oldKeys.length; i += 25)
    await graphql(
      domain,
      `
        mutation ($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            userErrors {
              message
            }
          }
        }
      `,
      {
        metafields: oldKeys
          .slice(i, i + 25)
          .map((key) => ({ ownerId: s.id, namespace: "seo_aeo", key })),
      },
    );
}
export async function writeCore(domain: string, s: Snapshot) {
  if (s.kind === "PRODUCT")
    await graphql(
      domain,
      `
        mutation ($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
            }
            userErrors {
              message
            }
          }
        }
      `,
      {
        product: {
          id: s.id,
          title: s.title,
          descriptionHtml: s.descriptionHtml,
          handle: s.handle,
          seo: s.seo,
        },
      },
    );
  else
    await graphql(
      domain,
      `
        mutation ($collection: CollectionUpdateInput!) {
          collectionUpdate(collection: $collection) {
            collection {
              id
            }
            userErrors {
              message
            }
          }
        }
      `,
      {
        collection: {
          id: s.id,
          title: s.title,
          descriptionHtml: s.descriptionHtml,
          handle: s.handle,
          seo: s.seo,
        },
      },
    );
}
export async function writeImage(
  domain: string,
  s: Snapshot,
  image: Snapshot["images"][number],
) {
  if (s.kind === "COLLECTION")
    await graphql(
      domain,
      `
        mutation ($collection: CollectionUpdateInput!) {
          collectionUpdate(collection: $collection) {
            collection {
              id
            }
            userErrors {
              message
            }
          }
        }
      `,
      {
        collection: {
          id: s.id,
          image: { id: image.id, altText: image.alt || "" },
        },
      },
    );
  else
    await graphql(
      domain,
      `
        mutation ($files: [FileUpdateInput!]!) {
          fileUpdate(files: $files) {
            files {
              id
            }
            userErrors {
              message
            }
          }
        }
      `,
      { files: [{ id: image.id, alt: image.alt || "" }] },
    );
}
export { contentHash };
