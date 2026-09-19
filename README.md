# Gemini 3.8 Flash mô tả ảnh (Vertex AI)

Python CLI nhỏ gửi `img.png` cùng prompt đến model `gemini-3.8-flash` qua Vertex AI bằng Google Gen AI SDK, rồi in mô tả ảnh và thống kê token.

## Chuẩn bị

- Python 3.10 trở lên.
- Google Cloud project đã bật Vertex AI API và có quyền gọi model Gemini.
- Google Cloud CLI để đăng nhập Application Default Credentials (ADC).
- File `img.png` đặt cùng thư mục với `app.py`.

Trong PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
gcloud auth application-default login
python app.py
```

Thay đổi câu hỏi về ảnh:

```powershell
python app.py "Trong ảnh có những gì?"
```

App in số token input, output và cache sau câu trả lời. Token cache là phần token đầu vào được dùng lại từ cache, nên đã nằm trong số token input.

Ứng dụng dùng endpoint `global`; tài khoản và project phải được cấp quyền Vertex AI phù hợp. ADC được Google Cloud CLI lưu ngoài mã nguồn, không cần API key trong repo.
Project ID mặc định được đọc từ file `.env`. Có thể đặt biến môi trường `GOOGLE_CLOUD_PROJECT` để ghi đè giá trị này.

Tài liệu model: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
