# YH LaoDa 1.0.10：撤回消息本地保留修复

基于 `yunhu-richkobe-1.0.9-complete-source.zip` 修改。基线 SHA-256：`46eacaedc8381e8c951e77620e2597decc71ae3bae568ed7295e2e72ebb74248`。

## 修改

- 启用反撤回时，只对账号、会话类型、会话 ID、消息 ID 均匹配的有效本地原文显示“已撤回 · 本地保留”，并显示对应的原始消息内容；无法匹配时隐藏该撤回消息。
- 空的 Protobuf 字段、空元素和单纯的撤回事件不再形成伪缓存。旧缓存如原始正文有效而元素为空，界面会从正文重新生成元素。
- 启用时不回填开启前的历史消息；对启用后收到的消息记录正文与消息元素。保留现有最多 2000 条、7 天以及退出账号时清除的机制。
- 处理启动时缓存尚未加载完成就收到撤回事件、后台会话收到撤回、重复推送、旧轮询响应和清空缓存后的回显；加载较早历史时补入服务端已省略的本地保留消息。
- 文本、图片、表情、音视频和文件等仍使用既有消息渲染器。媒体缓存保存的是消息内容与资源地址，不额外下载原始媒体文件；远端资源失效时不能保证继续显示或播放。

## 验证

- `npm run typecheck`、`npm run build` 通过。
- `npm run test:chat` 74 项、`npm run test:settings` 11 项、`npm run test:features` 11 项通过。
- `npm run test:recall` 13 项通过，覆盖正文匹配、空内容、跨账号与会话、数量、过期、清空、退出和异步加载。
- `npm run test:ui-recall` 在 Chromium 中验证真实 Vue 页面显示正文、图片和标记，并隐藏无匹配消息；`npm run test:ui` 与 `npm run test:ui-features` 通过。
- `npm run test:local-files` 通过。
- 本机完成 Windows x64 Tauri release 交叉编译和 NSIS 安装包构建；解包后逐项核对前端、主程序、WebView2Loader、Node 与 sidecar 与构建产物一致。

上述测试使用离线数据；未在真实 Windows 桌面执行安装，也未使用真实云湖账号验证收发、撤回或远端媒体资源的生命周期。

## 构建

```bash
npm ci
npm run typecheck
npm run test:chat
npm run test:settings
npm run test:features
npm run test:recall
npm run build
node scripts/build-server-bundle.mjs
```

Windows 打包需准备 Node Windows x64 运行时和 WebView2 安装程序，按现有 Tauri 工作流或 `scripts/package-windows-local.sh` 构建。浏览器回归需单独准备 Playwright 和 Chromium，可使用 `PLAYWRIGHT_MODULE` 和 `CHROMIUM_EXECUTABLE` 指定。

源码包排除 `node_modules`、Rust target、用户数据及 Windows Node 运行时；包含本版重新生成的前端和 sidecar。
