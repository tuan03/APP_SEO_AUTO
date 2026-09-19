import db from "../db.server";
import { authenticate } from "../shopify.server";
export async function tenant(request: Request) {
  const auth = await authenticate.admin(request);
  const store = await db.store.upsert({
    where: { domain: auth.session.shop },
    create: { domain: auth.session.shop },
    update: {},
  });
  if (!store.active)
    throw new Response("Store is not active. Reinstall the app.", {
      status: 403,
    });
  return {
    ...auth,
    store,
    actor: String(
      auth.sessionToken?.sub ||
        auth.session.onlineAccessInfo?.associated_user.id ||
        auth.session.id,
    ),
  };
}
export async function audit(
  storeId: string,
  actor: string,
  event: string,
  target?: string,
) {
  await db.audit.create({ data: { storeId, actor, event, target } });
}
