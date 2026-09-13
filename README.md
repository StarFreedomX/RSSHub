<p align="center">
<img src="https://docs.rsshub.app/img/logo.png" alt="RSSHub" width="100">
</p>
<h1 align="center">RSSHub</h1>

> 🧡 Everything is RSSible

## 大橋家 WHAT'S NEW（本 fork 新增）

订阅 [大橋彩香官网 WHAT'S NEW](https://ayaka-ohashi.com/updates)：`/ayaka-ohashi/updates`。

- 包含最新一页的 NEWS、RADIO、BLOG、MOVIE、WALLPAPER、LIVE STREAMING 等全部更新，保持官网顺序。
- 公开文章提供完整正文、图片和原文链接；会员内容保留标题、日期、分类和登录阅读入口，不提供会员正文或音视频。
- 广播各期即使共用链接也有独立 GUID；博客保留文章锚点。日期按日本时区转换。
- 详情并发最多 3 个，共用页面只抓一次；缓存按固定时间过期，文章修改可被重新抓取。单条详情失败不影响其他条目，失败内容不写入详情缓存。
- 使用 RSSHub 内置 RSS / Atom / JSON Feed、过滤和条数限制。订阅最新一页，不用于历史归档；建议阅读器至少每小时刷新。

### 启动

需要 Node.js 24.15+（24.x）或 22.22.2+（22.x），以及 package.json 指定的 pnpm 10.34.5。

```sh
git clone --branch feat/ayaka-ohashi-updates https://github.com/StarFreedomX/RSSHub.git
cd RSSHub
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

启动后将 `http://localhost:1200/ayaka-ohashi/updates` 加入阅读器。远程阅读器需要将 localhost 换成你部署的服务地址；官方公共 RSSHub 实例尚不包含本 fork 的路由。

| 用途         | 路径                                            |
| ------------ | ----------------------------------------------- |
| 全部最新更新 | `/ayaka-ohashi/updates`                         |
| 仅新闻       | `/ayaka-ohashi/updates?filter_category=NEWS`    |
| 仅广播       | `/ayaka-ohashi/updates?filter_category=RADIO`   |
| 排除博客     | `/ayaka-ohashi/updates?filterout_category=BLOG` |
| 最新 5 条    | `/ayaka-ohashi/updates?limit=5`                 |
| Atom         | `/ayaka-ohashi/updates?format=atom`             |
| JSON Feed    | `/ayaka-ohashi/updates?format=json`             |

分类和关键词过滤仅作用于官网最新一页。页面中没有匹配内容时，过滤结果可能为空。广播没有公开的单期 URL，使用日期与标题生成稳定锚点；若官网修改广播标题，该期可能作为新条目出现。

可通过环境变量 `PORT` 调整端口、`CACHE_EXPIRE` 调整订阅缓存、`CACHE_CONTENT_EXPIRE` 调整正文缓存（单位均为秒，缓存默认分别为 300 / 3600 秒）。本路由不需要 Cookie、Redis 或浏览器。长期部署时请使用进程管理器，或用本 fork 源码构建 Docker 镜像；仓库原有 compose 文件引用的是上游镜像，不能直接提供新增路由。

### 验证

```sh
pnpm build:routes
pnpm vitest --run tests/ayaka-ohashi.test.ts
```

测试覆盖真实官网页面样本、广播去重、日本时区、会员提示、正文提取、失败重试，以及 RSS/Atom/JSON 输出、分类过滤和图片链接转换。样本来自 2026-09-13 的公开页面，测试无需连接官网。

[![](https://img.shields.io/badge/dynamic/json?url=https://rsshub-analytics.diygod.workers.dev/&query=requests&color=F38020&label=requests&logo=cloudflare&style=flat-square&suffix=/month)](https://rsshub.app)
[![docker publish](https://img.shields.io/docker/pulls/diygod/rsshub?label=docker%20pulls&logo=docker&style=flat-square)](https://hub.docker.com/r/diygod/rsshub)
[![npm publish](https://img.shields.io/npm/dt/rsshub?label=npm%20downloads&logo=npm&style=flat-square)](https://www.npmjs.com/package/rsshub)
[![test](https://img.shields.io/github/actions/workflow/status/DIYgod/RSSHub/test.yml?branch=master&label=test&logo=github&style=flat-square)](https://github.com/DIYgod/RSSHub/actions/workflows/test.yml?query=event%3Apush+branch%3Amaster)
[![Test coverage](https://img.shields.io/codecov/c/github/DIYgod/RSSHub.svg?style=flat-square&logo=codecov)](https://app.codecov.io/gh/DIYgod/RSSHub/branch/master)
[![Visitors](https://hitscounter.dev/api/hit?url=https%3A%2F%2Fgithub.com%2FDIYgod%2FRSSHub&label=RSS+lovers&icon=rss-fill&color=%23ff752e)](https://github.com/DIYgod/RSSHub)

[![Telegram group](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.swo.moe%2Fstats%2Ftelegram%2Frsshub&query=count&color=2CA5E0&label=Telegram%20Group&logo=telegram&cacheSeconds=3600&style=flat-square)](https://t.me/rsshub) [![Telegram channel](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.swo.moe%2Fstats%2Ftelegram%2FawesomeRSSHub&query=count&color=2CA5E0&label=Telegram%20Channel&logo=telegram&cacheSeconds=3600&style=flat-square)](https://t.me/awesomeRSSHub) [![X (Twitter)](https://img.shields.io/badge/any_text-Follow-blue?color=2CA5E0&label=Twitter&logo=X&cacheSeconds=3600&style=flat-square)](https://x.com/intent/follow?screen_name=_RSSHub)

<table>
<tr>
<td align="center" valign="top" width="50%">
<a href="https://folo.is/"><img src="https://github.com/user-attachments/assets/68c66528-8c79-4a8a-8e43-ade7d936ab80" alt="Folo" width="419"></a>
<br>
RSSHub pairs especially well with <a href="https://folo.is/">Folo</a>, an AI RSS reader for feed discovery and modern reading workflows. The project is also open source on <a href="https://github.com/RSSNext/Folo">GitHub</a>.
</td>
<td align="center" valign="top" width="50%">
<a href="https://stardesk.onelink.me/p0R7/1v2u6fld"><img src="https://github.com/user-attachments/assets/f23cb580-ab92-46cb-8b5b-277fc8933775" alt="StarDesk" width="419"></a>
<br>
RSSHub keeps me informed, and <a href="https://stardesk.onelink.me/p0R7/1v2u6fld">StarDesk</a> lets me fix routes or feeds remotely, even run terminal commands from my phone. It’s fast, convenient, and free.
</td>
</tr>
</table>

## Introduction

RSSHub is the world's largest RSS network, consisting of over 5,000 global instances.

RSSHub delivers millions of contents aggregated from all kinds of sources, our vibrant open source community is ensuring the deliver of RSSHub's new routes, new features and bug fixes.

[Documentation](https://docs.rsshub.app) | [Folo](https://folo.is/) | [Telegram Group](https://t.me/rsshub) | [Telegram Channel](https://t.me/awesomeRSSHub) | [X (Twitter)](https://x.com/intent/follow?screen_name=_RSSHub)

## Related Projects

- [Folo](https://folo.is/) | An AI RSS reader that works especially well with RSSHub. Source code: [GitHub](https://github.com/RSSNext/Folo).
- [RSSHub Radar](https://github.com/DIYgod/RSSHub-Radar) | A browser extension that can help you quickly discover and subscribe to the RSS and RSSHub of current websites.
- [RSSBud](https://github.com/Cay-Zhang/RSSBud) | RSSHub Radar for iOS platform, designed specifically for mobile ecosystem optimization.
- [RSSAid](https://github.com/LeetaoGoooo/RSSAid) | RSSHub Radar for Android platform built with Flutter.
- [DocSearch](https://github.com/Fatpandac/DocSearch) | Link RSSHub DocSearch into Raycast.
- [Awesome RSSHub Routes](https://github.com/JackyST0/awesome-rsshub-routes) | Curated list of RSS feeds and RSSHub routes.

## Contribute

We welcome all pull requests. Suggestions and feedback are also welcomed [here](https://github.com/DIYgod/RSSHub/issues).

Refer to [Quick Start](https://docs.rsshub.app/joinus/)

## Deployment

Refer to [Deployment](https://docs.rsshub.app/deploy/)

## Special Thanks

<div align="center">

[![](https://opencollective.com/RSSHub/contributors.svg?width=890)](https://github.com/DIYgod/RSSHub/graphs/contributors)

Logo designer [sheldonrrr](https://dribbble.com/sheldonrrr)

[![](https://raw.githubusercontent.com/DIYgod/sponsors/main/sponsors.simple.svg)](https://github.com/DIYgod/sponsors)

<a href="https://www.cloudflare.com" target="_blank"><img height="50px" src="https://i.imgur.com/7Ph27Fq.png"></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://www.netlify.com" target="_blank"><img height="40px" src="https://i.imgur.com/cU01915.png"></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://1password.com" target="_blank"><img height="40px" src="https://i.imgur.com/a2XjflO.png"></a>

</div>

## Author

**RSSHub** © [DIYgod](https://github.com/DIYgod), Released under the [AGPL-3.0](./LICENSE) License.<br>
Authored and maintained by DIYgod with help from contributors ([list](https://github.com/DIYgod/RSSHub/contributors)).

> Blog [@DIYgod](https://diygod.cc) · GitHub [@DIYgod](https://github.com/DIYgod) · X (Twitter) [@DIYgod](https://x.com/DIYgod) · Telegram Channel [@awesomeDIYgod](https://t.me/awesomeDIYgod)
