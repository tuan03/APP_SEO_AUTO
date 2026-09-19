import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic === "SHOP_REDACT") {
    const store = await db.store.findUnique({ where: { domain: shop } });
    if (store) {
      await db.catalogRow.deleteMany({
        where: {
          jobId: {
            in: (
              await db.scanJob.findMany({
                where: { storeId: store.id },
                select: { id: true },
              })
            ).map((j) => j.id),
          },
        },
      });
      await db.oAuthState.deleteMany({ where: { storeId: store.id } });
      await db.store.delete({ where: { id: store.id } });
    }
    await db.session.deleteMany({ where: { shop } });
  }
  return new Response(null, { status: 200 });
}
