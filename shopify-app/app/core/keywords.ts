import { z } from "zod";

export const intentSchema = z.enum([
  "TRANSACTIONAL",
  "COMMERCIAL",
  "INFORMATIONAL",
  "NAVIGATIONAL",
  "UNKNOWN",
]);
const phrase = z.string().trim().min(1).max(200);
export const researchSchema = z.object({
  primary: phrase,
  secondary: z.array(phrase).max(8),
  cluster: phrase,
  intent: intentSchema,
  buyerNeed: z.string().min(1).max(1000),
  rationale: z.string().min(1).max(4000),
  changeScope: z.enum([
    "RETAIN_EXISTING",
    "CLARIFICATION",
    "RETARGETING",
    "UNRESOLVED",
  ]),
  candidates: z
    .array(
      z.object({
        keyword: phrase,
        origin: z.enum(["AGENT_PROPOSED", "GSC", "EXISTING_TARGET"]),
        reason: z.string().min(1).max(2000),
        evidenceIds: z.array(z.string()).min(1).max(30),
      }),
    )
    .min(1)
    .max(8),
  questions: z
    .array(
      z.object({
        question: z.string().max(500),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(10),
  limitations: z.array(z.string().max(2000)).max(20),
});
export type Research = z.infer<typeof researchSchema>;
export type Evidence = {
  id: string;
  kind: "PRODUCT" | "IMAGE" | "GSC" | "WEB" | "EXISTING_TARGET" | "KNOWLEDGE";
  text: string;
  url?: string;
  capturedAt?: string;
};
export type Target = {
  storeId: string;
  resourceId: string;
  kind: string;
  market: string;
  language: string;
  primary: string;
  secondary: string[];
  cluster: string;
  intent: string;
  buyerNeed: string;
};
export function normalizeKeyword(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function keywordKeys(primary: string, secondary: string[]) {
  return [
    ...new Set(
      [primary, ...secondary]
        .map((s) => normalizeKeyword(s).split(" ").sort().join(" "))
        .filter(Boolean),
    ),
  ].sort();
}
export function classifyOverlap(a: Target, b: Target) {
  if (
    a.storeId !== b.storeId ||
    a.resourceId === b.resourceId ||
    a.market !== b.market ||
    a.language !== b.language
  )
    return null;
  const shared = keywordKeys(a.primary, a.secondary).some((k) =>
    keywordKeys(b.primary, b.secondary).includes(k),
  );
  const cluster = normalizeKeyword(a.cluster) === normalizeKeyword(b.cluster);
  if (!shared && !cluster) return null;
  if (a.kind !== b.kind)
    return {
      type: "POSSIBLE_HIERARCHY",
      blocking: false,
      reason:
        "Product and collection may serve different levels of the same buying journey. Verify page roles.",
    };
  if (
    keywordKeys(a.primary, [])[0] === keywordKeys(b.primary, [])[0] &&
    a.intent === b.intent
  )
    return {
      type: "SAME_TARGET",
      blocking: true,
      reason:
        "Same primary keyword and intent on different pages. Choose a preferred page, differentiate using real facts, or explain a legitimate overlap.",
    };
  return shared
    ? {
        type: "SHARED_KEYWORD",
        blocking: false,
        reason:
          "A primary or secondary keyword overlaps. Compare the actual buyer needs before changing either page.",
      }
    : {
        type: "RELATED_TOPIC",
        blocking: false,
        reason:
          "Same topic cluster; this is not proof of competing intent or cannibalization.",
      };
}
export function validateResearch(
  value: unknown,
  evidence: Evidence[],
): Research {
  const result = researchSchema.parse(value);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  for (const item of [...result.candidates, ...result.questions])
    for (const id of item.evidenceIds)
      if (!byId.has(id)) throw Error(`Unknown evidence: ${id}`);
  for (const c of result.candidates) {
    if (
      c.origin === "GSC" &&
      !c.evidenceIds.some(
        (id) =>
          byId.get(id)?.kind === "GSC" &&
          normalizeKeyword(byId.get(id)!.text.split("\n")[0]) ===
            normalizeKeyword(c.keyword),
      )
    )
      throw Error("GSC origin requires matching observed query evidence");
    if (
      c.origin === "EXISTING_TARGET" &&
      !c.evidenceIds.some((id) => byId.get(id)?.kind === "EXISTING_TARGET")
    )
      throw Error("Existing target evidence is missing");
  }
  for (const keyword of [result.primary, ...result.secondary])
    if (
      !result.candidates.some(
        (c) => normalizeKeyword(c.keyword) === normalizeKeyword(keyword),
      )
    )
      throw Error(
        "Every chosen keyword must have a researched candidate and evidence",
      );
  if (
    keywordKeys(result.primary, result.secondary).length !==
    1 + result.secondary.length
  )
    throw Error("Duplicate primary/secondary keywords");
  return result;
}
export const qaSchema = z.object({
  status: z.enum(["PASS", "REVISE", "INCOMPLETE"]),
  summary: z.string().min(1).max(4000),
  issues: z
    .array(
      z.object({
        severity: z.enum(["CRITICAL", "MAJOR", "MINOR", "LIMITATION"]),
        field: z.string().max(100),
        message: z.string().min(1).max(2000),
        evidenceIds: z.array(z.string()),
      }),
    )
    .max(40),
});
export function qaGate(qa: unknown, fingerprint: string): string | null {
  if (!qa || typeof qa !== "object") return "QA is required before approval";
  const q = qa as {
    fingerprint?: string;
    status?: string;
    issues?: { severity: string; message: string }[];
  };
  if (q.fingerprint !== fingerprint)
    return "Content or research changed; run QA again";
  const blocking = q.issues?.find((i) =>
    ["CRITICAL", "MAJOR"].includes(i.severity),
  );
  if (blocking) return `QA: ${blocking.message}`;
  if (q.status !== "PASS")
    return "QA has not passed; review the research and issues";
  return null;
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function evidenceLevel(
  candidate: { keyword: string; evidenceIds: string[] },
  evidence: Evidence[],
) {
  const refs = evidence.filter((e) => candidate.evidenceIds.includes(e.id));
  if (
    refs.some(
      (e) =>
        e.kind === "GSC" &&
        normalizeKeyword(e.text.split("\n")[0]) ===
          normalizeKeyword(candidate.keyword),
    )
  )
    return "GSC_OBSERVED";
  return refs.some((e) => e.kind === "WEB") ? "WEB_CONTEXT" : "HYPOTHESIS_ONLY";
}
