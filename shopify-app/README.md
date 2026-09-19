# Shopify SEO / AEO Workspace

App Shopify embedded b?ng TypeScript, React Router, PostgreSQL v? Redis. M? ngu?n n?m ??c l?p v?i prototype Python ? th? m?c cha.

## Ch?c n?ng

- Dashboard s?n ph?m/collection, t?m ki?m v? b? l?c; ??ng b? Shopify Bulk API, c?p nh?t qua webhook v? ??i so?t h?ng ng?y.
- Qu?t m?c ?? ch?n ho?c to?n b? k?t qu? l?c; l?ch m?t l?n/ng?y/tu?n/th?ng v? ch? ?? ki?m tra h?ng ng?y. Quy t?c qu?t l?i: ch?a qu?t, ngu?n thay ??i, qu? N ng?y ho?c t?t c?.
- Crawler ri?ng + Google Search grounding t?o h? s? ki?n th?c store. Ch? d?ng b?n ?? duy?t; l?u ?? xu?t b? sung th?nh phi?n b?n ri?ng.
- Vertex Gemini ph?n t?ch m?i ?nh trong catalog media, t?o title, description HTML, SEO title/description, FAQ v? alt text. Ghi token input/output/cache/thinking v? gi? ??c t?nh theo c?u h?nh.
- Review/s?a/duy?t to?n b? phi?n b?n, duy?t h?ng lo?t, ki?m tra conflict tr??c khi ghi Shopify.
- Backup tr??c khi ghi, ti?p t?c t?c v? apply d? dang, l?ch s? v? restore. Gi? handle hi?n t?i khi restore; kh?ng t?i t?o s?n ph?m/?nh ?? x?a.
- Theme extension FAQ v? JSON-LD, ki?m tra schema tr?n trang m?u.
- Search Console OAuth, nh?p metrics v? so s?nh tr??c/sau t?ng apply.

## Ch?y local

Y?u c?u Node 22.12+ v? Docker Desktop. T? th? m?c n?y:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Ch? copy `.env` n?u ch?a c? file. File local ?? t?o trong phi?n tri?n khai n?y; secret kh?ng ???c ??a v?o Git.

?i?n `.env`:

- `DATABASE_URL=postgresql://seo:local-development-only@localhost:5433/seo`
- `REDIS_URL=redis://127.0.0.1:6380`
- `ENCRYPTION_KEY`: 32 byte d?ng base64; h??ng d?n t?o trong t?i li?u v?n h?nh.
- Client ID/secret app Shopify th?t.
- Project Vertex m?c ??nh: `gemini-image-benchmark`; model: `gemini-3.8-flash`.
- B? `GOOGLE_APPLICATION_CREDENTIALS` n?u d?ng ADC local qua gcloud.

```powershell
docker compose -f compose.dev.yml up -d
npm run setup
npx playwright install chromium
npm run dev
```

M? terminal th? hai:

```powershell
npm run worker
```

`npm run dev` d?ng Shopify CLI ?? li?n k?t app, t?o tunnel v? m? trong Shopify Admin. C?n development store v? client ID th?t. `npm run dev:local` ch? kh?i ??ng web; kh?ng b? qua x?c th?c Shopify.

Lu?ng ??u ti?n: **Sync catalog ? Build store knowledge ? Approve knowledge ? Scan ? Review ? Approve ? History**.

## Ki?m tra

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx shopify theme check --path extensions/seo-aeo --output json
npx tsx --env-file=.env scripts/smoke.ts --gemini
```

`npm test` c? test t?ch h?p PostgreSQL: b?t Compose local tr??c. Fixture ri?ng ???c t?o/x?a theo UUID, kh?ng c?n Shopify token. Test UI xu?t HTML v?o `test-results/ui`; ch?y `node scripts/ui-smoke.mjs` sau khi c?i Chromium ?? ki?m tra desktop/mobile. Tr?n m?y ?? c?i Edge c? th? ??t `BROWSER_CHANNEL=msedge`.

L?nh smoke Gemini g?i API th?t, c? t?nh ph?. C?c ki?m th? c?n l?i kh?ng g?i d? li?u l?n Gemini ho?c ghi v?o Shopify.

## C?u tr?c

| Th? m?c                        | Vai tr?                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `app/core`                     | Ki?m tra n?i dung, hash, backup, c? ch? apply, merge ki?n th?c |
| `app/services`                 | Shopify/Vertex/crawler/GSC, job v? tenant boundary             |
| `app/routes`, `app/components` | Dashboard v? c?c endpoint OAuth/webhook                        |
| `worker`                       | BullMQ scheduler v? x? l? theo store                           |
| `prisma`                       | Schema PostgreSQL v? migration                                 |
| `extensions/seo-aeo`           | FAQ block v? schema embed                                      |
| `tests`                        | Domain, security, database, API backup v? render UI            |

Xem [tri?n khai/v?n h?nh](docs/OPERATIONS.md) v? [k?t qu? ki?m tra, gi?i h?n](docs/IMPLEMENTATION.md).

## Tr?ng th?i

?? c? b?n tri?n khai local. Ch?a c?i l?n store th?t, ch?a k?t n?i GSC th?t v? ch?a deploy VPS v? ch?a c? client ID/store/domain/credentials t??ng ?ng. Kh?ng coi k?t qu? test local l? ch?ng nh?n s?n s?ng cho 50.000 s?n ph?m ho?c ?? qua Shopify App Store review.
