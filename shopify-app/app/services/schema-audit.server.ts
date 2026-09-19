import db from "../db.server";
import { safeGet, extractPage } from "./crawl.server";
export async function schemaAudit(storeId: string) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.website) throw Error("Sync catalog first");
  const r = await db.resource.findFirst({
    where: { storeId, kind: "PRODUCT", deleted: false },
  });
  const url = r
    ? `${store.website.replace(/\/$/, "")}/products/${r.handle}`
    : store.website;
  const page = await safeGet(url, new Set([new URL(store.website).hostname]));
  const extracted = extractPage(page.body.toString(), url);
  return {
    url,
    checkedAt: new Date().toISOString(),
    schemaCount: extracted.schemas.length,
    schemas: extracted.schemas.map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return "Invalid JSON-LD";
      }
    }),
    appSchemaDetected: page.body.toString().includes('id="seo-aeo-schema"'),
    faqDetected: page.body.toString().includes('class="seo-aeo-faq"'),
  };
}
