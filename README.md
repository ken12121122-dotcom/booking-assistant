# Booking Assistant — LINE Webhook MVP

目前只做 LINE Messaging API 的最小 Webhook 通道。

## 功能

- `GET /api/line/webhook`：健康檢查
- `POST /api/line/webhook`：接收 LINE webhook
- 驗證 `x-line-signature`
- 支援 LINE Verify 的空 `events` 請求
- 收到文字訊息後，用 Gemini 解析成排課指令（dry-run，尚未真正執行）
- 資訊不足時會反問使用者一句話；設定 Vercel KV 後可記住上一輪反問，讓使用者接著回答也能被理解（多輪對話）；未設定 KV 時退化為單輪解析

目前尚未接排課、日曆、簽到執行或資料庫。

## Vercel 環境變數

部署後請在 Vercel 專案設定：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`（選填，預設 `gemini-2.5-flash-lite`）
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`（選填，接 Vercel KV 後才會有多輪反問記憶）

不要把 Secret 或 Token commit 到 GitHub。

## Webhook URL

部署到 Vercel 後，LINE Webhook URL 使用：

`https://<your-vercel-domain>/api/line/webhook`

## 驗收

1. LINE Verify 成功。
2. 私人 LINE 傳 `測試123` 給官方帳號。
3. 官方帳號回覆 `收到：測試123`。
