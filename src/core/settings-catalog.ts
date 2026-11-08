/** Searchable destinations use the same ids as the rendered settings controls. */
export const settingsCategories = [
  { id: 'general', title: '常规', icon: 'settings', group: '偏好设置' },
  { id: 'appearance', title: '外观', icon: 'sun', group: '偏好设置' },
  { id: 'security', title: '安全', icon: 'lock', group: '偏好设置' },
  { id: 'media', title: '音频与视频', icon: 'video', group: '偏好设置' },
  { id: 'notifications', title: '通知', icon: 'bellOn', group: '偏好设置' },
  { id: 'profile', title: '个人资料', icon: 'userCircle', group: '偏好设置' },
  { id: 'account', title: '账号与登录', icon: 'user', group: '偏好设置' },
  { id: 'chats', title: '聊天与消息', icon: 'chat', group: '偏好设置' },
  { id: 'connection', title: '连接', icon: 'activity', group: '高级设置' },
  { id: 'advanced', title: '应用配置', icon: 'sliders', group: '高级设置' },
  { id: 'plugins', title: '插件', icon: 'puzzle', group: '高级设置' },
  { id: 'about', title: '关于', icon: 'help', group: '高级设置' },
]
export const settingsFeatures = [
  { category: 'general', anchor: 'resource-mode', title: '节省资源', description: '减少内存、动图解码和后台渲染', keywords: '性能 低占用 RAM CPU GPU 内存 动图 省电 缓存' },
  { category: 'security', anchor: 'auto-lock', title: '安全与锁定', description: 'PIN、启动锁定、最小化锁定、失焦锁定和反截屏', keywords: '安全 最小化 焦点 失焦 分钟 锁屏 隐私 PIN 密码 截图 截屏 启动' },
  { category: 'general', anchor: 'general', title: '常用设置', description: '版本、外观模式与未读提示', keywords: '版本 深色 浅色 红点 未读' },
  { category: 'appearance', anchor: '', title: '主题与外观', description: '配色、主色调、壁纸、圆角与界面偏好', keywords: '暗色 亮色 自动 跟随系统 背景 看板娘 贴纸 字体 模糊 透明度' },
  { category: 'general', anchor: 'downloads', title: '下载目录', description: '每次询问保存位置，或直接保存到指定目录', keywords: '文件 下载 默认路径 保存 视频 选择弹窗' },
  { category: 'media', anchor: 'media-microphone', title: '麦克风与试录', description: '选择输入设备、检测电平并试听录音', keywords: '声音 音量 录音 音频 microphone' },
  { category: 'media', anchor: 'media-camera', title: '摄像头与桌面预览', description: '选择摄像头或本地预览屏幕和窗口', keywords: '视频 虚拟摄像头 分辨率 帧率 桌面采集 camera' },
  { category: 'media', anchor: 'media-private-call', title: '语音与视频通话', description: '私聊和群聊的来电、媒体输入与网络中继', keywords: '私聊通话预览 群通话 呼叫 接听 WebRTC' },
  { category: 'media', anchor: 'media-speaker', title: '扬声器与测试音', description: '选择输出设备和试听提示音', keywords: '音频 声音 音箱 耳机 speaker' },
  { category: 'notifications', anchor: 'notifications', title: '消息通知', description: 'Windows 系统通知、前台通知、软件内 Toast 与通知测试', keywords: 'toast 弹窗 免打扰 桌面 提醒' },
  { category: 'profile', anchor: 'profile', title: '编辑个人资料', description: '头像、昵称、简介、性别、生日与所在地', keywords: '改名 省市 邮编' },
  { category: 'account', anchor: 'saved-accounts', title: '多账号切换与登录', description: '识别本地已保存账号、添加账号和移除凭据', keywords: '邮箱 密码 token 账号 登录 切换 本地 恢复' },
  { category: 'account', anchor: 'account-info', title: '账号信息', description: '用户 ID、Token、VIP 与注册信息', keywords: '金币 邀请码 勋章 在线天数' },
  { category: 'account', anchor: 'devices', title: '在线设备', description: '查看登录设备及在线状态', keywords: '安全 设备' },
  { category: 'account', anchor: 'coins', title: '金币明细', description: '查看金币收支记录', keywords: '账单 收入' },
  { category: 'chats', anchor: 'conversation-list', title: '会话列表与置顶', description: '置顶优先或使用未置顶 / 置顶双 Tab', keywords: '排序 分组 标签 tab 未读' },
  { category: 'chats', anchor: 'anti-recall', title: '反撤回（测试）', description: '保留本机收到的消息、清理保留缓存', keywords: '缓存 撤回 删除' },
  { category: 'chats', anchor: 'image-editor', title: '图片查看与编辑', description: 'Ctrl + 左键查看表情，编辑后保存副本', keywords: '图片 表情 图片编辑器 裁剪 滤镜 旋转 翻转 缩放 下载' },
  { category: 'connection', anchor: 'connection', title: '连接状态', description: 'API 基址、WebSocket 状态与重新连接', keywords: '网络 断线 失败 重连' },
  { category: 'advanced', anchor: 'config-chat', title: '消息轮询', description: '拉取间隔与消息分页配置', keywords: '刷新 轮询 消息 pollMs pageSize' },
  { category: 'advanced', anchor: 'config-stickers', title: '表情包配置', description: '表情包面板、每页数量与加载偏好', keywords: '表情 数量 每页 分页 密度 stickers' },
  { category: 'advanced', anchor: 'config-quickreply', title: '快捷回复', description: '管理快捷回复文本', keywords: '快捷 文本 quickreply' },
  { category: 'advanced', anchor: '', title: '应用配置', description: '插件参数、YAML、保存与重载', keywords: '高级 配置 插件 存储 日志 日志级别 logger yaml' },
  { category: 'plugins', anchor: '', title: '插件管理', description: '查看与管理已安装的功能插件', keywords: '功能 扩展 安装 卸载' },
  { category: 'about', anchor: 'about', title: '关于 YH LaoDa', description: '客户端版本与开源组件', keywords: '帮助 协议 许可' },
]
export function searchSettings(query: string, features = settingsFeatures) {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return features.map(feature => {
    const category = settingsCategories.find(c => c.id === feature.category)?.title || ''
    const title = feature.title.normalize('NFKC').toLocaleLowerCase()
    const text = `${title} ${category} ${feature.description} ${feature.keywords}`.normalize('NFKC').toLocaleLowerCase()
    return { ...feature, categoryTitle: category, score: words.reduce((n, w) => n + (title.includes(w) ? 2 : 1), 0), matches: words.every(w => text.includes(w)) }
  }).filter(f => f.matches).sort((a, b) => b.score - a.score)
}

/** Index plugin-provided controls too, so newly registered functionality is searchable without a manual list. */
export function pluginSettingFeatures(schemas: Array<{ key: string; schema: any }>) {
  const result: typeof settingsFeatures = []
  function visit(schema: any, plugin: string, path: string, depth: number) {
    if (!schema || depth > 5) return
    if (path && schema.meta?.description) {
      const description = String(schema.meta.description)
      result.push({ category: 'advanced', anchor: 'config-' + plugin, title: description.split(/[，。\n]/)[0].slice(0, 60), description, keywords: plugin + ' ' + path })
    }
    for (const [key, child] of Object.entries(schema.dict || {})) visit(child, plugin, path ? path + '.' + key : key, depth + 1)
    if (schema.inner) visit(schema.inner, plugin, path, depth + 1)
  }
  for (const { key, schema } of schemas) visit(schema, key, '', 0)
  return result
}
