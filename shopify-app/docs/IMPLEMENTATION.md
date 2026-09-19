# SEO/AEO app implementation ledger

Approved scope: public multi-store Shopify app, TypeScript, VPS/Docker, shared Vertex Gemini, merchant approval for knowledge and content, all images, product and collection optimization, FAQ/schema theme extension, Search Console, versioned backup/restore, manual/scheduled/continuous jobs. English UI/content. No merchant billing or operator dashboard.

Architecture: official Shopify React Router template, Prisma/PostgreSQL, BullMQ/Redis worker, deterministic theme JSON-LD, secure crawler. Existing Python prototype remains outside this app.

Progress: local implementation and verification completed; live account/deployment gates remain below.

Ruling: use a new subdirectory and feature branch in the official Shopify template because the workspace was not a Git repository. No existing user files are replaced.
Ruling: production deployment and live Shopify verification require merchant credentials and a VPS that are not present; implement and verify locally, document exact setup and remaining external gates.

## Implemented

| Area                     | Implementation                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation and tenancy | Official Shopify React Router authentication/session storage, encrypted offline/refresh tokens, tenant-scoped database queries, signed webhooks and compliance endpoints                       |
| Catalog                  | Streaming Bulk API staging, paginated live snapshots, products and collections, filters, webhook refresh coalescing, daily reconciliation                                                      |
| Knowledge                | Own HTTPS crawler with robots handling, private-network protection and browser fallback; grounded research; approve/reject/rebase versioned profiles                                           |
| AI generation            | Vertex structured JSON, all product media images, chunked large context, optional approved-knowledge context cache, strict content validation and usage records                                |
| Jobs                     | Per-store BullMQ ticks, persistent checkpoints, selection/filter scans, schedules, rescan policies, pause/resume/cancel/retry                                                                  |
| Review/apply             | Editable whole-version proposals, bulk approval, optimistic revision checks, live conflict confirmation, backup before mutation, recovery from ambiguous writes                                |
| Backup/restore           | Latest backup in `seo_aeo` JSON metafields with chunk manifest/checksum; publish new manifest before cleanup; immutable database history; preserve current URL and image membership on restore |
| Storefront               | FAQ app block, Product/CollectionPage JSON-LD embed and optional visible FAQ schema, sample schema audit                                                                                       |
| Performance              | Google read-only OAuth, daily Search Console ingestion, weighted position and CTR, 28-day periods and before/after apply comparisons                                                           |
| Operations               | Docker web/worker/PostgreSQL/Redis/Caddy, migration gate, health endpoint, environment template and backup/restore runbook                                                                     |

## Verification evidence — 2026-09-19

- 44 automated tests: domain apply/backup, HTML and SSRF protection, database tenant isolation, concurrent schedule/proposal/knowledge approval, pause/cancel checkpoints, initial catalog synchronization gate, restore after URL/image changes, API backup cleanup, weighted analytics, real loader data, and nine dashboard render fixtures.
- TypeScript compilation, ESLint and production web build pass.
- Shopify Theme Check returns `[]` (no offenses).
- 18 GraphQL operations checked against Shopify Admin API `2026-07` using Shopify AI Toolkit. Found and fixed malformed collection bulk query; replaced deprecated collection update argument and revalidated. The variant `image` field remains supported but deprecated; all analysis images come from paginated product media.
- Real local PostgreSQL migration succeeds. Native production web `/health` and landing page return HTTP 200. Worker starts with PostgreSQL/Redis.
- Real Vertex request via TypeScript SDK returns structured `Hello, world!` and usage metadata (233 input, 8 output, 0 cached, 167 thinking on that smoke request).
- Nine dashboard fixtures checked with Playwright/Edge at 1440px and 375px: no horizontal page overflow. These are rendered fixtures, not an authenticated Shopify installation.
- Docker production image builds; development packages are pruned. Container web health returns HTTP 200, container worker starts without connection errors, and bundled Chromium launches successfully. `npm audit --omit=dev` reports zero vulnerabilities at verification time. Full development dependency audit still reports 15 high findings; production audit excludes those tooling dependencies.

One independent review found issues in restore semantics, crawler link discovery, knowledge approval races, job state races, stale backup chunks and refresh starvation. Fixes were applied, with regression tests for the relevant state/data paths. Shopify Toolkit validation additionally caught the bulk collection syntax error.

## External gates / practical limits

- No live Shopify client ID/development store supplied. `shopify app config validate --json` stops because app configuration must first be linked to a real client ID. Install/OAuth/token refresh, real catalog mutations, webhook delivery, theme publication and App Store review remain unverified.
- No Search Console OAuth client/property connected; SQL calculations are tested with fixtures, not an account import.
- No VPS/domain supplied; no production deployment performed.
- No 5k–50k product load test performed. Batch sizes, image/context processing, quota and VPS capacity need validation on a representative development catalog.
- Pause completes the current checkpoint; it does not interrupt an in-flight Gemini request. Crawler default maximum is 40 pages and is configurable. JavaScript rendering only runs when extracted text is sparse.
- Shopify mutations do not provide an atomic transaction across core fields, FAQ and images. Repeated reads detect observed conflicts; an external write between a read and mutation is still possible. The app never claims full transactional isolation on Shopify.
- Schema inspection is sample-based. Theme/app conflicts require merchant review. JSON-LD is assembled deterministically from Shopify/approved FAQ, not arbitrary AI-authored code.
- Backup chunks use a merchant-owned namespace intentionally so recovery data is accessible to the merchant and other recovery tools. Dynamic chunk keys have no per-chunk definitions. Database backups are required for complete history; Shopify metafields retain only the latest snapshot.
- Search comparison windows can be incomplete and do not establish causation. Cost estimates exclude context-cache storage and are not Google invoices.

See [OPERATIONS.md](OPERATIONS.md) for account setup, deployment, backup and the live acceptance checklist.
