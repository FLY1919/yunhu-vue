# YH LaoDa 1.0.26

基线：最新的 `yunhu-richkobe-1.0.25-complete-source.zip`。增量修改现有功能，未访问或推送用户 GitHub 账号。

## 修复内容

- 无法读取、损坏或无效的 EXIF 信息显示“无”；已读取到的有效属性继续展示，保留型号、软件、GPS 等优先排序。
- JPEG、PNG、WebP 清除全部标准 EXIF 区块，不再因没有 EXIF 或 EXIF 字段解析失败而禁用按钮。允许重复清除；没有 EXIF 的 GIF 生成字节不变的副本，保留动画。损坏的是图像容器而非 EXIF 字段时，仍会报告无法安全处理。
- EXIF 方向需要校正或静态图片 EXIF 损坏时，以浏览器显示方向导出 PNG。其他通常情况保留原压缩图像和动画数据。清除后重新检查 EXIF 和图像尺寸。
- GPS 坐标附加北纬、南纬、东经、西经；方向标签中文显示，非法坐标显示“无”，缺少方向的度分秒数据不会编造方向。
- 图片查看器在原始大小和缩小状态也支持鼠标左键按住拖动，关闭原生图片拖拽；松手或点击图片保持打开，点击背景/关闭按钮退出。
- 用户资料改为紧凑头像与统一概览卡，统计项对齐铺满卡片，资料字段两列排列，移除重复统计内容，保持窄屏适配。
- Markdown 编辑器仅保留写作界面，删除写作/源码/阅读切换栏、板块选择和多余的专注按钮。保留现有格式工具、导入/导出、图片、查找替换、大纲、云端草稿等能力，旧纯文本草稿仍可编辑。
- 新文章自动使用开始写作时的板块。恢复云端草稿时保留原板块 ID，避免详情接口缺失该字段后丢失发布目标。
- 缩小顶部和标题，正文获得更多空间。撤销/重做使用统一 SVG 图标；“窗口内展开”和“独立窗口”采用不同图标、文字与说明，独立窗口仅显示“返回主窗口”。
- 恢复编辑器开关、查找/链接栏、大纲、窗口大小和按钮交互过渡。锁定账号时立即关闭编辑对话框，不等待离场动画。

## 验证

- `npm run typecheck`、`npm run build`、源码 preflight、`git diff --check` 通过。
- `node scripts/test-image-properties.mjs`：12 项通过，包括 JPEG/PNG/WebP、损坏 EXIF、无 EXIF GIF、方向处理、GPS 四个方向、无效字段和 WebP 标志位。
- `node scripts/test-community.mjs`：20 项通过，包括发布目标板块、云端草稿恢复、失败保留及并发/账号切换保护。
- `node --test scripts/test-windows-assets.mjs`：2 项通过，Windows Node 官方 SHA-256、完整长度、PE 节边界及 x64 架构校验通过。
- `node scripts/test-local-image-save.mjs`：生产图片保存字节、本地凭据持久化及路径校验通过。
- `node scripts/test-sidecar-port.mjs`：实际 sidecar 在 8902 端口启动、退出、再次启动，退出后监听立即释放。
- 浏览器 `test-ui-image-properties.mjs`：真实 Vue 界面的 EXIF 搜索、空/损坏/GIF 清除、GPS、保存/附件/上传字节一致、旋转像素一致、原始比例拖动通过。
- 浏览器 `test-ui-community-extended.mjs`：工具栏、撤销/重做、导入及净化、查找/大纲动画、手动云端草稿、发布、独立窗口往返、主题同步和 1280/740/390/320px 布局通过。
- 浏览器 `test-ui-maintenance-125.mjs`：资料布局与既有引用定位/对比度回归通过。
- Windows x64 Tauri 主程序在本机构建；使用 NSIS 编译安装程序，并对解包后的程序、Node、sidecar 和前端文件进行一致性核对。

浏览器和接口测试使用本地虚拟账号及模拟上游接口。未在 Windows 真机安装运行，未使用真实云湖账号测试发布。

## 源码与构建

完整源码含本次修改、测试、既有功能以及 `PATCH_1.0.26.diff`，不含 `node_modules`、编译缓存或用户数据。

常规前端：`npm ci` → `npm run typecheck` → `npm run build`。

桌面：运行 `node scripts/build-server-bundle.mjs`、`npm run fetch:windows-node`；将 `dist` 复制到 `src-tauri/resources/dist`，再使用仓库 Windows 工作流或 `scripts/package-windows-local.sh` 构建。Windows 运行时下载脚本会验证官方哈希与文件结构。
