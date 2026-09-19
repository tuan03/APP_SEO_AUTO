import { expect, it } from "vitest";
import { validateResearch, type Evidence } from "../app/core/keywords";
const evidence: Evidence[] = [
  {
    id: "product",
    kind: "PRODUCT",
    text: "A rectangular rug with a printed ghost design",
  },
  { id: "gsc", kind: "GSC", text: "ghost rug\n100 impressions" },
];
const plan = {
  primary: "ghost print rug",
  secondary: [],
  cluster: "halloween rugs",
  intent: "TRANSACTIONAL",
  buyerNeed: "Choose a ghost print rug",
  rationale: "Matches the design",
  changeScope: "CLARIFICATION",
  candidates: [
    {
      keyword: "ghost print rug",
      origin: "AGENT_PROPOSED",
      reason: "Matches design and proposed task",
      evidenceIds: ["product"],
      scenarioIds: ["entryway"],
    },
  ],
  questions: [],
  limitations: [],
  buyerScenarios: [
    {
      id: "entryway",
      situation: "Decorating an entryway for Halloween",
      desiredOutcome: "Add a ghost design to the room",
      decisionQuestions: ["What dimensions fit my space?"],
      evidenceIds: ["product"],
      status: "HYPOTHESIS",
      uncertainty: "No customer testimony is available",
    },
  ],
};
it("retains a traceable buyer scenario and its candidate references", () => {
  const result = validateResearch(plan, evidence, true);
  expect(result.buyerScenarios?.[0].desiredOutcome).toBe(
    "Add a ghost design to the room",
  );
  expect(result.candidates[0].scenarioIds).toEqual(["entryway"]);
});
it("does not treat GSC queries or product facts as customer testimony", () => {
  expect(() =>
    validateResearch(
      {
        ...plan,
        buyerScenarios: [
          {
            ...plan.buyerScenarios[0],
            status: "CUSTOMER_SUPPORTED",
            evidenceIds: ["product", "gsc"],
          },
        ],
      },
      evidence,
      true,
    ),
  ).toThrow(/customer/i);
});
it("rejects broken scenario references and duplicate scenario IDs", () => {
  expect(() =>
    validateResearch(
      {
        ...plan,
        candidates: [{ ...plan.candidates[0], scenarioIds: ["invented"] }],
      },
      evidence,
      true,
    ),
  ).toThrow(/scenario/i);
  expect(() =>
    validateResearch(
      {
        ...plan,
        buyerScenarios: [plan.buyerScenarios[0], plan.buyerScenarios[0]],
      },
      evidence,
      true,
    ),
  ).toThrow(/scenario/i);
});
it("requires product fit evidence rather than web marketing claims alone", () => {
  expect(() =>
    validateResearch(
      {
        ...plan,
        buyerScenarios: [{ ...plan.buyerScenarios[0], evidenceIds: ["web"] }],
      },
      [...evidence, { id: "web", kind: "WEB", text: "Popular decor category" }],
      true,
    ),
  ).toThrow(/product/i);
});
it("reads legacy research but requires scenarios for new generation", () => {
  const legacy = {
    ...plan,
    buyerScenarios: undefined,
    candidates: [{ ...plan.candidates[0], scenarioIds: undefined }],
  };
  expect(() => validateResearch(legacy, evidence)).not.toThrow();
  expect(() => validateResearch(legacy, evidence, true)).toThrow(/scenario/i);
});
