import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const defaults = {
  titleMax: 120,
  seoTitleMax: 60,
  seoDescriptionMax: 160,
  wordsMin: 600,
  wordsMax: 1000,
  faqMin: 5,
  faqMax: 8,
  notes: "",
  tone: "Clear, helpful and factual",
};
export const settingsSchema = z
  .object({
    titleMax: z.number().int().min(20).max(255).default(120),
    seoTitleMax: z.number().int().min(20).max(70).default(60),
    seoDescriptionMax: z.number().int().min(50).max(320).default(160),
    wordsMin: z.number().int().min(0).max(3000).default(600),
    wordsMax: z.number().int().min(50).max(5000).default(1000),
    faqMin: z.number().int().min(0).max(20).default(5),
    faqMax: z.number().int().min(0).max(20).default(8),
    notes: z.string().max(4000).default(""),
    tone: z.string().max(200).default(defaults.tone),
  })
  .refine(
    (s) => s.wordsMin <= s.wordsMax && s.faqMin <= s.faqMax,
    "Minimum must not exceed maximum",
  );

export const contentSchema = z.object({
  title: z.string().min(1).max(255),
  descriptionHtml: z.string().min(1).max(200000),
  seoTitle: z.string().min(1).max(70),
  seoDescription: z.string().min(1).max(320),
  faqs: z
    .array(
      z.object({
        question: z.string().min(1).max(500),
        answer: z.string().min(1).max(3000),
      }),
    )
    .max(20),
  imageAlts: z.array(
    z.object({ id: z.string(), alt: z.string().min(1).max(500) }),
  ),
  facts: z.array(z.object({ claim: z.string(), source: z.string() })),
  warnings: z.array(z.string()),
  knowledgeSuggestions: z.array(
    z.object({ claim: z.string(), source: z.string(), reason: z.string() }),
  ),
});
export type Content = z.infer<typeof contentSchema>;
export interface Snapshot {
  id: string;
  kind: "PRODUCT" | "COLLECTION";
  title: string;
  descriptionHtml: string;
  handle: string;
  seo: { title: string | null; description: string | null };
  faqs: Content["faqs"];
  images: { id: string; url: string; alt: string | null }[];
  context: Record<string, unknown>;
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
export const targetFields = (s: Snapshot) => ({
  title: s.title,
  descriptionHtml: s.descriptionHtml,
  handle: s.handle,
  seo: s.seo,
  faqs: s.faqs,
  images: s.images
    .map(({ id, alt }) => ({ id, alt }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});
export const contentHash = (s: Snapshot) => hash(targetFields(s));
export function sourceHash(s: Snapshot) {
  const ctx = s.context as {
    status?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
    variants?: Record<string, unknown>[];
    collections?: Record<string, unknown>[];
    metafields?: Record<string, unknown>[];
  };
  const sorted = (items: unknown[]) =>
    items.sort((a, b) =>
      JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))),
    );
  return hash({
    ...targetFields(s),
    images: sorted(
      s.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt || "" })),
    ),
    context: {
      status: ctx.status || "",
      vendor: ctx.vendor || "",
      productType: ctx.productType || "",
      tags: [...(ctx.tags || [])].sort(),
      variants: sorted(
        (ctx.variants || []).map((v) => ({
          id: v.id,
          title: v.title,
          sku: v.sku,
          price: v.price,
          selectedOptions: v.selectedOptions,
        })),
      ),
      collections: sorted(
        (ctx.collections || []).map((c) => ({ id: c.id, title: c.title })),
      ),
      metafields: sorted(
        (ctx.metafields || []).map((m) => ({
          namespace: m.namespace,
          key: m.key,
          value: m.value,
          type: m.type,
        })),
      ),
    },
  });
}
export function validateContent(
  value: unknown,
  snapshot: Snapshot,
  settings: unknown = {},
) {
  const content = contentSchema.parse(value),
    limits = settingsSchema.parse(settings);
  for (const [key, limit] of [
    ["title", limits.titleMax],
    ["seoTitle", limits.seoTitleMax],
    ["seoDescription", limits.seoDescriptionMax],
  ] as const) {
    if ([...content[key]].length > limit)
      throw new Error(`${key} exceeds ${limit} characters`);
  }
  const cleaned = sanitizeHtml(content.descriptionHtml, {
    allowedTags: [
      "p",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "br",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {},
  });
  if (cleaned !== content.descriptionHtml)
    throw new Error(
      "Description contains unsupported or unsafe HTML. Remove scripts, links, styles and attributes.",
    );
  const ids = new Set(snapshot.images.map((i) => i.id));
  if (
    new Set(content.imageAlts.map((i) => i.id)).size !== ids.size ||
    content.imageAlts.length !== ids.size ||
    content.imageAlts.some((i) => !ids.has(i.id))
  )
    throw new Error("Alt text must cover every image exactly once");
  if (content.faqs.length > limits.faqMax)
    throw new Error("Too many FAQ entries");
  const words = cleaned
    .replace(/<[^>]*>/g, " ")
    .trim()
    .split(/\s+/).length;
  if (words > limits.wordsMax)
    throw new Error("Description exceeds word limit");
  if (words < limits.wordsMin || content.faqs.length < limits.faqMin)
    content.warnings = [
      ...new Set([
        ...content.warnings,
        "Below target length or FAQ count; verify enough source facts are available.",
      ]),
    ];
  return content;
}
export function withContent(s: Snapshot, c: Content): Snapshot {
  return {
    ...s,
    title: c.title,
    descriptionHtml: c.descriptionHtml,
    seo: { title: c.seoTitle, description: c.seoDescription },
    faqs: c.faqs,
    images: s.images.map((i) => ({
      ...i,
      alt: c.imageAlts.find((a) => a.id === i.id)!.alt,
    })),
  };
}
export function eligible(
  rule: string,
  r: {
    lastScannedAt: Date | null;
    sourceHash: string;
    scannedHash: string | null;
    lastAppliedHash: string | null;
  },
  days = 30,
  now = new Date(),
) {
  if (rule === "ALL") return true;
  if (!r.lastScannedAt) return true;
  if (rule === "CHANGED")
    return r.sourceHash !== r.scannedHash && r.sourceHash !== r.lastAppliedHash;
  if (rule === "AGED")
    return r.lastScannedAt.getTime() <= now.getTime() - days * 86400000;
  return false;
}
