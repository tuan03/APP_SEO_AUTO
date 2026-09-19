import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const store = await db.store.findUnique({ where: { domain: shop } });
  if (store) {
    await db.store.update({
      where: { id: store.id },
      data: { active: false, gscToken: null },
    });
    await db.schedule.updateMany({
      where: { storeId: store.id },
      data: { active: false },
    });
    await db.scanJob.updateMany({
      where: {
        storeId: store.id,
        status: { in: ["QUEUED", "RUNNING", "PAUSED"] },
      },
      data: { status: "CANCELED" },
    });
    await db.application.updateMany({
      where: { storeId: store.id, status: "QUEUED" },
      data: { status: "CANCELED" },
    });
  }

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
