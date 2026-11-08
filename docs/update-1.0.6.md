# 1.0.6：基于会话修复源码继续更新

## 实际基线

本次使用会话先前交付的 **`yunhu-richkobe-1.0.5-fixes-20261028.zip`**，不是直接从 GitHub 的 1.0.5 / `f3ce8bb` 重新开发，也不是上一次缺少会话修复的 `yunhu-richkobe-1.0.5-fixes-source.zip`。

原源码包 SHA-256：`49197242ce1a875d05850e81bc9eb371fdec3ed4defc19195e1fd6e43da69e2e`。

原包的维护说明保留于 `docs/fixes-2026-10-28.md`。该文档中的测试数量和未生成安装包说明属于当时记录；本次构建结果以本文为准。

## 保留原会话中的修复

- 发送引用 ID 使用 SendMsgRequest 字段 **8**，接收历史引用 ID 继续读取字段 **9**。
- 保留 Windows Toast 的 VT_LPWSTR 应用身份注册、WinRT 初始化、准确错误显示与失败重试。
- 引用定位高亮在点击目标以外或按 Escape 后消失，目标本身点击保留。
- 保留主题按钮上方的「账号与配置」入口，以及页内「账号与通知 / 应用配置」切换。
- 保留未读会话即时排序、已读/未读文字颜色和字重区分，免打扰仅影响通知和角标规则。
- 保留 HTML / Markdown 内嵌 HTML 的主题配色处理：清除难以辨认的作者强制颜色、背景、透明度，保留排版和内容及原有净化。

核对结果：合并时已核对十个关键文件与原包完全一致。随后针对本次用户新增的 Toast `0x80070490` 反馈，单独改进原生通知投递；前端通知桥接、HTML 净化、API 引用编码、导航合并及相关插件仍保留原包代码。ChatView 仅将空界面 Emoji 改为 SVG；消息组件叠加群标签与静态图标修改。

## 本次新增

| 项目 | 更新行为 |
| --- | --- |
| 通知 ACL | Tauri 构建显式生成六个已有自定义命令权限，并授权给 `main` 窗口的 `http://127.0.0.1:8902/*` 页面，修复 `native_notifications_supported not allowed by ACL`；保留原通知注册修复。 |
| Toast `0x80070490` | 不再因读取 `ToastNotifier.Setting` 返回 `ERROR_NOT_FOUND` 而提前中止发送；明确禁用状态及其他错误仍正常处理。快捷方式保存后使用 `SHChangeNotify` 通知 Shell；创建通知器/真正发送遇到缺少身份时，重建自身注册并仅重试一次。不会修改 Windows 的用户通知开关，也不借用其他应用身份。错误带创建通知器、读取设置、发送等步骤。 |
| 部分界面 Emoji 无法显示 | 金币、空聊天、通话提示、链接等静态界面图标使用内联 SVG；正文补充常见 Emoji 字体回退。用户消息的 Emoji 仍使用设备可用字体。 |
| 搜索相关度 | 名称、ID、备注精确匹配优先，其次前缀、包含，再到摘要；全局搜索跨类别排序后截取前八项，并忽略过期响应。 |
| 置顶方式 | 「账号与配置 → 账号与通知 → 会话列表」中切换「双 Tab」或「置顶在前」，即时保存。右键置顶与会话设置入口继续共用原数据。 |
| 图钉与未读 | 置顶只在卡片右侧添加图钉，没有置顶专属背景色。双 Tab 内各自未读优先；置顶在前模式先列置顶区，区内与普通区各自未读优先。未读免打扰会话也保留文字区分。 |
| 搜索与置顶交互 | 搜索覆盖全部会话，不受当前 Tab、分组折叠影响；清空搜索恢复所选 Tab。分组归属和原置顶数据保留。 |
| 群标签 | 使用不透明底色，按实际底色自动选择对比度更高的黑/白文字；兼容简写和带 alpha 的十六进制颜色，避免壁纸干扰。 |

版本已统一为 **1.0.6**：package.json、package-lock.json 的项目条目、Tauri 配置、Cargo 元数据和生成的 Cargo.lock。没有修改第三方依赖的版本约束，没有触发远端发布。

## 已执行验证

- `npm run test:chat`：**55 项通过**，包含原包 50 项及新增的 ACL、搜索、Tab/置顶持久化与群标签回归。
- `rustc --test src-tauri/src/notification_policy.rs` 生成离线测试程序并运行：**5 项通过**，覆盖缺失设置项允许实际发送、明确禁用不发送、成功不重复、身份失败只修复/重试一次、持续失败和无关错误正常上报。
- `npm run typecheck`：通过。
- `npm run build`：源码 preflight 与前端构建通过；保留 Vite 的主包体积提示。
- `node scripts/build-server-bundle.mjs`：通过。
- Windows x64 MSVC 目标的真实 release 编译通过：`cargo xwin build --cross-compiler clang --release --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml`。生成的应用 ACL 包含四个通知权限及现有重启、外链权限。
- 真实 Chromium 离线界面回归通过：置顶布局、未读免打扰样式、图钉、合并入口位置、账号/配置切换、金币 SVG、设置切换、双 Tab、搜索排序、搜索后恢复 Tab、点击外部清除高亮、HTML 及链接跟随深浅主题、不透明标签、HTML 净化和无运行时异常。
- 使用原 Tauri NSIS 模板生成 Windows x64 EXE 安装包；安装包内容包含主程序、Node、最新前端 dist 和 sidecar。

浏览器回归使用 `scripts/test-ui-regressions.mjs` 和 `scripts/ui-fixture/`，只使用虚拟账号及离线 API 数据。安装 Playwright 后可运行：

```sh
node scripts/test-ui-regressions.mjs
```

也可通过 `PLAYWRIGHT_MODULE` 指定 Playwright 模块路径，通过 `CHROMIUM_EXECUTABLE` 指定现有 Chromium。无需登录真实账号。

尚未完成 Windows 实机安装、真实账号的上游引用发送和 Toast 横幅/通知中心点击验收。安装包为本地交叉构建，未作代码签名；编译和离线验证不替代这些实机验收。

`0x80070490` 的判断依据：微软的 ToastNotifier.Setting 资料及微软文档仓库中相同错误的反馈。用户当前错误没有调用步骤，不能据此认定其机器一定是 Setting 读取失败；本次也为真实创建/发送失败补充了分步诊断和有限身份修复。

- <https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotifier.setting>
- <https://github.com/MicrosoftDocs/windows-dev-docs/issues/1431>
- <https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid>

## 构建说明

Windows 打包仍按原项目流程：构建前端和 sidecar，将 `dist` 和 Windows `node.exe` 放入 `src-tauri/resources`，再构建 Tauri NSIS。通知注册与 ACL 修复涉及原生程序，必须安装新 EXE；仅替换 dist 不足以更新这两项修复。

随附补丁相对于上述会话修复源码包生成，可用 `git apply --check` 预检。没有把旧版引用协议字段、Toast 实现或 HTML 配色覆盖回来。
