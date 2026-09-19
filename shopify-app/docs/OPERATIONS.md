# Vận hành và triển khai

## Cài vào development store

1. Tạo hoặc chọn app trong Shopify Dev Dashboard. App dùng phân phối public; thử trước trên development store.
2. Trong thư mục `shopify-app`, chạy `npm run config:link -- --client-id <client-id>` để liên kết app thật. Giữ lại scopes, các webhook catalog/compliance trong cấu hình hiện tại khi hợp nhất cấu hình CLI tải về.
3. Điền `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` trong `.env`. `SHOPIFY_API_KEY` là client ID. Không đưa secret vào Git.
4. Chạy `npm run dev` để tạo tunnel, cài app và mở trong Shopify Admin. Chạy `npm run worker` ở terminal riêng.
5. Chạy `npm exec shopify app config validate -- --json` sau khi liên kết. Cấu hình chưa có client ID sẽ chưa qua bước này.
6. Trong app: **Sync catalog → Build store knowledge → Review knowledge → Approve → Products/Collections → Create scan job → Review → Approve**.
7. Vào theme editor, thêm block **SEO/AEO FAQ**. Bật app embed **SEO/AEO Schema** chỉ sau khi kiểm tra và xử lý schema trùng từ theme/app khác. App không tự sửa mã theme.

`npm run deploy` phát hành cấu hình Shopify và extension; lệnh này **không deploy web server hoặc worker**.

## Keyword Map và nghiên cứu intent

Bản nâng cấp thêm migration database; chạy `npm run setup` rồi khởi động lại web/worker.
Trong **Settings**, đặt thị trường bằng mã quốc gia 3 chữ (`USA`, `GBR`...).
Vào **Keyword map** để lập bản đồ catalog, xem chồng lặp, ghi quyết định xử lý và xuất CSV.
Luồng scan mới tạo hồ sơ intent/keyword và QA độc lập trước khi bạn duyệt. Sửa nội dung
hoặc chiến lược cần chạy lại QA; keyword chỉ thành ACTIVE sau khi áp dụng thành công.
Các đề xuất cũ cần quét lại để có hồ sơ mới. Xem [KEYWORD_MAP.md](KEYWORD_MAP.md)
để biết cách dùng, nguồn dữ liệu và giới hạn kiểm chứng.

## Google Cloud / Vertex AI

Đã đặt mặc định project `gemini-image-benchmark`, region `global`, model `gemini-3.8-flash`.

- Local: dùng Application Default Credentials đã đăng nhập. Bỏ `GOOGLE_APPLICATION_CREDENTIALS` khỏi `.env` nếu dùng ADC của `gcloud`.
- VPS: đặt credentials của service account có quyền gọi Vertex vào `secrets/google-adc.json`; Compose mount chỉ đọc tại `/run/secrets/google-adc.json`. Project cần bật Vertex AI và billing.
- GSC dùng OAuth web client riêng: điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://<domain>/google/callback`. Bật Search Console API và cấu hình consent screen/users phù hợp. Sau đó kết nối trong Settings và chọn property đúng domain store.
- Token input đã bao gồm cached input. Output hiển thị riêng với thinking. Giá ước tính tính phần input không cache, cached input, output + thinking, và số search query được báo cáo. Chưa tính phí lưu context cache; số search query không thay thế hóa đơn Google. Để trống giá sẽ hiển thị không có ước tính. Không có cơ chế tự dừng theo ngân sách.

## Deploy lên VPS Linux

Chuẩn bị Docker Compose, domain trỏ về VPS và cổng 80/443. Caddy tự cấp HTTPS. PostgreSQL và Redis chỉ nằm trong mạng Docker.

1. Copy repository lên VPS và tạo `.env` từ `.env.example`.
2. Tạo mật khẩu PostgreSQL mạnh, rồi đặt:

   ```dotenv
   POSTGRES_PASSWORD=<password>
   DATABASE_URL=postgresql://seo:<URL-encoded-password>@postgres:5432/seo
   REDIS_URL=redis://redis:6379
   APP_DOMAIN=<domain>
   SHOPIFY_APP_URL=https://<domain>
   GOOGLE_REDIRECT_URI=https://<domain>/google/callback
   GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-adc.json
   ```

3. Tạo `ENCRYPTION_KEY` bằng `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Lưu an toàn cùng backup. Không đổi key tùy tiện: session Shopify và Google token đang được mã hóa bằng key này.
4. Đặt client ID, secret Shopify, Google OAuth và file service account. Sửa URL production trong `shopify.app.toml` và liên kết đúng app.
5. Chạy:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 web worker migrate
   curl --fail https://<domain>/health
   ```

6. Từ máy đã đăng nhập Shopify CLI, validate rồi chạy `npm run deploy`. Kiểm tra install/reinstall và webhook trên development store trước khi đưa nhiều store thật vào.

Migration chạy bằng service `migrate` trước web/worker. Worker dùng BullMQ job ID theo store để tránh hai tick của cùng store chạy đồng thời; nhiều store được phân bổ qua concurrency mặc định 4. Tác vụ theo checkpoint, có thể tiếp tục sau restart. Pause có hiệu lực sau bước đang chạy. Retry apply luôn đọc lại Shopify và kiểm tra xung đột.

## Backup database

Chạy trên VPS, dùng Bash để giữ nguyên dump nhị phân:

```sh
mkdir -p backups
docker compose exec -T postgres pg_dump -U seo -d seo -Fc > "backups/seo-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Lưu bản copy ở vị trí riêng cùng `ENCRYPTION_KEY` và cấu hình credentials. Backup database chứa toàn bộ phiên bản gốc/lịch sử; metafield Shopify chỉ giữ backup mới nhất. Kiểm tra phục hồi vào **database mới** trước:

```sh
docker compose exec -T postgres createdb -U seo seo_restore_check
docker compose exec -T postgres pg_restore -U seo -d seo_restore_check < backups/<file>.dump
```

Khi phục hồi production: dừng web/worker, phục hồi vào database mới, đổi `DATABASE_URL`, rồi khởi động lại. Đối chiếu trạng thái apply với Shopify trước khi retry các tác vụ còn dang dở. Không xóa volume PostgreSQL/Redis để “restart”.

## Kiểm tra trước khi dùng store thật

- Hai store: danh sách, proposal, lịch và GSC không truy cập chéo được.
- Product và collection có nhiều trang variants/media/metafields; ảnh gắn variant đều có alt đề xuất.
- Chỉnh một sản phẩm trên Shopify sau khi scan: app phải báo conflict và yêu cầu xem dữ liệu mới trước khi force apply.
- Ngắt worker sau khi ghi core, khởi động lại: hoàn tất FAQ/alt, không tạo backup gốc sai.
- Thử restore sau khi đổi handle hoặc xóa/thêm ảnh: giữ URL hiện tại, không tái tạo ảnh đã xóa.
- Apply lại và xác nhận metafield `seo_aeo.backup_latest` chỉ trỏ tới bộ chunk mới; bản lịch sử vẫn ở database.
- Publish theme FAQ/embed, kiểm tra JSON-LD thực tế và kiểm tra Google Rich Results trên các template đang dùng.
- OAuth GSC, chọn property, nhập dữ liệu, kiểm tra các cửa sổ 28 ngày. Ngày chưa có dữ liệu hiển thị rõ; so sánh không chứng minh tác động nhân quả.
- Uninstall/reinstall, expiring offline token refresh, webhook signature/retry, `shop/redact`.
- Chạy thử tải 5.000–50.000 sản phẩm và theo dõi memory, quota, thời gian, chi phí trước khi tăng số store.

Các bước trên cần app/store/account thật. Kiểm thử local không thay thế kiểm thử tích hợp này hoặc quy trình xét duyệt Shopify App Store.
