# 云湖牢大版 · 第三方桌面客户端

<p align="center"><img src="assets/brand.jpg" width="180" alt="云湖牢大版" /></p>

> 本仓库 fork 自 [FLY1919/yunhu-vue](https://github.com/FLY1919/yunhu-vue)，在保留其后端代理与插件内核的基础上重制前端视觉与交互。
> 仅供 **学习交流**。接口来自社区公开整理：
> [yh-Tpdev/yhchatAPI](https://github.com/yh-Tpdev/yhchatAPI) 与 [yhwiki](https://codeberg.org/ybr/yhwiki)。只使用 **你自己的账号 token**。
>
> ⚠️ **安卓端说明**：本仓库的安卓（Capacitor WebView）方案 bug 较多、体验不佳，后续考虑砍掉。
> 需要安卓客户端请移步两个更成熟的原生实现：
> [Kauid323/Yhchat_md3](https://github.com/Kauid323/Yhchat_md3) 与 [murexide-project/Murexide](https://github.com/murexide-project/Murexide)。

**全量 TypeScript，`npm run typecheck`(vue-tsc) 0 error。**

---

## 牢大版改了什么

- **视觉重制**：桌面端 WinUI 3 / Fluent 观感（亚克力导航、细阴影、发丝边框），安卓端 Material 3 观感（大圆角、色调容器、涟漪反馈），运行时按平台切换（`src/platform.ts`）。
- **QQ 式导航语义**：左栏头像=我的资料、☰ 菜单=文件/调色盘/检查更新/帮助/关于/锁定/退出账号；更多功能宫格（可常驻/排序）；会话右键=置顶/免打扰/分组/删除；输入 @ 弹群成员列表。
- **输入框粘贴上传**：剪贴板里的图片/视频/音频/文件先暂存预览（可裁剪/配文/看进度速度），确认后再发送。
- **快捷回复 chips**：独立一行的强调色胶囊，与模式切换按钮明显区分，行内可增删、可拖拽排序。
- **主题扩展**：壁纸与看板娘贴纸支持本地图片上传（走图床，不塞 localStorage）。
- **品牌**：全平台图标与 README 插图为同一张牢大图（`assets/brand.jpg`）。

---

## 一、三层结构

```
┌───────────────────────────────────────────────┐
│ 控制台 (Koishi 风格)                           │
│   rail 导航由「插件注册的页面」动态生成          │
│   ctx.page / ctx.slot / ctx.action / ctx.menu  │
├───────────────────────────────────────────────┤
│ Satori 消息层                                  │
│   Element[] 元素树 · Session · Bot             │
│   适配器负责 云湖 protobuf ⇄ 元素树             │
├───────────────────────────────────────────────┤
│ Cordis 内核                                    │
│   Context / plugin / Service / inject / effect │
└───────────────────────────────────────────────┘
```

### 1. 内核（`src/core/context.ts`）

| 机制 | 说明 |
|---|---|
| `Context` | `ctx.extend()` 派生；`ctx.<service>` 直接访问；`ctx.root` |
| `Context.current` | 当前正在 `apply` 的上下文（服务方法里把副作用挂到调用方） |
| `Service` | 服务基类，**构造完成后**由框架调 `start()` 注册 |
| `inject` | 服务 falsy → 不加载；值变化 → 回滚重载；服务消失 → 回滚挂起，恢复 → 自动重载 |
| `ctx.inject(deps, cb)` | 语法糖（带 using 的子插件） |
| `ctx.effect(fn)` | 副作用，随插件卸载自动清理 |
| **稳定服务代理** | `ctx.<service>` 返回按名字缓存的转发代理：插件重载换实例后，组件缓存的引用依然有效 |

### 2. Satori 消息层（`src/satori/`）

```ts
import { h } from '../satori'

h.text('你好') · h.image(url) · h.at(id, name) · h.a(href, [h.text('链接')])
h.markdown('# 标题') · h.html('<b>x</b>') · h.sticker(url, itemId, packId)
h.file(url, name, size) · h.audio(url, time) · h.video(url) · h.a2ui(json) · h.br()

parse(云湖content, contentType) -> Element[]     // 适配器入
render(Element[]) -> { contentType, content }    // 适配器出
```

事件：`message-created` / `message-updated` / `message-recalled`。

### 3. 控制台（`src/console/`）

左侧导航**完全由已注册页面生成**，插件装卸即时增减。页面组件用 `<k-layout>` / `<k-card>` / `<k-slot>` 组装。

## 二、配置文件（对标 koishi.yml）

`yunhu.config.yml`（服务端 `/config` 读写，控制台「配置」页可视化编辑）。启动时先加载配置，再把 `{...app, ...plugins.<key>}` 作为 `config` 传给插件；「应用并重载插件」按新配置重挂载并自动恢复登录态。

## 三、分支与产物

| 分支 | 内容 | 产物 |
|---|---|---|
| `master` / `dev` | Web 版（Vue 前端 + Node 代理） | — |
| `desktop` | Tauri 桌面端（Node sidecar 服务） | `yunhulaoda-<版本>-windows-x64-tauri-setup.exe` / `-tauri-portable.zip` |

> 历史说明：Electron 桌面端与 Capacitor 安卓端自 v1.0.3 起停止构建与发布，
> 旧版产物已从 Release 移除。安卓客户端推荐原生实现：
> [Yhchat_md3](https://github.com/Kauid323/Yhchat_md3)、[Murexide](https://github.com/murexide-project/Murexide)。

版本遵循语义化版本，从 `1.0.0` 起。

## 四、运行

```bash
npm install
npm run dev                      # 开发
npm run build && npm run serve   # 生产：HOST=:: PORT=8902 node server.ts
npm run typecheck                # vue-tsc
npm run test:kernel              # 内核语义测试（无需账号）
```

服务端默认端口 8902（http）；8903 为自签 https（手机录音/录像需要安全上下文，证书在 `certs/` 自动生成、不入库）。

## 五、服务端附带能力

| 路径 | 说明 |
|---|---|
| `/api/*` | 云湖接口反代（绕 CORS，一律 no-store） |
| `/res/<host>/<path>` | 数据床代理（补 `Referer: http://myapp.jwznb.com`） |
| `/up/<host>/` | 七牛上传代理 |
| `/webdav/*` | 群网盘 WebDAV 网关（user=群ID 或 all，pass=token） |
| `/satori/v1/*` | 标准 Satori 协议 HTTP 端点（Bearer token） |
| `/satori/v1/ws` | Satori 事件推送（WebSocket） |
| `/config` | 配置文件读写 |

## 六、插件清单（22 个）

```
内核/基础   cfg  logger  ui  theme  console  api  http  auth
协议层      adapter(Satori)  ws
业务层      chat  message-actions  group-admin  quickreply  charbg
            session-event(session/event)  social  botconsole
            community  stickers  commands  market
```

装/卸一个插件，它注册的**服务 / 控制台页面 / 导航项 / 聊天菜单 / 输入区按钮 / 插槽 / 气泡渲染器**会一起消失或恢复 —— 这是 Koishi 式的核心体验。

## 七、文档

- [`docs/plugin-development.md`](docs/plugin-development.md) —— 插件开发指南
- [`docs/cordis-notes.md`](docs/cordis-notes.md) —— 真 cordis 的实测笔记
- [`docs/api-coverage.md`](docs/api-coverage.md) —— 云湖接口覆盖情况
