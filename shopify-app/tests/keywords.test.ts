import { expect, it } from "vitest";
import {
  normalizeKeyword,
  keywordKeys,
  classifyOverlap,
  validateResearch,
  qaGate,
  evidenceLevel,
  csvCell,
} from "../app/core/keywords";

const a = {
  storeId: "a",
  resourceId: "p1",
  market: "USA",
  language: "en",
  kind: "PRODUCT",
  primary: "Ghost print rug",
  secondary: [],
  cluster: "halloween rugs",
  intent: "TRANSACTIONAL",
  buyerNeed: "Buy a ghost print rug",
};
it("detects case, punctuation and reordered keyword overlap without merging distinct designs", () => {
  expect(normalizeKeyword("  GHOST–print   RUG ")).toBe("ghost print rug");
  expect(keywordKeys("print rug ghost", [])).toEqual(
    keywordKeys(a.primary, []),
  );
  expect(
    classifyOverlap(a, { ...a, resourceId: "p2", primary: "ghost print rug" })
      ?.type,
  ).toBe("SAME_TARGET");
  expect(
    classifyOverlap(a, { ...a, resourceId: "p2", primary: "Pumpkin print rug" })
      ?.type,
  ).toBe("RELATED_TOPIC");
});
it("keeps stores, languages, markets and versions of the same page separate", () => {
  for (const change of [
    { storeId: "b" },
    { market: "GBR" },
    { language: "fr" },
    {},
  ])
    expect(classifyOverlap(a, { ...a, ...change })).toBeNull();
});
it("labels product/collection overlap as possible hierarchy, not proven cannibalization", () => {
  expect(
    classifyOverlap(a, { ...a, resourceId: "c", kind: "COLLECTION" })?.type,
  ).toBe("POSSIBLE_HIERARCHY");
});
it("finds a primary competing with another page's secondary keyword", () => {
  expect(
    classifyOverlap(a, {
      ...a,
      resourceId: "p2",
      primary: "Halloween mat",
      cluster: "other",
      secondary: ["ghost print rug"],
    })?.type,
  ).toBe("SHARED_KEYWORD");
});
it("does not accept fabricated evidence references in research", () => {
  expect(() =>
    validateResearch(
      {
        primary: "rug",
        secondary: [],
        cluster: "rug",
        intent: "TRANSACTIONAL",
        buyerNeed: "Buy rug",
        rationale: "Relevant",
        changeScope: "CLARIFICATION",
        candidates: [
          {
            keyword: "rug",
            origin: "AGENT_PROPOSED",
            reason: "Relevant",
            evidenceIds: ["invented"],
          },
        ],
        questions: [],
        limitations: [],
      },
      [{ id: "source", kind: "PRODUCT", text: "rug" }],
    ),
  ).toThrow(/evidence/i);
});
it("requires current QA and blocks major issues even when another criterion looks good", () => {
  expect(qaGate(null, "revision-a")).toContain("QA");
  expect(
    qaGate({ fingerprint: "old", status: "PASS", issues: [] }, "new"),
  ).toContain("changed");
  expect(
    qaGate(
      {
        fingerprint: "same",
        status: "PASS",
        issues: [{ severity: "MAJOR", message: "Wrong buying intent" }],
      },
      "same",
    ),
  ).toContain("Wrong buying intent");
  expect(
    qaGate({ fingerprint: "same", status: "PASS", issues: [] }, "same"),
  ).toBeNull();
});

it("does not label a proposed keyword as observed just because it cites a different GSC query", () => {
  expect(
    evidenceLevel({ keyword: "blue ghost rug", evidenceIds: ["gsc:1"] }, [
      { id: "gsc:1", kind: "GSC", text: "ghost rug\n{impressions:100}" },
    ]),
  ).toBe("HYPOTHESIS_ONLY");
  expect(
    evidenceLevel({ keyword: "Ghost Rug", evidenceIds: ["gsc:1"] }, [
      { id: "gsc:1", kind: "GSC", text: "ghost rug\n{impressions:100}" },
    ]),
  ).toBe("GSC_OBSERVED");
});
it("exports readable CSV without executing spreadsheet formulas", () => {
  expect(csvCell('=HYPERLINK("https://example.com")')).toBe(
    '"\'=HYPERLINK(""https://example.com"")"',
  );
  expect(csvCell("Ghost, rug")).toBe('"Ghost, rug"');
});
