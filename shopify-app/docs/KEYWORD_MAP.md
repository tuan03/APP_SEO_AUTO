# Store keyword map and intent research

## Agreed intent
Upgrade the existing Shopify app with a persistent, tenant-isolated keyword map.
Research must consider actual product facts, buyer tasks, the store's existing and
pending targets, and available search evidence. Similar words alone do not prove
cannibalization. Merchants approve content; the app never silently retargets another
product to resolve a collision.

## Design
- Database is the source of truth; dashboard and CSV are views of it.
- Versioned targets distinguish inferred catalog baselines, proposals, applied targets,
  and archived history. Baselines inferred from titles are explicitly unverified.
- Market and language scope every target. GSC observations remain separate from
  intended targets. Missing GSC data is not zero demand.
- Research records buyer intent, supporting evidence, candidate keywords, reasons,
  rejected alternatives, and limitations. Grounded web findings are not claimed to
  be a controlled SERP sample or keyword volume.
- Indexed primary/secondary keyword signatures and topic clusters find potential
  overlaps. The merchant records a reason to accept a legitimate overlap, or rejects
  and rescans the proposal. Pair-specific decisions do not authorize future revisions.
- Store row locks serialize map publication and approval. Approval rechecks the live
  map; application success activates targets. Reject/archive/restore retain history.
- Independent content QA reads source evidence and the proposal. Deterministic gates
  bind QA to the content/research revision; unsupported claims and unresolved intent
  errors block approval. This is an editorial gate, not a ranking score.
- Existing selected/filter/scheduled scans, whole-version approval, backup and restore
  remain the operating flow. English output; target country is explicitly configured.

## Implementation sequence
1. Add tested keyword normalization, overlap classification, research evidence and QA gates.
2. Add additive migrations for targets, decisions, proposal research/QA and GSC query rows.
3. Implement catalog baseline indexing, map lookup, serialized decisions and lifecycle.
4. Integrate per-resource research and independent QA into checkpointed scans and approval.
5. Add keyword dashboard, filters, history, CSV export, decisions and review evidence.
6. Verify unit/database lifecycle tests, typecheck, lint and production build.

## Boundaries
No ranking guarantee. No exhaustive semantic collision guarantee: indexed cluster and
keyword checks expose their scope. GSC returns available query rows, not every query.
No live Shopify writes or paid model benchmark as part of local implementation.
Full six-sheet workbook parity, browser-rendered storefront QA and independent visual
reinspection of every image are separate from this keyword-map upgrade.

## Use the upgrade
1. Run `npm run setup` in `shopify-app` on each deployed environment, then restart web
   and worker. The additive migration retains existing proposals and history.
2. Settings → choose target country, e.g. `USA` or `GBR` (ISO alpha-3). `GLOBAL`
   explicitly means unspecified country, not validated worldwide search demand.
3. Sync catalog. Keyword map → Index / reconcile entire catalog. New scans also
   queue prerequisite indexing automatically if any live page lacks a baseline.
4. Connect Search Console and sync queries. Query rows use page/query/country/device
   separately from aggregate performance totals. The first query sync backfills up
   to 90 days; subsequent syncs refresh seven days. The API returns available top
   rows, not guaranteed complete query inventory:
   https://developers.google.com/webmaster-tools/v1/searchanalytics/query
5. Approve store knowledge, then scan selected/filtered products or collections.
   Review shows buyer need, candidates, sources, hypotheses, limitations and QA.
6. Exact same-primary/same-intent overlaps require a merchant decision in Keyword
   Map. Keep legitimate distinct intent/hierarchy with a reason, or edit the saved
   proposal strategy/content and run QA again. No automatic rewrite of other pages.
7. A description can be kept byte-for-byte to retain rich images/links. Rewrites
   still use the supported safe HTML subset. Do not pad content to meet a target.
8. Approve only the saved version. Targets become ACTIVE only after verified apply.
   Edits invalidate QA and pair decisions. Retryable applications prevent editing
   their proposal. Restore archives the applied strategy and creates an unverified
   baseline for the restored content; it does not invent a historical keyword intent.

## Interpretation and operational limits
- BASELINE = inference from existing title/SEO title; PROPOSED = researched draft;
  APPROVED = waiting for application; ACTIVE = applied; ARCHIVED/REJECTED = history.
- GSC_OBSERVED requires an exact normalized primary-query match. WEB_CONTEXT means
  cited web context, not controlled SERP validation or verified keyword volume.
- Dashboard overlap counts are bounded previews (25 matches per row); detail pages
  paginate 100 matches. Approval checks all pages, failing closed on database errors.
- QA is a separate model call with deterministic revision/evidence gates. It is not
  the ZIP's full visual 100-point rubric and cannot guarantee absence of model errors.
- Research evidence is snapshotted text and saved image observations; image binaries
  are not archived. Query lookup currently matches the configured canonical page URL;
  alternate locale/domain URLs may report unavailable evidence.
- No paid keyword-volume provider or rank tracker is configured. Grounded search
  cannot establish controlled country ranking positions. Source absence is disclosed.
- Existing legacy proposals are retained and marked legacy in Review. Rescan them
  for the new intent/QA flow. Country changes require new research before approval.
- The new flow uses additional model/search calls and records them in Usage. One
  automatic correction attempt is allowed; remaining issues require review.
- Local validation uses deterministic tests and isolated database fixtures. Live
  Shopify/GSC/model quality and a 50,000-product load test remain deployment checks.

## Intent research v3: buyer scenarios
New scans create 1–3 buying scenarios with a situation, desired outcome, decision
questions, product-fit evidence and uncertainty. Each candidate keyword references
the scenario(s) it serves. Review displays this chain before QA and approval.

The application rejects missing scenario links, duplicate IDs and scenarios without
product/image support. Product facts and GSC queries are not customer testimony.
`CUSTOMER_SUPPORTED` requires a separately sourced CUSTOMER evidence record; the
current collection pipeline does not ingest such records, so current buyer motivations
remain `HYPOTHESIS`. This distinction is deliberate. Real customer-source ingestion
and validation remain on the continuous-upgrade roadmap.

Existing research stays readable. New scans invalidate pre-v3 research checkpoints;
edits and QA enforce the new contracts on v3 records. No database migration is needed
for this increment, since versioned research is persisted as JSON.
