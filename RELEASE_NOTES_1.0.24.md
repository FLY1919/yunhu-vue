# YH LaoDa 1.0.24 — 社区功能与文章编辑器

基于最新 `yunhu-richkobe-1.0.23-complete-source.zip` 增量修改，保留图片属性、EXIF 清除、消息、账号、用户 Bot 与已有桌面能力；未访问用户 GitHub 账号。

## 完成内容

- 社区文章支持点赞/取消点赞、收藏/取消收藏、评论、回复、评论点赞、作者删除评论、文章作者编辑/删除；板块创建者也可删除自己板块内的文章/评论。所有操作仍由云湖服务端核验权限。重复点击串行化，失败不伪造成功；普通文本按纯文本展示，Markdown 继续经过净化。
- 支持向用户选择的会话发送文章卡片、分享板块；文章可复制 `yunhu://post-detail?id=...` 链接。分享仅在点击“发送分享”后执行，不自动群发。
- 列表保留云湖返回的关注人数，板块详情显示关注人数；关注成功后同步已知计数。列表首次展示、分类切换、筛选、阅读区切换保留过渡，尊重系统减少动画设置。
- 发布/编辑文章接入现有云湖 API。编辑器支持六级标题、粗体、斜体、删除线、下划线、高亮、引用、无序/有序/任务列表、行内代码、代码块、链接、图片链接/上传、表格、分隔线、查找替换、撤销重做、大纲、专注、Markdown 导入导出、字符数、纯文本/Markdown 与编辑/预览/双栏切换。按钮有名称/提示，支持常用键盘快捷键，预览跟随全局主题与自定义主色。
- 草稿支持手动保存、输入停止 800ms 后保存、10/30/60 秒定时保存；每个账号最多 30 篇，保存在本机，可从顶部“草稿”恢复。保存失败显示错误并阻止关闭/发布，发布失败保留内容，成功仅清理对应草稿。草稿不跨设备同步。
- 编辑器可在主窗口与独立窗口间切换。Windows 使用独立 Tauri WebView，Web 使用弹出窗口；独立窗口不启动登录、账号保险库、WebSocket 或用户 Bot。认证和发布/上传都由主窗口处理，主题实时同步。锁定、退出账号或主窗口关闭时清理独立窗口。
- “关联群聊”列表可点击，展示介绍/人数，查询本机通讯录确认成员身份；已入群可进入对应群会话，未入群可主动发起申请。查询失败不伪造已入群状态。
- 重构用户资料抽屉：头像与身份区域、统计、资料卡、简介、板块/表情包、操作区；适配深浅主题和窄屏，增加滑入/滑出、内容过渡、加载骨架、键盘焦点与 Escape。保留原有功能，点击板块后关闭资料遮罩，修正剪贴板失败处理和迟到资料请求。
- 主窗口/托盘退出先标记退出状态，阻止监控线程在退出期间重新拉起 sidecar；主窗口关闭同时关闭编辑窗口并回收 sidecar，保留 Node 子进程 kill + wait。

编辑器提供 Typora 常用 Markdown 写作能力；没有完整复刻 Typora 的所见即所得引擎、高级公式与插件体系。草稿自动保存依赖应用仍在运行，不是后台定时发布。

## 验证

全部测试使用本机模拟接口、虚拟账号和人工构造的媒体，不登录用户账号、不发送真实消息。

- 192 项逻辑回归通过，覆盖社区请求竞态、发布失败恢复、账号隔离、草稿存储失败、消息、设置、用户 Bot、EXIF、Windows 资源完整性与已有维护功能。
- 真实 Vue + Chromium 社区回归通过：原有分页/筛选/管理/绑定/失败重试，文章工具栏、撤销重做、查找、大纲、净化、图片插入、失败/成功发布、草稿关闭和重载恢复、点赞/收藏/评论/分享、群聊跳转，独立窗口往返与全局主题同步；检查 1280/740/390/320px 布局。
- 资料面板、联系人、表情包跳转、锁定、已有图片编辑/查看器回归通过。原 1.0.23 图片属性/EXIF 的保存副本、替换附件、上传字节、方向校正及 GIF 边界回归通过。
- sidecar 连续两次监听 8902，退出后立即重新绑定成功；不终止或复用其他程序占用的端口。
- 类型检查、源码 preflight、Vite 生产构建、Node sidecar 构建、Windows x64 Rust 原生交叉编译和 NSIS 安装包生成完成；安装包解包后检查实际二进制与资源。
- **未执行 Windows 实机安装、真实云湖账号/服务端联调**。构建和模拟测试通过不代表这些外部环境已经验收。

## 源码与构建

完整源码包包含本版源码、更新的前端 dist、Node sidecar、说明和 `PATCH_1.0.24.diff`；不包含 node_modules、Rust target、账号数据、测试截图或 node.exe 二进制。Windows 安装包包含经 SHA-256 校验的 Node 运行时、WebView2 加载器与官方 Evergreen 引导安装程序。

```bash
npm ci
npm run typecheck
npm run build
node scripts/build-server-bundle.mjs
node scripts/fetch-windows-node.mjs
# Tauri 资源配置还要求 resources/dist，首次从源码构建时复制：
node -e "require('fs').cpSync('dist','src-tauri/resources/dist',{recursive:true})"
# Windows 主机可继续使用仓库的 Tauri 构建工作流/CLI。
# Linux 交叉构建需要 Rust Windows GNU target、MinGW、NSIS：
cargo build --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu --locked
WEBVIEW2_BOOTSTRAPPER=/path/MicrosoftEdgeWebview2Setup.exe bash scripts/package-windows-local.sh
```

界面测试使用 `PLAYWRIGHT_MODULE` 指定 Playwright 的入口，`CHROMIUM_EXECUTABLE` 指定 Chromium；不将测试浏览器打包进安装器。

API 字段依据项目自带 `yhchat.kt` 和公开 [yhchatAPI 社区文档](https://github.com/yh-Tpdev/yhchatAPI/blob/main/src/api/v1/community.md) 核对：点赞/收藏使用 `{id}`，评论使用 `{postId, commentId, content}`，编辑/删除文章使用 `postId`，分享板块使用 `{baId, receive}`，关注人数为 `memberNum`。
