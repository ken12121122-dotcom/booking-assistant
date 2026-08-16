# Phone MVP

這個版本把 Android 手機當成排課主機。

## 手機內部
- Flask Web UI
- SQLite：customers / bookings / checkins
- LINE webhook endpoint
- Gemini API parser（可選）

## Termux 安裝
```bash
pkg update
pkg install python git cloudflared
cd ~
git clone -b phone-mvp https://github.com/ken12121122-dotcom/booking-assistant.git
cd booking-assistant/phone_mvp
pip install -r requirements.txt
```

## 設定環境變數
不要把 Secret/Token 寫進 GitHub。

```bash
export LINE_CHANNEL_SECRET='你的 LINE Channel Secret'
export LINE_CHANNEL_ACCESS_TOKEN='你的 LINE Channel Access Token'
export GEMINI_API_KEY='你的 Gemini API Key'
```

Gemini 可先不設定；LINE 仍可確認手機有收到指令。

## 啟動本地主機
```bash
python app.py
```

手機瀏覽器開：
`http://127.0.0.1:8000`

## LINE 直連手機測試
開第二個 Termux session：
```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

取得 `https://xxxx.trycloudflare.com` 後，LINE Webhook 暫時改成：
`https://xxxx.trycloudflare.com/api/line/webhook`

測試完成後可把 LINE Webhook 改回原本的 Vercel URL。

## 第一階段驗收
1. 手機瀏覽器可開本地排課頁。
2. 新增客戶後重新整理資料仍在。
3. 新增課程後重新整理資料仍在。
4. LINE 訊息可以直接打到同一台手機。
5. 關掉 Gemini 時，仍會回覆「手機主機已收到」。

> 此版本是實驗用，不是正式產品部署。正式 Android App 之後可把 Flask/Termux 換成原生 APK + SQLite/Room + FCM/WebSocket。