# BewlyBewly

[English](README.md) | [官话 - 简体中文](README-cmn_CN.md) | [官話 - 繁體中文](README-cmn_TW.md) | 廣東話

> [!NOTE]
> 呢個係 BewlyBewly 嘅個人 fork，由
> [JJUAN233](https://github.com/JJUAN233) 維護，基於 v0.41.1。
> 加咗影片下載、二級選單、毛玻璃模糊強度調節、收藏夾管理，同埋歷史頁整頁補全（篩選/宮格/批量管理）等功能，
> 另外執咗一批介面問題。呢個 fork 冇喺任何 browser 擴充功能商店上架，請執行
> `npm run build` 之後載入生成嘅 `extension/` 目錄使用。
> 有咩問題請喺本倉庫嘅 Issues 提出。

<p align="center" style="margin-bottom: 0px !important;">
<img width="300" alt="BewlyBewly icon" src="assets/bewly-vtuber-style-logo.png"><br/>
</p>

<p align="center">係咁以執吓你嘅 Bilibili 主頁。</p>

## 👋 介紹

> [!IMPORTANT]
> BewlyBewly 主要着重頁面調整同埋改善, 而唔係完善功能同提升效率
>
> 事關考慮到維護嘅效率同埋難度, 深色模式淨係會適應常用頁面, 一啲冇咁常用嘅頁面唔會適應調整

> [!CAUTION]
> 如果你單緊呢個延伸功能，你嘅瀏覽器可能會話佢可以睇到你嘅瀏覽紀錄。
>
> 呢個係因爲 BewlyBewly 用咗["tabs" 權限](https://developer.chrome.com/docs/extensions/reference/api/tabs)，呢個權限亦都可以用嚟讀取每個分頁，從而知道瀏覽紀錄，但係喺呢度冇用到。
>
> **有啲瀏覽器會同你講最壞嘅情況係點同最高嘅風險，確保你單咗之後嘅安全。**
> 另外，呢個項目係開源嘅，所以你可以睇到佢究竟做緊乜。

BewlyBewly 係一個用於 BiliBili 嘅瀏覽器延伸功能，目的係透過重新設計 BiliBili 嘅 UI 令到用戶體驗提升。設計靈感源於 YouTube、Vision OS 同 iOS，從而實現更具視覺吸引力同用戶友好嘅介面。

呢個專案係用咗 [vitesse-webext](https://github.com/antfu/vitesse-webext) 範例進行開發。若果冇咗呢個範例，BewlyBewly 得個吉。

## ⬇️ 單撈

呢個 fork 冇喺任何 browser 擴充功能商店上架。請由 source 自己 build：

```bash
pnpm install   # 或者 npm install
npm run build  # Chrome / Edge build，產物喺 extension/
```

跟住用「載入解壓縮」方式載入：

1. 打開 `chrome://extensions`（Chrome）或者 `edge://extensions`（Edge）
2. 開「開發者模式」，撳「載入解壓縮」
3. 揀生成嘅 `extension/` 資料夾

Firefox 請行 `npm run build-firefox`，然後喺 `about:debugging` → `This Firefox` → `載入暫存附加元件` 度揀 `extension-firefox/`。

## 🤝 貢獻同建置專案

睇吓 [CONTRIBUTING.md](docs/CONTRIBUTING-jyut.md)

### 貢獻者

[![Contributors](https://contrib.rocks/image?repo=JJUAN233/BewlyBewly)](https://github.com/JJUAN233/BewlyBewly/graphs/contributors)

## ❤️ 鳴謝

- [vitesse-webext](https://github.com/antfu/vitesse-webext) - 專案所用嘅範例
- [UserScripts/bilibiliHome](https://github.com/indefined/UserScripts/tree/master/bilibiliHome), [bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend) - 參考取得 access key 之方法
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) - 部分功能嘅實現
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
