# YH LaoDa 1.0.20 — 修复桌面后端无法启动

基线：`yunhu-richkobe-1.0.19-complete-source.zip` 及其 Windows 安装包。检查最新完整源码、前端入口、插件启动、Rust sidecar 启动 / 校验、Node 服务与安装器内容后修复。本次未登录、访问或推送用户 GitHub 账号。

## 已确认根因

1.0.19 安装包中的 `node.exe` 仅有 **75,497,472 字节（72 MiB）**。它是官方 Node v22.23.4 Windows x64 文件的精确前缀，但缺少最后 **11,536,712 字节**；PE 的 `.rdata` 及后续多个必需节已超出文件末尾。这不是可运行的完整 Windows 程序。

Rust 壳仍能创建错误窗口，但无法用损坏的 Node 启动后端，最终显示“后端服务未能在 65 秒内启动”。此前仅检查文件存在和解包一致性，未检查原始运行时是否完整，未能发现这个问题。

## 修复

- 将安装包中的 Node 替换为完整的 **87,034,184 字节**官方文件；版本仍为 v22.23.4，不改变运行时大版本。
- 官方校验表：<https://nodejs.org/dist/v22.23.4/SHASUMS256.txt>。
- `win-x64/node.exe` 的 SHA-256：`dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`。本次下载与该值一致。
- 新增打包校验：检查 PE 头、x64 架构、各节文件边界、签名数据边界、运行时长度和官方 SHA-256；本地打包与两条 Windows workflow 都在打包前执行检查，损坏或不匹配立即失败。
- 本地打包还检查主程序、WebView2Loader、微软 WebView2 安装引导程序、sidecar 和 HTML 引用的入口资源。微软引导程序本身为 x86，允许在 x64 Windows 上安装对应运行时。
- 新增运行时下载脚本：先下载临时文件，完整验证后才替换 `node.exe`，避免中途下载失败污染正式文件。
- Windows workflow 固定到与校验清单相同的 Node 版本。未来更新运行时时需一起更新 `scripts/windows-runtime.json` 的版本、字节数与官方校验值。

## 验证

- 运行时回归 2 项通过：官方文件通过；72 MiB 截断、同长度篡改和错误架构均被拒绝。
- 原始 1.0.19 解包文件被新增检查明确拒绝：`.rdata` 节不完整。
- 板块 10 项、安全 2 项回归通过；Vue 类型检查、preflight、生产构建与 sidecar 打包通过。
- sidecar 集成检查通过：进程身份校验、拒绝无授权请求、模拟 AI 转发与敏感字段隐藏。
- 完整生产页面启动检查通过：使用独立空数据目录、固定测试配置、模拟接口并拦截所有外部 HTTP / WebSocket，验证本地身份校验、真实插件 bootstrap、邮箱 / Token 登录页及 1.0.20 版本显示，无页面运行异常。
- 在本机使用 NSIS 重新编译 Windows x64 安装器；再次解包，运行全部 Windows 资源检查并对 Node、sidecar、所有前端文件逐项比较字节摘要，通过。
- 没有修改 Rust 原生行为；主程序与 WebView2Loader 沿用 1.0.19 安装包中的完整原文件，未重新编译 Rust 主程序。安装器、前端版本、安装登记及源码版本更新为 1.0.20。
- 未在真实 Windows 桌面运行安装器或登录真实账号；本机浏览器启动测试使用 Linux Node，不能替代原生 Windows 端到端运行。Windows Node 本次通过官方 SHA-256 和 PE 文件完整性验证。

## 安装与源码构建

完全退出旧应用后运行 1.0.20 安装包，覆盖安装到原目录即可；无需删除账号或配置。若仍出现错误，请提供 `%TEMP%\yunhulaoda-sidecar.log` 最后约 80 行，继续定位机器环境问题。

源码包保留完整源码、生产前端、sidecar、历史说明、本次补丁和新检查脚本；不包含 node_modules、Rust target、Windows Node 二进制、测试临时数据或个人凭据。

```bash
npm ci
npm run fetch:windows-node
npm run test:windows-assets
npm run typecheck
npm run build
node scripts/build-server-bundle.mjs
npm run test:sidecar-userbot
# 浏览器启动回归需自行安装 Playwright / Chromium：
PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:ui-startup
# 原生重编译与本地安装器构建沿用 scripts/package-windows-local.sh 的说明。
```
