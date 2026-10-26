# BewlyBewly

English | [官话 - 简体中文](README-cmn_CN.md) | [官話 - 繁體中文](README-cmn_TW.md) | [廣東話](README-jyut.md)

> [!NOTE]
> This is a personal fork of BewlyBewly, maintained by
> [JJUAN233](https://github.com/JJUAN233) and based on v0.41.1.
> It adds video download, sub-menus, glass-blur intensity control, and favorites management,
> along with a full-featured history page (filters, grid layout, batch management) and a batch of UI fixes.
> This fork is not published on any extension store: build it with `npm run build`
> and load the generated `extension/` directory.
> Please report issues to this repository's Issues page.

<p align="center" style="margin-bottom: 0px !important;">
<img width="300" alt="BewlyBewly icon" src="assets/bewly-vtuber-style-logo.png"><br/>
</p>

<p align="center">Just make a few small changes to your Bilibili homepage.</p>

## 👋 Introduction

> [!IMPORTANT]
> BewlyBewly mainly focuses on page adjustments and optimization rather than improving functionally and efficiency.
>
> The dark mode will only be adapted to commonly used pages due to its efficiency and maintenance difficulty, while less
> frequently used pages will not to be adapted.

> [!CAUTION]
> If you are installing this extension, your browser will probably say that it can read your browser history.
>
> This is because BewlyBewly uses the ["tabs" permission](https://developer.chrome.com/docs/extensions/reference/api/tabs), which can also be used to read each tab, allowing it to know the browsing history, but it is not utilized here.
>
> **Some browsers will mention the worst-case scenario and the highest risks, ensuring your safety after installation.**
> Additionally, this project is open source, so you can see what exactly what it does.

BewlyBewly is a browser extension for BiliBili that aims to enhance the user experience by redesigning the BiliBili UI.
The design is inspired by YouTube, Vision OS, and iOS, resulting in a more visually appealing and user-friendly interface.
This project uses the [vitesse-webext](https://github.com/antfu/vitesse-webext) template for development.
Without this template, it may not be possible to develop this project.

## ⬇️ Installation

This fork is not published on any browser extension store. Build it from source:

```bash
pnpm install   # or npm install
npm run build  # Chrome / Edge build, output in extension/
```

Then load it as an unpacked extension:

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
2. Turn on `Developer mode` and click `Load unpacked`
3. Select the generated `extension/` directory

For Firefox, run `npm run build-firefox` and load `extension-firefox/` from `about:debugging` → `This Firefox` → `Load Temporary Add-on`.

## 🤝 Contribution & Build

See [CONTRIBUTING.md](docs/CONTRIBUTING.md)

### Contributors

[![Contributors](https://contrib.rocks/image?repo=JJUAN233/BewlyBewly)](https://github.com/JJUAN233/BewlyBewly/graphs/contributors)

## ❤️ Credits

- [vitesse-webext](https://github.com/antfu/vitesse-webext) - The template used for this project
- [UserScripts/bilibiliHome](https://github.com/indefined/UserScripts/tree/master/bilibiliHome),
[bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend) - Reference source for obtaining the access key
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) - Partial implementation of functionalities
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
