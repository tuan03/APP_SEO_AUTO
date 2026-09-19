import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const event =
    request.headers.get("x-shopify-event-id") ||
    request.headers.get("x-shopify-webhook-id");
  if (!event) return new Response("Missing webhook ID", { status: 400 });
  const store = await db.store.findUnique({ where: { domain: shop } });
  if (!store?.active) return new Response();
  try {
    await db.$transaction(async (tx) => {
      await tx.webhookReceipt.create({ data: { id: event } });
      const kind = topic.startsWith("PRODUCTS") ? "Product" : "Collection";
      const gid =
        payload.admin_graphql_api_id || `gid://shopify/${kind}/${payload.id}`;
      if (topic.endsWith("DELETE"))
        await tx.resource.updateMany({
          where: { storeId: store.id, gid },
          data: { deleted: true },
        });
      else {
        await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${store.id} FOR UPDATE`;
        const existing = await tx.scanJob.findFirst({
          where: {
            storeId: store.id,
            type: "REFRESH",
            status: "QUEUED",
            filter: { path: ["gid"], equals: gid },
          },
        });
        if (existing) return;
        await tx.scanJob.create({
          data: {
            storeId: store.id,
            actor: "webhook",
            type: "REFRESH",
            filter: { gid },
          },
        });
      }
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
  return new Response();
}
