# YH LaoDa 1.0.37 私聊通话预览

基线是 1.0.36 完整源码。设置的「音频与视频 → 私聊通话预览」开启后，主窗口私聊顶栏显示语音和视频 SVG 按钮。窄窗口从「更多」进入。视频在本机预览后才发送呼叫。来电接听、拒绝、取消和挂断使用下列信令。通话面板显示实际 WebRTC 连接状态，支持静音、暂停画面、软件内全屏与最小化。设备沿用本机音视频偏好。

预览使用浏览器的直连候选地址。当前缺少授权的云湖 TURN 配置，无法保证跨 NAT、跨网络或与官方客户端互通。跨网中继、通话内换设备和桌面作为通话视频源没有开放。

## 协议证据

核对 [云湖官方下载地址](https://chat-web-go.jwzhd.com/v1/common/get-version) 提供的 [Android 1.6.32 安装包](https://app-cdn2.jwznb.com/android/yunhu-1.6.32.apk)。APK SHA-256 为 `a4c8b09e7d76fada84995f8aac324109ea4e23484efaa1fc23eb18941e1b808b`。静态分析仅用于核对线上的字段和路由。源码包包含本项目的实现，不附带客户端反汇编或凭据。交叉对照 [yhchatAPI Live 文档](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/api/v1/live.md) 与 [WebSocket 文档](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/api/wss/chat-ws-go.jwzhd.com.md)。

| 操作 | 路径和请求 | 响应及鉴权 |
| --- | --- | --- |
| 呼叫 | `POST /v1/msg/send-message`，Protobuf SendMsgRequest 字段 2 为客户端生成的消息 ID，3 为私聊对象，4 为 1，5 为 Content，6 为音频 13 或视频 12。Content 字段 7 为 SDP offer 的 JSON 字符串，28 为被邀请人 ID 列表，29 为通话类型名称 | 使用 `token` 和当前 `Device-Id`。仅在收到业务成功码 1 后显示等待接听 |
| 来电查询 | `POST /v1/live/get-calling`，无业务参数 | 被叫方的 `token`，成功结构包含 `chatType`、`message` 和呼叫者名称。消息的 `content` 可含 JSON 编码的 `formJson` 和 `liveInviteUserIds`。实际匿名请求返回 HTTP 200 和 `code: -101` |
| 接听 | `POST /v1/live/join`，JSON `roomId`、空字符串 `selfId`、SDP answer 的 JSON 字符串 `rtcDescription` | 使用 `token`、`Device-Id`。成功判定为 `code: 1` |
| 拒绝、忙线、取消、失败、挂断 | `POST /v1/live/refuse`、`/busy`、`/cancel`、`/failed`、`/hang_up`，完整前缀为 `/v1/live`，JSON `roomId` | 使用同一账号和设备请求头。业务失败以服务端消息展示或按流程释放本地设备。业务失败码未做账号联调验证 |
| 状态推送 | 云湖认证 WebSocket 的 `live_video_user_` 系列命令 | LiveMessage Protobuf 字段 1 roomId、2 userId、3 chatId、4 chatType、5 cmd、6 data。接听事件携带 SDP answer。其余状态用于拒绝、忙线、取消、挂断、失败和处理事件 |

私聊通话使用云湖专用消息类型传输 offer，并通过真实的 WebRTC 会话建立媒体连接。普通语音、视频消息继续使用类型 11 和 10。群频道邀请接口 `/v1/live/invite` 未用于私聊。

### 1.0.41 接听请求复查

Android 1.6.32 的私聊接听会先检查本地描述的 `type` 是 `answer` 且 `sdp` 为非空字符串，再将描述编码为 JSON 字符串。群聊入房传空的 `rtcDescription`。两者共用 `POST /v1/live/join`，携带当前 `Device-Id`、来电房间 ID 和空字符串 `selfId`。私聊分支在业务失败时会显示服务端的 `msg`，本地异常提示是「接听失败，请重试」。这些请求字段与 1.0.40 的实现相符。真实通话中「接听参数无效」对应的服务端校验仍待通过两端联调定位。

### 1.0.41 群聊语音房

官方网页端打开群聊时调用 `POST /v1/group/live-room`，请求体为 `{groupId}`。成员主动加入可见房间时调用 `POST /v1/live/add`，携带 `Device-Id`，请求体为 `{roomId, chatId}`，成功后使用返回的 `data.joinToken` 连接云湖 LiveKit。主动入房的路径与受邀接听分开。已核对的房间和通话请求均未提供屏幕共享的分辨率、帧率或码率配置字段。

## 验收

| 命令 | 结果 |
| --- | --- |
| `npm run preflight`、`npm run typecheck`、`npm run build` | 通过 |
| `npm run test:chat`、`npm run test:settings` | 110 和 13 项通过 |
| `npm run test:ui-calls` | 通过。两浏览器端点使用拦截的信令和模拟 RTC，覆盖二进制 offer、JSON answer、来电、接听、拒绝、取消、挂断、窄窗口、预览、静音、暂停画面、窗口状态与资源清理 |
| `YH_REAL_RTC=1 npm run test:ui-calls` | 当前宿主禁止枚举真实网络接口，Chromium 未生成直连候选地址。真实浏览器媒体互通待联调 |
| `npm run test:ui-scroll`、`node scripts/test-ui-media-devices.mjs` | 通过 |
| `npm run test:sidecar-port` | 通过。生产 Node sidecar 连续两次退出后均可立即重新绑定 8902 |
| `cargo build --offline --locked --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu`、`bash scripts/package-windows-local.sh` | 通过。解包验证了 Windows x64 程序、Node 运行文件和前端资源 |

另用独立的 Node WebRTC 环回环境验证 ICE、DTLS-SRTP 和音频、视频 RTP 包均可通过。该传输验证独立于浏览器通话界面和云湖服务。

实际云湖账号的来电、接听、挂断、异常恢复与官方客户端互通需要两端账号联调。Windows 的 WebView2 真机采集及关窗释放端口也待实测。浏览器测试可用 `PLAYWRIGHT_MODULE` 与 `CHROMIUM_EXECUTABLE` 指定环境。

## 修改文件

- 协议、信令与通话生命周期为 `src/core/yunhu-calls.ts`、`src/plugins/api.ts`、`src/plugins/ws.ts`、`src/plugins/calls.ts`、`src/core/augment.ts`。
- 入口、窗口和设置为 `src/components/ChatView.vue`、`src/components/PrivateCallPanel.vue`、`src/App.vue`、`src/app.ts`、`src/console/pages/MediaDevicesPage.vue`、`src/core/settings-catalog.ts`。
- 视频通话历史消息为 `src/satori/element.ts`。
- 测试为 `scripts/test-ui-private-calls.mjs`、`scripts/ui-fixture/fixture.ts` 和本文件。
- 版本和命令为 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
