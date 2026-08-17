# Booking Assistant — LINE Webhook + AI Parser + Relay

這個分支是整體架構裡的「Vercel 端」：LINE Gateway、AI 指令解析、跟 KV Relay。**不擁有課表的最終寫入權**，實際的資料驗證、時段衝突判斷、SQLite 寫入，一律由 Android App（`android-mvp` 分支）本機執行。這個分工邊界是跟 Android 端一起凍結的 contract，之後不再更動。

## 功能

- `GET /api/line/webhook`：健康檢查
- `GET /api/line/webhook?mode=poll&device_id=xxx`：手機 App 輪詢用的 Gateway，帶 `Authorization: Bearer <LINE_CHANNEL_SECRET>`
- `POST /api/line/webhook`：接收 LINE webhook
- 驗證 `x-line-signature`
- 支援 LINE Verify 的空 `events` 請求
- 收到文字訊息後，用 Gemini 解析成排課指令（dry-run，只回傳結構化 `plan`，不寫入任何資料）
- 資訊不足時會反問使用者一句話；設定 Vercel KV 後可記住上一輪反問，讓使用者接著回答也能被理解（多輪對話）；未設定 KV 時退化為單輪解析
- 每則訊息（含解析結果）會發布到 KV 持久化的 Relay 佇列，供 Android App 輪詢取用；即使 serverless function 冷啟動也不會遺失（取代舊版存在 `globalThis` 記憶體裡的版本）

目前不接排課資料庫——課表、學員、簽到資料都在手機本機 SQLite（Android 端負責）。

## 解析出的 action

`search_schedule`、`create_booking`、`reschedule_booking`、`cancel_booking`、`swap_booking`、`record_checkin`、`find_customer`、`add_student`、`unknown`。

每個 action 除了保留使用者原文（`date_text`/`time_text` 等），也會附上依台灣時間（`+08:00`）換算好的正式時間（`start_at`/`new_start_at`，ISO 8601）；`swap_booking` 用 `counterpart_*` 欄位描述要交換的另一堂課；`add_student` 用 `phone` 帶學員電話。App 端只信任這些已解析欄位，不用自己再猜文字時間。

## Vercel 環境變數

部署後請在 Vercel 專案設定：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`（選填，預設 `gemini-2.5-flash-lite`）
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`（Vercel KV／Upstash Redis；沒設定的話多輪反問跟 Relay 都會停用，退化成單輪、無持久佇列）

不要把 Secret 或 Token commit 到 GitHub。

## Webhook URL

部署到 Vercel 後，LINE Webhook URL 使用：

`https://<your-vercel-domain>/api/line/webhook`

## 驗收

1. LINE Verify 成功。
2. 私人 LINE 傳一句排課指令給官方帳號，收到 AI 解析結果（dry-run）。
3. `GET /api/line/webhook` 回傳的 `sessionStoreConfigured`、`relayConfigured` 皆為 `true`。
4. Android App 用同一組 LINE Channel Secret 呼叫 `?mode=poll` 能收到剛剛那則訊息。
