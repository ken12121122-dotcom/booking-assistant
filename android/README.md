# Booking Assistant Android MVP

## 目標

單一 APK 內整合：
- 首次交機精靈
- 本機後台 UI
- 後續 Booking Core / Room(SQLite)
- LINE / AI Connector
- 版本檢查與更新入口

## v0.1 已完成

- Android APK 專案骨架
- WebView 載入 APK 內建後台頁面
- 第一次開啟顯示交機精靈
- 完成初始化後，下次直接進本機後台
- 店家名稱與初始化狀態保存在 Android 本機設定
- `android-mvp` 分支更新時，GitHub Actions 自動建置 debug APK

## 更新模型

GitHub 是開發母版，不直接存在客戶手機。

流程：

`GitHub commit -> CI Build -> Signed APK/Release -> App 檢查版本 -> 使用者確認安裝 -> 保留本機資料`

一般 Android 裝置不允許普通 App 在沒有使用者確認的情況下靜默覆蓋安裝自身；正式版會做「發現新版 -> 下載 -> 系統安裝確認」。若未來使用 Android Enterprise Device Owner/MDM，可另外評估受管裝置的自動更新策略。

## 下一階段

1. Room / SQLite：customers、bookings、checkins、settings。
2. 交機精靈加入 LINE Secret / Token、AI Provider / API Key。
3. 憑證改用 Android Keystore 加密儲存。
4. 後台加入今日/週課表與 CRUD。
5. 建立 update manifest 與 release APK 發布流程。
6. Release signing 與資料庫 migration。
