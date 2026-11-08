# Windows 通知与表情面板修复版（2026-10-26）

## 源码基线与交付内容

- 项目：`Sunwantww/yunhu-richkobe`，上游 `yibanm/yunhu-richkobe`。
- 本次以本地 `fix/chat-interaction-performance` 分支的 `c28bc1f` 为基线，增量修改。
- 本次分支：`fix/windows-toast`；应用版本保留 `1.0.4`。
- 包含上一轮 `a737067` 的链接跳转、深浅主题/对比度、引用及媒体摘要、弹窗层级、草稿/附件发送等修复，以及 `c28bc1f` 的 Windows Actions 构建流程。
- 保留 Enter 发送、Shift+Enter 换行和输入法确认不误发送。
- 包含表情包数量过多时的面板布局修复：分类与图片独立滚动、窄屏下拉选择、名称/ID 搜索、未收藏合集完整浏览。详见 [表情面板修复说明](sticker-panel-fix.md)。
- ZIP 中 `yunhu-richkobe/` 是完整可提交源码，包含隐藏目录 `.github/`，排除 `.git`、依赖目录、用户数据和本地构建目录。
- ZIP 根目录的 `changes-from-upstream.patch` 是相对 `036d87d` 的累计二进制兼容补丁，供已有该基线的仓库按需应用。完整源码和累计补丁二选一，不要重复应用。

## 新增行为

1. Windows Tauri 桌面版默认使用系统原生 WinRT Toast；在“账号 → 消息通知”或“用户设置 → 消息通知”可切换为软件内通知，偏好自动保存。
2. 软件内通知从窗口右上角开始向下堆叠，最多同时保留 5 条，并适配小窗口与减少动画偏好。
3. 两种模式共用原有消息过滤与定位逻辑：免打扰会话、自发消息、正在前台阅读的会话不弹消息通知；重复推送不重复通知。
4. 同一会话只保留最新通知。Windows 通知点击后还原最小化窗口、显示并聚焦，再跳到对应会话的对应消息。
5. Windows 通知中心中的点击回调不会被软件内通知的几秒超时清除；最多保留 100 个会话通知以限制内存。开启会话免打扰、退出登录、切换模式、插件卸载时撤销相关通知及回调。
6. 初始化尚未完成或系统调用正在进行时，退出登录/切换模式也会使旧通知失效；页面重载时清除旧的原生通知状态。
7. 系统调用失败或系统关闭应用通知时，回退到可点击的软件内提示，并在设置中展示原因。系统专注/免打扰的横幅抑制交由 Windows 管理，不额外重复弹软件内通知。
8. 普通“保存成功”“操作失败”等操作提示继续在软件内显示；选择器控制新消息通知通道。Web/其他平台使用软件内通知。
9. 设置提供“发送测试通知”按钮，便于验证实际通知通道。

## Windows 身份与运行范围

原生模块为 `src-tauri/src/notifications.rs`，通过 Tauri 自定义命令和事件桥接，不依赖 PowerShell。通知身份与现有安装器一致：`com.richkobe.yunhulaoda`。

首次发送原生通知时，在当前用户注册表的 `Software\Classes\AppUserModelId\com.richkobe.yunhulaoda` 注册名称/图标，并更新当前用户开始菜单的“云湖牢大版”快捷方式及 AUMID，因此便携版也具备通知身份。通知图标保存于 `%LOCALAPPDATA%\YunhuLaoda\notification-icon.png`。无需管理员权限。

客户端运行时才能接收消息与处理通知。进程退出时清除通知；本次不实现关闭客户端后的后台推送或冷启动消息定位。Windows 系统横幅的位置由 Windows 控制，右上角设置仅针对软件内提示。

## 验证结果与限制

已在本次 Linux 环境执行：

```bash
npm run test:chat
npm run typecheck
npm run build
node scripts/build-server-bundle.mjs
git diff --check
```

聊天/通知/表情面板离线回归共 46 项通过。测试执行真实 UI/chat 插件代码和 Vue 组件 setup，仅模拟系统/API/DOM 边界，覆盖模式持久化、消息过滤、原生点击定位、通知合并与容量上限、异步失败回退、退出登录和初始化竞态、监听器回收，以及大批表情包的搜索、分类切换、局部滚动定位和粘贴生命周期。

未完成 Windows Rust 编译与 Windows 10/11 实机验收：当前环境无 Rust 工具链及 Windows 桌面。前端构建通过不代表原生通知已实机验证。当前环境也未完成浏览器像素布局验收，离线测试中的滚动区域几何由模拟 DOM 提供。没有使用真实账号登录或发送消息。现有 Windows Actions 会构建 Tauri Rust、安装器和便携包；本次交付是源码 ZIP。

本次尝试读取 Fork 远端状态时，GitHub 连接返回 HTTP 403，响应为 `Sorry. Your account was suspended`。因此本次没有完成远端推送，也没有确认 Windows Actions 构建成功；本地提交与交付源码均已保留。

## 提交与构建

把 `yunhu-richkobe/` 的内容复制到已有 Git 仓库后，检查差异并提交；不要遗漏 `.github/`。也可在干净的 `036d87d` 基线上使用累计补丁：

```bash
git switch -c fix/windows-toast
git apply --check /path/to/changes-from-upstream.patch
git apply /path/to/changes-from-upstream.patch
git add .
git commit -m "fix: repair chat interactions and add selectable Windows notifications"
```

如果已经包含 `a737067` 或 `c28bc1f`，直接复制完整源码并查看差异，不要再应用相对 `036d87d` 的累计补丁。

提交到 Fork 的 `fix/**` 分支会触发 `.github/workflows/build-artifacts.yml`，也可以从 Actions 手动运行 **Build Windows Artifacts**。该流程上传 Windows 安装器及便携 ZIP，不发布 Release。先确认 Actions 成功再下载运行。依赖使用现有 `package-lock.json`，Rust 新增 Windows 专用依赖 `windows 0.58` 与 `winreg 0.52`，由 Cargo 在 Windows runner 解析。

## Windows 实机验收步骤

1. 分别运行安装版和便携版，打开“账号 → 消息通知”，选择 Windows 系统通知并发送测试通知；确认系统显示应用名称/图标，点击后恢复窗口。
2. 使用第二个测试账号，向未免打扰的会话发送消息，确认点击后跳到准确消息；再验证旧消息不在当前历史窗口时也能定位。
3. 最小化窗口、切到其他软件、切到客户端其他页面后分别收消息；正在前台阅读的会话应保持安静。
4. 让横幅自然消失，在 Windows 通知中心点击该条消息，确认仍能定位；同一会话连续消息应只保留最新一条。
5. 开启会话免打扰后不再通知，已有通知撤销；退出登录、切换模式、关闭应用后旧通知不能再定位到旧账号。
6. 切换“软件内通知”，检查右上角显示、多条堆叠、小窗口滚动、深浅色对比度和点击定位；重启后仍保留选择。
7. 在 Windows 设置中关闭应用通知，发送测试通知，确认设置显示原因且软件内提示可点击；重新打开后测试应恢复原生通知。
8. 启用 Windows 专注/免打扰，检查系统自行控制横幅，不出现重复的软件内新消息提示。
