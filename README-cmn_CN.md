# BewlyBewly

[English](README.md) | 官话 - 简体中文 | [官話 - 繁体中文](README-cmn_TW.md) | [廣東話](README-jyut.md)

> [!NOTE]
> 这是 BewlyBewly 的个人 fork，由
> [JJUAN233](https://github.com/JJUAN233) 维护，基于 v0.41.1。
> 额外加入了视频下载、二级菜单、毛玻璃模糊强度调节、收藏夹管理，以及历史页整页补全（筛选/宫格/批量管理）等功能，
> 并修复了一批界面问题。本 fork 没有在任何浏览器扩展商店上架，请执行
> `npm run build` 后加载生成的 `extension/` 目录使用。
> 问题请提到本仓库的 Issues。

<p align="center" style="margin-bottom: 0px !important;">
<img width="300" alt="BewlyBewly icon" src="assets/bewly-vtuber-style-logo.png"><br/>
</p>

<p align="center">只需对您的 Bilibili 主页进行一些小更改即可。</p>

## 👋 介绍

> [!IMPORTANT]
> BewlyBewly 主要专注页面的调整和优化，而不是完善功能和提升效率。
>
> 由于效率和维护难度的原因，暗色模式只会适应常用页面，而不会适应不常用的页面。

> [!CAUTION]
> 如果您正在安装此扩展程序，您的浏览器可能会提示它可以读取您的浏览历史记录。
>
> 这是因为 BewlyBewly 使用了["tabs" 权限](https://developer.chrome.com/docs/extensions/reference/api/tabs)，该权限也可用于读取每个标签页，从而了解浏览历史，但在这里并未使用。
>
> **一些浏览器会提到最坏的情况和最高的风险，以确保您在安装后的安全。**
> 此外，这个项目是开源的，所以您可以看到它究竟做了什么。

BewlyBewly 是一个用于 BiliBili 的浏览器扩展，旨在通过重新设计 BiliBili 用户界面来提升用户体验。设计灵感来自于 YouTube、Vision OS 和 iOS，从而实现了更具视觉吸引力和用户友好性的界面。

该项目使用 [vitesse-webext](https://github.com/antfu/vitesse-webext) 模板进行开发。如果没有这个模板，可能无法开发出这个项目。

## ⬇️ 安装

本 fork 没有在任何浏览器扩展商店上架。请从源码构建：

```bash
pnpm install   # 或 npm install
npm run build  # Chrome / Edge 构建，产物在 extension/
```

然后以「加载已解压的扩展程序」方式加载：

1. 打开 `chrome://extensions`（Chrome）或 `edge://extensions`（Edge）
2. 打开「开发者模式」，点击「加载已解压的扩展程序」
3. 选择生成的 `extension/` 目录

Firefox 请运行 `npm run build-firefox`，然后在 `about:debugging` → `This Firefox` → `Load Temporary Add-on` 中加载 `extension-firefox/`。

## 🤝 贡献与构建项目

查看 [CONTRIBUTING.md](docs/CONTRIBUTING-cmn_CN.md)

### 贡献者

[![Contributors](https://contrib.rocks/image?repo=JJUAN233/BewlyBewly)](https://github.com/JJUAN233/BewlyBewly/graphs/contributors)

## ❤️ 鸣谢

- [vitesse-webext](https://github.com/antfu/vitesse-webext) - 该项目使用的模板
- [UserScripts/bilibiliHome](https://github.com/indefined/UserScripts/tree/master/bilibiliHome),
[bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend) - 获取访问密钥的参考来源
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) - 部分功能实现
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
