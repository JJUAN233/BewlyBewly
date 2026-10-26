# BewlyBewly

[English](README.md) | [官话 - 简体中文](README-cmn_CN.md) | 官話 - 繁體中文 | [廣東話](README-jyut.md)

> [!NOTE]
> 這是 BewlyBewly 的個人 fork，由
> [JJUAN233](https://github.com/JJUAN233) 維護，基於 v0.41.1。
> 額外加入了影片下載、二級選單、毛玻璃模糊強度調節、收藏夾管理，以及歷史頁整頁補全（篩選/宮格/批次管理）等功能，
> 並修復了一批介面問題。本 fork 沒有在任何瀏覽器擴充功能商店上架，請執行
> `npm run build` 後載入生成的 `extension/` 目錄使用。
> 問題請提到本倉庫的 Issues。

<p align="center" style="margin-bottom: 0px !important;">
<img width="300" alt="BewlyBewly icon" src="assets/bewly-vtuber-style-logo.png"><br/>
</p>

<p align="center">只需對您的 Bilibili 主頁進行一些小改動就好。</p>

## 👋 介紹

> [!IMPORTANT]
> BewlyBewly 主要著重於頁面調整和改良，而不是完善功能和提升效率。
>
> 由於考慮到效率和維護困難度，深色模式只會適應常用的頁面，而較少使用的頁面則不會支護。

> [!CAUTION]
> 如果您正在安裝此擴充功能，您的瀏覽器可能會提示它可以讀取您的瀏覽歷史記錄。
>
> 這是因爲 BewlyBewly 使用了["tabs" 權限](https://developer.chrome.com/docs/extensions/reference/api/tabs)，該權限也可用於讀取每個分頁，從而瞭解瀏覽歷史，但在這裏並未使用。
>
> **一些瀏覽器會提到最壞的情況和最高的風險，以確保您在安裝後的安全。**
> 此外，這個專案是開源的，所以您可以看到它究竟做了什麼。

BewlyBewly 是一個針對 BiliBili 的瀏覽器擴充功能，旨在透過重新設計 BiliBili 的介面來提升用戶體驗。設計靈感來自於 YouTube、Vision OS 和 iOS，使介面更具視覺吸引力和用戶友好性。

該專案使用 [vitesse-webext](https://github.com/antfu/vitesse-webext) 範例進行開發。如果沒有此範例，可能無法開發出此專案。

## ⬇️ 安裝

本 fork 沒有在任何瀏覽器擴充功能商店上架。請從原始碼建置：

```bash
pnpm install   # 或 npm install
npm run build  # Chrome / Edge 建置，產物在 extension/
```

接著以「載入解壓縮的擴充功能」方式載入：

1. 開啟 `chrome://extensions`（Chrome）或 `edge://extensions`（Edge）
2. 開啟「開發人員模式」，點擊「載入解壓縮」
3. 選擇產生的 `extension/` 目錄

Firefox 請執行 `npm run build-firefox`，然後在 `about:debugging` → `This Firefox` → `載入暫存附加元件` 中載入 `extension-firefox/`。

## 🤝 貢獻與建置專案

詳情 [CONTRIBUTING.md](docs/CONTRIBUTING-cmn_TW.md)

### 貢獻者

[![Contributors](https://contrib.rocks/image?repo=JJUAN233/BewlyBewly)](https://github.com/JJUAN233/BewlyBewly/graphs/contributors)

## ❤️ 鳴謝

- [vitesse-webext](https://github.com/antfu/vitesse-webext) - 此專案所用的範例
- [UserScripts/bilibiliHome](https://github.com/indefined/UserScripts/tree/master/bilibiliHome), [bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend) - 參考取得 access key 之方法
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) - 部分功能的實現
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
