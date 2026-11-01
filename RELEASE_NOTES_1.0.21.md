# YH LaoDa 1.0.21 — 阅读比例、图片适配与板块动画

基线：最新的 `yunhu-richkobe-1.0.20-complete-source.zip`。先扫描完整源码包并检查板块页、公共样式、图片消息组件、媒体资源生命周期和 Windows 打包脚本后做增量修改。源码包未包含 Git 元数据，无法报告分支和提交 SHA；本次未访问用户 GitHub 账号。

## 变化

- 打开文章默认进入专注阅读：收起板块列表和页面级工具区，板块标题缩成一行，正文使用主要宽高。可以展开板块列表、显示关注/管理操作，或退出专注阅读。返回文章列表时恢复完整导航。
- 普通布局的侧栏按容器宽度分配 220–270px；正文使用 16px 字号、1.85 行距，宽屏最大 1000px，兼顾内容面积与长行阅读。窄窗口继续使用单栏，避免横向溢出。
- 修复聊天图片的上下/左右大块留白：不再让 HTML 宽高属性分别被最大宽高截断；按真实图片尺寸等比计算显示宽度，保留完整图片，不裁切、不拉伸，小图不强制放大。资源加载后的真实比例优先于消息中的旧尺寸。图片最大显示宽度仍为 320px，高度通过比例约束在 460px 内。
- 保留图片离屏释放、动图静态预览、悬停播放和最小化暂停；释放占位和静态预览继续使用原图显示比例。
- 板块侧栏折叠/展开、顶部收起、操作区展开、搜索结果增删与移动、文章/列表切换加入短过渡；板块和文章请求显示加载进度条。搜索与数据更新立即处理，动画不额外延迟请求。加载结束即移除进度条。
- 适配系统“减少动态效果”。动画仅限板块界面，无全局轮询或常驻动画定时器。
- 保留 1.0.20 的完整 Windows Node 运行时和校验，桌面窗口退出/托盘退出的 sidecar kill + wait 与 8902 端口释放路径未改变。

## 关键修改

`src/console/pages/CommunityPage.vue`、`src/console/components/Icon.vue`、`src/components/MessageElements.vue`、`src/core/resource-media.ts`，以及版本文件、界面回归脚本。附 `PATCH_1.0.21.diff` 便于审阅本次修改；完整源码保留历史功能和说明。

## 验证

- 板块服务 10 项回归通过；覆盖请求竞态、翻页重试、权限、草稿、退出清理。
- 真实 Vue 页面浏览器检查通过：专注阅读面积、侧栏展开/收起、操作面板、文章返回、搜索、对话框、320–1280px 尺寸、深浅色和减少动态效果。
- 真实聊天媒体检查通过：横图、长图、方图、小图、错误协议尺寸、窗口缩放及最小化释放后的比例；120 个动图的离屏释放和悬停播放检查通过。
- Vue 类型检查、源码 preflight、生产构建、sidecar 重新打包通过。
- 生产页面启动检查通过：隔离空数据目录，模拟上游，阻断外部 HTTP/WebSocket；实际插件启动和登录界面可用。
- sidecar 进程身份校验、拒绝未授权请求、模拟 AI 转发检查通过。
- Windows 运行时完整性回归 2 项通过；使用 NSIS 在本机编译安装器，解包后检查所有资源及摘要一致性。

安装器内前端、sidecar、安装登记与源码版本为 1.0.21；Rust 原生壳和 WebView2Loader 沿用 1.0.20 对应的完整二进制，本次未重新编译 Rust 主程序。未在真实 Windows 桌面安装运行或登录真实账号；浏览器与 sidecar 检查使用本机 Linux，不能替代原生 Windows 端到端验证。

## 安装与复现

完全退出旧程序后覆盖安装，无需清除本地账号或设置。

```bash
npm ci
npm run typecheck
npm run test:community
npm run build
node scripts/build-server-bundle.mjs
npm run test:sidecar-userbot
npm run fetch:windows-node
npm run test:windows-assets
# 浏览器检查需要 Playwright 和 Chromium
PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:ui-community
PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:ui-resources
PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:ui-startup
# 原生与安装器构建参照 scripts/package-windows-local.sh
```

完整源码包包含生产 dist 与生成的 sidecar；不包含 node_modules、Rust target、Windows Node 二进制、安装器、测试临时数据或个人凭据。
