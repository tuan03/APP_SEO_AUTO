# Continuous SEO/AEO upgrade goal

User objective: continuously improve this system and commit each upgrade so stores
can optimize products for SEO/AEO, understand buyer needs, and choose suitable keywords.
This remains an active goal. A green software suite alone does not demonstrate content
quality, rankings, customer understanding or operational readiness on a live store.

## Acceptance evidence and remaining work
| Capability | Current evidence | Required next evidence |
|---|---|---|
| Store keyword map, versioning, overlaps | Unit/DB tests and dashboard; d017b34 | Catalog-scale benchmark and semantic overlap evaluation |
| Intent and buyer needs | Per-resource research and cited candidates | Structured buyer scenarios, source attribution, real customer signals with consent/scope |
| Product and image evidence | Admin snapshots and saved visual observations | Description/variant image coverage, immutable image evidence, contradictions, per-claim source links |
| Keyword suitability | Fact-based hypotheses, grounded web context, exact GSC observations | Page-type/market validation and comparison candidates with independently inspectable evidence |
| SEO/AEO content | Title/meta/body/FAQ/alt generation and independent text QA | Fact-preservation benchmarks, answer usefulness, full visual QA with coverage-aware rubric |
| Shopify application | Approval, backup, conflict checks, retry/restore tests | Development-store end-to-end test, rendered page inspection, no duplicate schema/FAQ mismatch |
| Effectiveness | Page-level historical metrics | Query cohorts, country/device comparability, deployment annotations, insufficient-data handling |
| Reliability/cost | Usage accounting, checkpointed queues | Stage checkpoint recovery, full catalog load/cost benchmark, bounded retries |

## Iteration policy
Each implemented upgrade gets tests appropriate to its risks, review, a descriptive
commit, and a factual update here. Preserve the original goal across turns. Never infer
psychology from a search query as a fact, invent customer quotes, or equate a model QA
score with Google rankings. Real credentials/data may be needed for final live gates;
continue independent engineering work while such gates remain unavailable.

## Next upgrade: buyer-scenario traceability
Extend existing research with 1–3 fact-grounded buying situations, desired outcomes,
decision questions and uncertainties. Every candidate must reference a scenario for
new research. Distinguish hypotheses from actual customer evidence. Product facts and
GSC queries cannot alone establish customer testimony. Enforce provenance in code,
show scenarios in Review, and invalidate checkpoints when the research version changes.

## Completed increments
- `d017b34`: store keyword map, query observations, overlap decisions, QA gates and
  safe target lifecycle. 62 tests passed; typecheck/lint/build passed.
- Buyer scenarios / intent-v3: source-linked buying situations, desired outcomes,
  decision questions and uncertainty; required candidate-to-scenario links; strict
  customer-testimony provenance. 67 tests passed; typecheck/lint/build passed.
  This improves reasoning transparency, but actual customer feedback ingestion is
  still absent. Next priority is approved customer-source input with market/product
  scope and verbatim/paraphrase provenance, followed by image evidence completeness.
