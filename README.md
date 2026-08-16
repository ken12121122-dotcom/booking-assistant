# Booking Assistant — LINE Webhook MVP

目前只做 LINE Messaging API 的最小 Webhook 通道。

## 功能

- `GET /api/line/webhook`：健康檢查
- `POST /api/line/webhook`：接收 LINE webhook
- 驗證 `x-line-signature`
- 支援 LINE Verify 的空 `events` 請求
- 收到文字訊息後回覆：`收到：原訊息`

目前尚未接 GPT、排課、日曆、簽到或資料庫。

## Vercel 環境變數

部署後請在 Vercel 專案設定：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

不要把 Secret 或 Token commit 到 GitHub。

## Webhook URL

部署到 Vercel 後，LINE Webhook URL 使用：

`https://<your-vercel-domain>/api/line/webhook`

## 驗收

1. LINE Verify 成功。
2. 私人 LINE 傳 `測試123` 給官方帳號。
3. 官方帳號回覆 `收到：測試123`。
