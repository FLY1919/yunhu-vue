# YH LaoDa 1.0.36 音视频设备验收记录

基线为已交付的 1.0.35 完整源码 ZIP。本地 1.0.35 工作区与 ZIP 中的源码内容一致。设备设置保存于本机当前应用来源。麦克风和物理摄像头偏好用于已有聊天录制，扬声器偏好用于本地试听与聊天媒体播放。桌面源仅供设置内本地预览，每次都要从系统选择器重新授权。试录最多 10 秒，样本在离开设置时释放。

## 云湖协议核对

依据 [yhchatAPI 的 live 文档](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/api/v1/live.md)、[WebSocket 文档](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/api/wss/chat-ws-go.jwzhd.com.md) 和 [Protobuf 定义](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/full.proto) 核对。下表记录文档中的请求和示例响应，验证范围为公开源码与文档审阅。

| 文档路径 | 请求体 | 鉴权 | 响应及错误码 |
| --- | --- | --- | --- |
| `POST https://chat-go.jwzhd.com/v1/live/add` | JSON `roomId`、`chatId` | 请求头 `token` | `code: 1`，`data.joinToken` 用于连接语音频道的 `wss://livekit.jwznb.com`。失败码未记录 |
| `POST /v1/live/close` | JSON `roomId` | 语音频道管理员的 `token` | `code: 1`，`msg: "success"`。失败码未记录 |
| `POST /v1/live/hang_up` | JSON `roomId` | 请求头 `token` | `code: 1`，`data: {}`。文档用途为挂断语音频道，失败码未记录 |
| `POST /v1/live/room-info` | JSON `roomId` | 请求头 `token` | `code: 1`，`data.room` 包含 `roomId`、`chatId`、`chatType`、`status` 等。失败码未记录 |
| `POST /v1/live/title-edit` | JSON `roomId`、`title` | 语音频道管理员的 `token` | `code: 1`，`msg: "success"`。失败码未记录 |
| `POST /v1/live/get-calling` | 文档无请求体 | 被呼叫账号的 `token` | `code: 1`，`data.callTime`、`data.chatType`、呼叫者资料和消息。示例为 `contentType: 13`、含音频 SDP offer 的 `content`。无来电与失败响应未记录 |
| `POST /v1/live/stream-info` | JSON `roomId` | VIP 用户的 `token` | `code: 1`，`data.streamKey` 和 WHIP 推流 URL。无效鉴权 `-101`，非 VIP `-1` |
| `wss://chat-ws-go.jwzhd.com/ws` | `live_video_user_hang_up` 服务端事件 | 先发 JSON `login`，携带 `userId`、`token`、`platform`、`deviceId` | `LiveMessage` 的 Protobuf 字段 `msg_id = 1`、`cmd = 5`。未记录此事件专用错误码 |

来电查询和单一挂断事件不足以确定私聊通话的发起、接听、拒绝、SDP answer、ICE 候选交换和视频发布协议。未执行真实账号呼叫联调。未接入上述任何实时接口，私聊工具栏和更多菜单没有发布通话入口。待接入组件只负责 SVG 按钮、可访问名称和请求期间禁用。

现有聊天媒体继续使用 [消息发送协议](https://github.com/yh-Tpdev/yhchatAPI/blob/7c72f88d2d4858ff8459a901ed77354754a55f4c/src/api/v1/msg.md)。`POST /v1/msg/send-message` 使用 `token` 头和 Protobuf，请求包含消息 ID、会话 ID、会话类型、消息类型及内容。视频为类型 10，使用视频资源 key。语音为类型 11，带语音资源 key 与 `audio_time`。现有资源上传经过 `GET /v1/misc/qiniu-token-video`、`GET /v1/misc/qiniu-token-audio` 或 `GET /v1/misc/qiniu-token2` 获取上传令牌，再向七牛上传文件。设备测试不会调用这些接口。

## Windows 与本地验收

Windows 壳继续以本机 HTTP 页面使用 WebView2。采集由 `getUserMedia` 和 `getDisplayMedia` 提供，输出路由视 `setSinkId` 支持与授权而定。应用依赖系统权限和原生桌面选择器，未修改宿主授权策略。系统停止采集、窗口最小化、锁定、页面离开和迟到授权都有清理路径。Tauri 主窗口销毁、托盘退出及事件循环退出使用已有的 sidecar 终止并等待回收逻辑。

| 命令 | 结果 |
| --- | --- |
| `npm run preflight` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，Vite 报告大块体积提醒 |
| `node scripts/build-server-bundle.mjs` | 通过 |
| `npm run test:chat`、`npm run test:settings`、`npm run test:editor` | 110、13、7 项通过 |
| `npm run test:community`、`npm run test:maintenance`、`npm run test:windows-assets` | 24、2、2 项通过 |
| `npm run test:ui-scroll`、`npm run test:ui-features` | 通过 |
| `node scripts/test-ui-media-devices.mjs` | 通过。浏览器使用合成麦克风、摄像头，模拟系统选择器、设备热插拔、输出路由、拒绝权限与迟到授权。覆盖设备选择、电平、实际试录试听、切换、清理、偏好、深浅主题及窄窗口 |
| `npm run test:sidecar-port`、`node scripts/test-port-release.mjs` | 通过。Linux 宿主实际启动生产 Node sidecar，结束后重新绑定 8902 |
| `cargo build --offline --locked --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu` | 通过。生成 Windows x64 应用 |
| `bash scripts/package-windows-local.sh` | 通过。生成 NSIS 安装包，解包后验证 Windows 运行文件及前端资源 |
| `git diff --cached --check`、`unzip -tq yunhu-richkobe-1.0.36-complete-source.zip` | 通过 |

浏览器测试通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE` 指定本地测试环境。Windows 打包需项目的 `node.exe`、`WebView2Loader.dll` 和 `WEBVIEW2_BOOTSTRAPPER` 指向的 Microsoft Evergreen 安装程序。

当前宿主为 Linux。Windows 实机的安装、WebView2 真实授权、实体设备热插拔、原生桌面选择器和关闭窗口后的端口回收仍待现场验证。

## 修改文件

- 设备管理与清理为 `src/console/pages/MediaDevicesPage.vue`、`src/core/media-devices.ts`、`src/core/use-media-capture.ts`。
- 设置入口、搜索和图标为 `src/console/pages/AccountConfigPage.vue`、`src/core/settings-catalog.ts`、`src/console/components/Icon.vue`。
- 通话组件与顶栏说明为 `src/components/CallToolbarButtons.vue`、`src/components/ChatView.vue`。
- 现有媒体使用设备偏好为 `src/plugins/stickers.ts`、`src/components/A2uiNode.vue`、`src/components/ChatVideo.vue`、`src/components/Composer.vue`、`src/components/FloatingVideoPlayer.vue`、`src/components/MessageElements.vue`。
- 版本为 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 验证为 `scripts/test-ui-media-devices.mjs` 和本文件。
