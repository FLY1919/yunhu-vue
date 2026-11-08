# 云湖牢大版 1.0.7 修复说明

基于实际交付的 `yunhu-richkobe-1.0.6-conversation-source.zip` 增量修改。
基线 SHA-256：`f4abb030c2ed3247154dc8066f04c94af9ebe22f42cf472e01ccfe74fbb7f79a`。
本次没有访问用户的 GitHub 账号，也没有推送或发布 Release。

## 修复内容

- 通知、实时更新与引用：统一私聊的对端会话 ID，WS/轮询使用相同去重键；正在显示的对话不弹新消息 Toast；标题取会话名称，通知使用会话头像。定位先取得目标消息再提交，失败保留原窗口和引用；定位历史后继续轮询，不停止接收消息。轮询结果不能覆盖请求期间收到的新编辑，空推送不能擦除已加载的正文。
- 置顶/免打扰：置顶读取 `/v1/sticky/list`，支持置顶列表中单独存在的会话；通过 `/v1/sticky/add`、`delete` 和 `/v1/friend/no-notify` 同步设置。会话列表解析 protobuf 第 11 字段的免打扰状态。
- 视频：保留 type=10，读取真实时长、宽高和文件名，上传有超时/HTTP 错误处理；增加视频下载按钮和消息右键下载，按视频桶解析裸 key；播放控件不再误触灯箱。另存为先请求文件选择器以保留点击授权。
- 消息布局：视频、头像和昵称时间保持同一行结构；发送时间禁止折行；桌面和窄窗口均做几何验证。
- 表情：默认每页 24 张，支持 12/24/48/96 张并保存设置；降低每页数量会放大图片；保留搜索、分类、点击发送、右键、收藏、置顶、删除、粘贴操作；从消息定位表情时自动切到目标页。
- 群标签：按 Sender.tag.group_id 过滤；私聊不展示群标签；群标签查询、缓存和迟到响应均按群隔离。
- 反撤回（测试）：账号与配置 → 账号与通知 → 更多选项。默认关闭，开启后只保留本机已收到的内容，并标注“已撤回 · 本地保留”。按账号/会话隔离，最多 2000 条、7 天，可手动清除，退出账号时清除缓存。不会恢复开启前未缓存的消息或保证已过期媒体可下载。

## 验证与边界

- npm ci 后运行 68 项离线回归、vue-tsc 类型检查、源码 preflight、Vite 构建和服务端打包。
- Chromium 中验证深浅色、通知/引用交互、其他群标签过滤，以及 1280px / 420px 下的视频和时间布局。
- 本机使用 Rust stable + MinGW 编译 `x86_64-pc-windows-gnu` Release，并使用 NSIS 制作 x64 安装器；携带 node.exe、WebView2Loader.dll、前端 dist 和服务端 bundle。
- 未连接真实云湖账号，未在 Windows 实机进行收发消息/Toast/安装与卸载验收。协议与竞态测试使用真实模块并模拟 API、操作系统边界，不能替代真实服务器验收。

API 对照：`yh-Tpdev/yhchatAPI`，提交 `4c7e5288b14787b2c6cdd15a30b45a8e9b9af3d0`；参考 `src/full.proto`、`src/api/v1/sticky.md`、`friend.md`、`conversation.md`、`msg.md`。

## 源码与构建

完整源码保留原项目目录和 Windows Actions，不包含 node_modules、Rust target、用户凭据、运行数据或安装包二进制。`package-lock.json` / `Cargo.lock` 均包含在内。

Windows 标准构建仍可按 `.github/workflows/build-artifacts.yml` 执行。
本地跨平台打包入口为 `scripts/package-windows-local.sh`，要求已完成前端和 Windows Rust 编译，并准备 Microsoft Evergreen WebView2 官方安装引导程序。
安装前退出正在运行的旧版。用户聊天数据目录不在安装器删除范围。
