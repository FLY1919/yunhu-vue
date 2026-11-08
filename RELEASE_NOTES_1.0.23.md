# YH LaoDa 1.0.23 — 图片属性与 EXIF 清除

以最新 `yunhu-richkobe-1.0.22-complete-source.zip` 为基线增量修改。未重写查看器、上传协议或图片编辑器。

## 使用

- 图片消息查看器底部工具栏，在编辑按钮旁新增“图片属性”信息图标。点击查看文件名、格式、MIME、尺寸、大小，以及设备、拍摄时间、曝光、ISO、镜头、GPS 等文件实际存在的 EXIF 字段。字段支持搜索。
- 待发送区的图片卡片增加“属性”按钮，选择、粘贴、拖入的图片均复用该入口。
- 点击“清除 EXIF”后，重新读取副本进行校验，并提供“保存副本”和“用于发送（替换附件）”；查看器中则提供“加入待发送附件”。加入或替换附件后，仍由用户点击聊天框的“发送”。不自动发送消息，不覆盖磁盘原文件，不修改已发送的原消息。
- 清除后刷新属性面板；失败显示具体原因。替换附件会清除旧上传元素缓存，避免重试时继续发送原图；预览先完成解码再替换，保留附件配文。正在上传、已经发送或会话已切换时不替换附件。
- 属性面板适配全站深浅主题和窄屏，带过渡动画、键盘焦点约束及 Escape 关闭。EXIF 读取模块按需加载，不会为所有消息或附件自动扫描 EXIF。

## 支持与边界

- JPEG、PNG、WebP 可查看和清除标准 EXIF。支持从 WebP 的 EXIF 数据块读取 TIFF 字段。
- 无需方向校正时，仅移除 EXIF 数据块；保留压缩图像、透明度、色彩配置和动画块。PNG/APNG 不改写保留块的 CRC；WebP 更新 RIFF 长度和 VP8X EXIF 标志。
- 当 EXIF 方向不为 1 时，使用浏览器解码后的正确方向输出无损 PNG 副本。原 JPEG 等文件的大小与格式可能改变。超过 3200 万像素不执行该方向校正；包含方向信息的动图不静默转成静态图，而是明确提示不支持。
- EXIF 内的设备、时间、GPS 和缩略图会一并移除。**XMP、IPTC、PNG 文字等其他元数据不属于本次清除范围**，界面也有说明；不能将本功能描述为删除一切隐私信息。
- GIF 可查看基本属性，没有标准 EXIF 清除入口，不会因清除操作丢失动画。TIFF 可读取字段，暂不支持安全清除。其他未支持格式明确说明读取限制。
- 损坏、空文件、读取失败或不能确认方向的 EXIF 不会被误报为“没有 EXIF”。不能完整解析方向时，提示先通过图片编辑器导出副本。
- 已存在的大型二进制厂商字段显示长度摘要；常见数值、短数组和文本字段显示实际值。不存在的字段不凭空补齐，远程图片不把下载时间冒充原文件修改时间。

## 验证

使用虚拟账号、人工生成的 EXIF/GPS 图片和本机模拟接口；没有登录用户账号或发送真实消息。

- 新增 8 项文件级回归：JPEG/PNG/WebP 字段与 GPS 读取、EXIF 清除及重复清除稳定性、JPEG 压缩扫描数据不变、WebP 长度/标志、APNG/WebP 动画数据保留、方向分支、GIF 边界、损坏容器和空文件。
- 真实 Vue + Chromium 链路：属性、搜索、深浅色及 360px 窄屏；清除后保存的副本、替换后的附件和实际 multipart 上传字节一致，图片消息宽高正确；旋转 JPEG 清除后的 PNG 与原图浏览器显示逐像素一致；消息查看器入口加入待发送区但不自动上传；Escape 只关闭属性面板；GIF 的清除按钮禁用。
- 现有聊天、账号设置、其他功能及用户 Bot 共 166 项回归通过。
- 原有 PNG/JPEG/WebP/GIF 上传字节、无 MIME 识别、空文件拒绝、加载失败重试及普通/Ctrl 滚轮缩放回归通过。
- Vue 类型检查、源码 preflight、生产前端构建、Node sidecar 构建通过。

## 交付与复现

本次交付完整源码 ZIP，包含更新后的生产 `dist` 和 sidecar；不包含 node_modules、测试截图、个人凭据或 Windows 安装器。本次未编译 Windows 原生壳，未做 Windows 实机安装验证。

```bash
npm ci
npm run typecheck
npm run test:image-properties
node --test scripts/test-chat-regressions.mjs scripts/test-settings-regressions.mjs scripts/test-features-regressions.mjs scripts/test-userbot.mjs
npm run build
node scripts/build-server-bundle.mjs
# 浏览器验证需要 Playwright + Chromium，可用 PLAYWRIGHT_MODULE、CHROMIUM_EXECUTABLE 指定。
npm run test:ui-image-properties
npm run test:ui-uploads
```

附 `PATCH_1.0.23.diff`，保留历史源码、配置、构建工作流和已有功能。EXIF 解析依赖 exifr 7.1.3（MIT），许可证已并入 THIRD_PARTY_NOTICES.md。
