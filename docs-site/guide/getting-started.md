# 快速开始

## 环境要求

- Node.js ≥ 18（推荐 20+，本项目在 Node 26 上开发）
- npm

## 安装与运行

```bash
git clone https://github.com/FLY1919/yunhu-vue.git
cd yunhu-vue
npm install
```

**开发模式**（前端热更新）：

```bash
npm run dev
```

**构建**（会先跑 `scripts/preflight.mjs` 自检）：

```bash
npm run build
```

**启动服务端**：

```bash
node server.ts
```

服务端同时提供这些能力（不只是静态托管）：

| 路径 | 作用 |
| --- | --- |
| `/api/*` | 云湖接口反代（绕开 CORS；**不缓存**） |
| `/res/<host>/<path>` | 数据床代理（补 `Referer` 防盗链头，并透传 `Range` 以支持视频 / 音频） |
| `/up/<host>/` | 七牛上传代理 |
| `/webdav/*` | 群网盘 WebDAV 网关 |
| `/satori/v1/*` | Satori 协议 HTTP 端点 |
| `/satori/v1/ws` | Satori WebSocket 事件推送 |
| `/mount-json` | 第三方网盘挂载的页内浏览（返回 JSON） |
| `/config` | 配置文件读写 |

## 两个端口

```
http://<host>:8902     日常访问（双栈，绑定 ::）
https://<host>:8903    手机录音 / 录像用
```

> 为什么需要 HTTPS？浏览器只在**安全上下文**（https 或 localhost）才暴露
> `navigator.mediaDevices`，纯 http 打开时手机上连麦克风权限弹窗都不会出现。
> 服务端会自动自签证书，浏览器提示"不安全"时手动信任一次即可。

## 登录

打开页面后用**你自己的云湖账号**登录：

- 邮箱 + 密码
- 或直接填 Token

登录态会存在 localStorage，由 `auth` 插件负责恢复。

## 目录结构

```
src/
  core/        内核基础（cordis 封装、protobuf、渲染、资源代理、深链）
  plugins/     全部插件（21 个）
  console/     控制台外壳与页面
  components/  UI 组件
  satori/      消息元素树（element / a2ui / session）
docs/          原始 Markdown 文档
docs-site/     VitePress 文档站（就是你现在看的这个）
scripts/       自检与接口覆盖脚本
```

## 下一步

- 想加功能 → [插件开发指南](./plugin-development.md)
- 想发富消息 → [消息元素（Satori）](./satori.md)
- 想知道还有哪些接口没用 → [接口覆盖情况](./api-coverage.md)
