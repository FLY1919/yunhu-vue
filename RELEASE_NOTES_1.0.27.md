# YH LaoDa 1.0.27 — 聊天输入区与 Markdown 编辑器

基线：当前本机 1.0.26 源码（提交 `3a3364a`），续接超时对话保留的编辑器修改。保留 1.0.26 的 EXIF、图片拖动、资料卡及图片可靠发送修复。未访问或推送用户 GitHub 账号。

## 主要改动

- 聊天输入区改为紧凑布局，随文字自动增高，常用附件入口常驻，其他功能收入展开菜单；保留 AI、快捷回复、录音、录像、拖放及附件编辑。
- 共用 Markdown 工具栏支持自定义常用工具、选区格式化、撤销/重做、标题、加粗、斜体、删除线、下划线、高亮、引用、列表、链接、代码、表格、公式和脚注入口。
- 保留 Enter 发送、Shift+Enter 换行和中文输入法候选确认保护；发送失败保留输入，发送期间新输入不会被成功回执清空。
- 引用栏紧凑展示发送者、摘要、图片缩略图或媒体图标，保留原消息 ID。切换会话后恢复对应文字、格式和引用。
- 聊天草稿按账号和会话分隔，防抖暂存文字，使用官方 WebSocket `inputInfo` 同步，接收 `draft_input`；冲突可选择云端或本机版本。附件仍只保存在当前运行会话内存中。
- 独立文章编辑器提供实时写作、Markdown 源文和双栏预览；支持拖动分栏、双向比例滚动、预览定位到原文、大纲、查找替换、行号、缩放和统计。
- 实时写作保留 Tiptap/ProseMirror；补充公式编辑、代码语言选择/复制、按需代码高亮和表格增删行列。KaTeX/Shiki 按需载入，预览经过已有 HTML 净化。
- Markdown 导入/导出、HTML 导出、复制为富文本、通过系统打印保存 PDF，以及独立窗口往返编辑继续可用。
- 文章停笔后防抖自动保存官方云端草稿，保留手动保存按钮；自动保存使用状态提示，不反复弹成功 Toast。保存失败保留正文和本机恢复副本。
- 修复恢复副本带旧云端 ID 时错误读取旧内容的问题；断网可打开本机副本，删除副本不会删除同 ID 云端草稿。确认保存、发布或放弃后清理对应本机副本，保存期间的新修改继续保留。
- 超过 5 万字符默认进入源文模式，并使用原生文字绘制，避免每次输入重建大量高亮节点。撤销记录、预览和统计均做容量限制或延后处理。
- 深浅色、窄屏、工具展开及模式切换过渡；遵从系统减少动态效果设置。
- 新编辑核心 `src/core/editor/core.ts` 原被全局 `core.*` 忽略规则误伤，已增加例外，确保完整源码与后续 PR 包含该文件。

## 验证结果

- `npm run typecheck`、`npm run build`（含 preflight）、`git diff --check` 通过。
- `npm run test:chat`：104 项通过。
- `npm run test:image-delivery`：9 项通过。
- `npm run test:community`：23 项通过。
- `npm run test:editor`：7 项通过。
- `npm run test:windows-assets`：2 项通过。以上合计 145 项。
- `npm run test:ui-editor`：真实 Vue 组件、模拟服务的浏览器回归通过，包括选区格式/历史、三模式、公式/代码、表格任务、分栏/同步滚动、自动保存及失败保留、独立窗口、深浅主题、320/390/740/1280 宽度、会话草稿与引用、Enter/输入法/发送失败。
- `npm run test:ui-uploads`：PNG/JPEG/WebP/GIF、缺失 MIME、上传字节保留、临时 404、回执丢失、未入库假成功、原 ID 重试及滚轮缩放通过。
- `npm run test:ui-community-extended`：工具栏、图片上传、草稿保存与重载恢复、发布失败保留/成功发布、评论/分享/关联群聊、独立窗口及窄屏回归通过。
- 长文档样本 88,904 字符，本轮 8 次自动化输入操作中位数 41 ms、最大 80 ms，浏览器 JavaScript 堆约 22 MiB。这不是整机、整个应用 RAM 或 Windows WebView2 实机性能承诺。
- `npm run test:sidecar-port`：真实打包 sidecar 两次在 8902 启动，SIGTERM 退出后立即重新绑定成功。Windows 壳原有主窗口关闭、托盘退出和最终退出清理路径保留。
- 本机 Rust 1.92 交叉编译 Windows x64 release 通过；安装器使用 NSIS 构建，包含前端、Node sidecar、官方 Node runtime、WebView2 Loader 及微软 WebView2 安装引导程序。

## 测试范围与使用说明

- 未使用真实账号联调官方云端草稿、消息和附件；网络协议验证使用模拟接口。没有在 Windows 实机启动安装器或验证系统打印对话框。
- 聊天“已提交云端同步”表示 WebSocket 已提交，不冒充服务器持久化确认；收到对应草稿推送后显示已同步。
- 实时写作会按编辑模型规范化 Markdown。需要保留复杂 HTML 或精确源文格式时使用源文/双栏模式；长文档可手动切换实时写作，但可能增加解析耗时。
- PDF 导出调用系统打印功能，需要在打印对话框选择保存 PDF。没有引入额外 PDF 引擎。
- 仍存在 Vite 大分块体积提示；未为消除提示而关闭检查。数学、代码高亮和编辑器使用按需加载。

## 主要维护入口

`Composer.vue`、`QuoteBar.vue`、`CommunityEditor.vue`、`CommunityEditorHost.vue`、`FloatingCommunityEditor.vue`、`MarkdownCanvas.vue`、`MarkdownSource.vue`、`EditorPreview.vue`、`EditorToolbar.vue`、`src/core/editor/`、`composer-drafts.ts`、`plugins/chat.ts`、`plugins/community.ts`、`plugins/ws.ts`。

## 本机构建

```bash
npm ci
npm run typecheck
npm run build
node scripts/build-server-bundle.mjs
npm run fetch:windows-node
# Windows 主机按现有 Tauri 构建流程执行；Linux 交叉编译需要 MinGW 和 NSIS。
cargo build --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu
WEBVIEW2_BOOTSTRAPPER=/path/MicrosoftEdgeWebview2Setup.exe bash scripts/package-windows-local.sh
```

源码包不包含 node_modules、Rust 编译缓存、账号凭据或用户聊天数据。依赖锁文件、构建脚本和全部新增编辑器文件均包含在内。
