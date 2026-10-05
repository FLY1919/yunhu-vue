---
layout: home

hero:
  name: 云湖第三方客户端
  text: Vue3 + Cordis 内核 · Koishi 式控制台 · Satori 消息层
  tagline: 一个可扩展的云湖 Web 客户端 —— 万物皆插件
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 插件开发
      link: /guide/plugin-development
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/FLY1919/yunhu-vue

features:
  - icon: 🧩
    title: 万物皆插件
    details: 内核跑的是真正的 cordis。每个功能都是一个插件，装载 / 卸载会连带回收它注册的服务、控制台页面、导航项、消息菜单、输入区按钮、插槽与气泡渲染器。
    link: /guide/plugin-development
  - icon: 🖥️
    title: Koishi 式控制台
    details: 左侧导航由「插件注册的页面」动态生成，并提供 ctx.page / ctx.slot / ctx.action / ctx.menu 等与 Koishi 同构的扩展点。
    link: /guide/plugin-development
  - icon: 📨
    title: Satori 消息层
    details: 云湖各种 content_type 统一解析成 Satori 元素树 —— 收和发是同一种结构，不用写两套代码。
    link: /guide/satori
  - icon: 🌐
    title: 协议齐全
    details: 内置 HTTP API、Satori WebSocket（含事件推送）、WebDAV 网盘网关，以及 HTTPS 端口（手机录音 / 录像需要安全上下文）。
    link: /guide/api-coverage
  - icon: 📱
    title: 手机可用
    details: 响应式布局：列表行与操作按钮组在窄屏可横向滑动，不会被压扁或拉伸。
    link: /guide/getting-started
  - icon: 🛡️
    title: 部署前自检
    details: scripts/preflight.mjs 会检查模板 import、本地引用、服务声明，已接进 npm run build，避免「组件整块不渲染」这类隐蔽问题。
    link: /guide/plugin-development
---

## 这是什么

一个**非官方**的云湖（Yunhu）第三方 Web 客户端，用 Vue 3 + TypeScript 写成。

它的目标不是「复刻一个界面」，而是提供一个**可插拔的壳**：

- **内核**用真正的 [cordis](https://github.com/cordiverse/cordis)（不是仿写）
- **控制台**仿 Koishi：页面、插槽、动作、菜单都由插件注册
- **消息层**用 Satori 风格的元素树，屏蔽云湖各种 content_type 的差异
- **服务**以 `ctx.xxx` 注入，插件之间靠依赖声明协作

接口来自社区公开整理（[yhchatAPI](https://github.com/yh-Tpdev/yhchatAPI)），仅供**学习交流**，请使用你自己的账号 token。

## 一眼看完

| 层 | 用什么 | 说明 |
| --- | --- | --- |
| 内核 | cordis | Context / Service / plugin / inject / effect，Fiber 管理 |
| 界面 | Vue 3 + Vite | 全量 TypeScript，`tsc --noEmit` 0 error |
| 控制台 | 自研（仿 Koishi） | 13 个页面、21 个插件、导航动态生成 |
| 消息 | Satori 元素树 | 文本 / 图片 / 语音 / 视频 / 表情 / A2UI 统一结构 |
| 协议 | HTTP + WebSocket + WebDAV | 另有 Satori 标准端点与 HTTPS 端口 |

## 快速上手

```bash
git clone https://github.com/FLY1919/yunhu-vue.git
cd yunhu-vue
npm install

# 开发
npm run dev

# 构建（会先跑部署前自检）
npm run build

# 启动服务端（含 API 反代 / 资源代理 / WebDAV / Satori / HTTPS）
node server.ts
```

服务默认监听 `8902`（HTTP，双栈）与 `8903`（HTTPS，用于手机录音 / 录像）。

> 想写插件？看 [插件开发指南](/guide/plugin-development)。
