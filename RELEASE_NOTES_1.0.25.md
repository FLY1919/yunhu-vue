# YH LaoDa 1.0.25 — 图片发送确认、单页 Markdown 与云端草稿

基于 `yunhu-richkobe-1.0.24-complete-source.zip` 的完整源码增量更新，保留原有聊天、社区、用户 Bot、独立编辑窗口和图片编辑功能。

## 本版调整

- 引用消息采用不透明主题底色、清晰的正文与发送者颜色和边框；在浅色壁纸、自定义浅色强调色及深浅主题下保持可读。个人资料页三项统计卡片宽度缩小约 20%，同步缩小字号、留白与圆角。
- 远处引用保留预览查询获得的原消息及序号；上下文未返回目标时补查单条、按实际游标翻查历史，识别重复页、限制查找时间。显示定位状态并允许取消；切换会话、账号或发送新消息后忽略迟到结果。临时无结果不再声称消息已删除，失败不清空聊天。
- 完整读取 EXIF 的 IFD0、IFD1、Exif、GPS、Interop、厂商原始数据和用户备注，补充整文件中的 XMP、IPTC、ICC。保留未知标签；按设备型号、软件、GPS、厂商/镜头、拍摄时间排序。长备注和大段二进制数据可展开查看，不再截断后丢失。厂商私有数据提供原始内容，不承诺解析所有专有 MakerNote 格式。
- 图片属性改为只读。图片编辑器新增“EXIF 隐私”：清除、保存副本或应用到待发送附件；查看器中的编辑器也可加入待发送附件。无像素编辑时保留原压缩数据和格式；含旋转方向的静态图片先校正方向再导出 PNG。GIF/其他不支持 EXIF 删除的格式明确提示；原图保持完整。
- Markdown 默认改为单页即时编辑，参照 MarkText 的写作方式，使用按需加载的 Tiptap/ProseMirror 编辑内核。保留源码/阅读切换、六级标题、粗斜体、删除线、下划线、高亮、列表、任务勾选、引用、代码、链接、图片、表格、查找替换、大纲、导入导出、撤销重做和全局主题适配。没有嵌入 MarkText 桌面程序或其完整功能。
- 草稿改为一个手动“保存草稿”按钮，取消输入自动保存、间隔保存和关闭时自动上传。接入官方 `posts/create-draft`、`posts/get-draft`、`posts/cancel-draft`；更新后使用服务端返回的新草稿 ID，发布时传入 `draftId`。读取云端列表、继续编辑与删除；旧版服务通过 `my-post-list` 的 `isDraft` 筛选兼容。旧版本机草稿保留为可手动迁移的记录。保存失败保留编辑内容，未保存关闭需要用户在应用中确认；独立窗口通过主窗口处理保存与认证。
- 加固图片上传与发送：根据真实 PNG/JPEG/WebP/GIF 文件头校正 MIME 和扩展名，保留文件字节；校验上传返回大小；图片发送使用原始对象 key 和真实尺寸。发送前以小范围读取核对图片资源，发送后核对服务端消息 ID、类型及图片 key。空 HTTP 200、资源未就绪、返回错误内容或缺少图片记录都不会当作成功清除附件。手动重试沿用同一消息 ID，并先检查是否已入库，避免丢失响应后重复发图；不会自动重发不确定的消息。

## 验证

使用虚拟账号、本机模拟接口和人工构造的图片，不登录用户账号、不向真实会话发送消息。

- 155 项逻辑回归通过：聊天与引用 104、社区与云端草稿 18、图片属性 9、图片发送/草稿协议 9、已有功能 13、Windows 资源 2。
- 真实 Vue + Chromium 界面回归通过：单页编辑、格式工具、表格、任务勾选与对齐、撤销/重做、查找、大纲、净化、图片插入、手动云端草稿保存/恢复、发布失败恢复、独立窗口往返与主题同步；检查 1280/740/390/320px。
- 图片完整链路通过：PNG/JPEG/WebP/GIF 上传原始字节、正确 key/尺寸、资源短暂 404、空文件、EXIF 清除后保存字节与实际上传字节一致、方向 6 的像素一致性。模拟丢失发送响应和“HTTP 成功但未入库”，确认附件保留；重试复用 ID/key，不重复上传或盲目重发。
- 远处引用加载并高亮；浅色自定义强调色配明亮壁纸时，引用正文/发送者对比度均至少 4.5；统计卡片在宽屏和 320px 窄屏显示正常。已有图片文字/画笔、GIF 帧与时序、缩放、锁定和联系人回归通过。
- 类型检查、源码 preflight、Vite 生产构建、Node sidecar、Windows x64 Rust 本地交叉编译和 NSIS 安装包生成通过。安装包解包核对实际主程序、Node、WebView2 加载器、sidecar 和前端资源。
- 真实 sidecar 在 8902 连续启动两次，每次退出后立即重新绑定成功；保留既有桌面退出时终止并等待子进程、阻止退出期间被监控重新拉起的处理。

**未执行 Windows 实机安装及真实云湖账号/官方客户端联调。** 本版验证了模拟接口下的协议和异常恢复；官方云端的实际响应、审核和客户端展示仍受上游服务影响。图片暂未确认时会留在待发送区并显示原因，不宣称对方已收到。

## 构建

```bash
npm ci
npm run typecheck
npm run build
node scripts/build-server-bundle.mjs
node scripts/fetch-windows-node.mjs
node -e "require('fs').cpSync('dist','src-tauri/resources/dist',{recursive:true})"
# Windows 主机使用既有 Tauri CLI / 工作流；Linux 需要 Windows GNU Rust target、MinGW、NSIS：
cargo build --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu --locked
WEBVIEW2_BOOTSTRAPPER=/path/MicrosoftEdgeWebview2Setup.exe bash scripts/package-windows-local.sh
```

完整源码包包含源码、锁文件、测试、图片样例、许可证、更新的根目录 dist、sidecar 和文本补丁；不包含 node_modules、Rust target、账号数据、测试截图或 Windows Node 二进制。安装包包含经 SHA-256 校验的 Windows Node、WebView2 加载器与官方 Evergreen 引导程序。

参考：[MarkText](https://github.com/marktext/marktext)、[公开云湖社区接口说明](https://github.com/yh-Tpdev/yhchatAPI/blob/main/src/api/v1/community.md)、[消息协议](https://github.com/yh-Tpdev/yhchatAPI/blob/main/src/full.proto)；兼容列表入口依据项目自带 `yhchat.kt`，不对未知写接口自动重试。
