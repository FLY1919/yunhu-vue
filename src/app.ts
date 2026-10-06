/**
 * 应用装配 —— 跑在真正的 cordis 上
 *
 *   const ctx = new Context()            // cordis 根上下文
 *   ctx.set('app', appService)           // 我们自己的「应用清单」服务（给 UI 用）
 *   ctx.plugin({ name, inject, apply })  // 每个插件都是 cordis 原生插件
 *
 * 想加功能？写一个插件（可以注册自己的控制台页面/页面元素/消息菜单），
 * 加进 registry，并在 yunhu.config.yml 的 plugins 下写它的配置即可。
 */
import { enableMobileDebug } from './core/mobileDebug'
import { shallowRef, watchEffect } from 'vue'
import { Context } from 'cordis'
import './core/augment'   // cordis 服务/事件的类型补充（声明合并）
import type { Plugin } from 'cordis'
import { configPlugin } from './plugins/config'
import { loggerPlugin } from './plugins/logger'
import { uiPlugin } from './plugins/ui'
import { themePlugin } from './plugins/theme'
import { consolePlugin } from './plugins/console'
import { apiPlugin } from './plugins/api'
import { authPlugin } from './plugins/auth'
import { adapterPlugin } from './plugins/adapter'
import { chatPlugin } from './plugins/chat'
import { wsPlugin } from './plugins/ws'
import { messageActionsPlugin } from './plugins/message-actions'
import { groupAdminPlugin } from './plugins/group-admin'
import { quickReplyPlugin } from './plugins/quickreply'
import { quickReplyConfig } from './plugins/quickreply'
import { apply as charbgPlugin } from './plugins/charbg'
import { apply as httpPlugin } from './plugins/http'
import { sessionEventPlugin } from './plugins/session-event'
import { socialPlugin } from './plugins/social'
import { botConsolePlugin } from './plugins/botconsole'
import { communityPlugin } from './plugins/community'
import { deeplinkPlugin } from './plugins/deeplink'
import { stickersPlugin } from './plugins/stickers'
import { commandsPlugin } from './plugins/commands'
enableMobileDebug()  // 安卓内置调试浮层（仅 native 环境生效，最早捕获初始化错误）

export interface RegistryItem {
  key: string
  /** cordis 插件：{ name, inject, apply } 或类 */
  plugin: Plugin | any
  desc: string
  provide?: string[]
  deps?: string[]
  core?: boolean
  config?: any
  /** 挂载后拿到的 cordis Fiber（ForkScope），用来热卸载 */
  fiber?: any
}

/** cordis 根上下文 —— 全项目共用这一个 ctx */
export const ctx: Context = new Context()

export const registry: RegistryItem[] = [
  { key: 'config', plugin: configPlugin, desc: '配置文件 · yunhu.config.yml', provide: ['cfg'], core: true },
  { key: 'logger', plugin: loggerPlugin, desc: '日志服务 · 包装 cordis logger · 注册「日志」页面', provide: ['logs'] },
  { key: 'ui', plugin: uiPlugin, desc: '主题 / Toast 提示', provide: ['ui'], core: true },
  { key: 'theme', plugin: themePlugin, desc: '主题 · 配色/壁纸/圆角 · 注册「主题」页面', provide: ['theme'], deps: ['ui'] },
  { key: 'console', plugin: consolePlugin, desc: '控制台服务 · 页面/插槽/动作注册', provide: ['console'], core: true },
  { key: 'api', plugin: apiPlugin, desc: '云湖 v1 接口封装（protobuf）', provide: ['api'], core: true },
  { key: 'http', plugin: { name: 'http', inject: ['auth'], apply: httpPlugin }, desc: 'http 服务 · ctx.http.get/post（对标 Koishi ctx.http）', provide: ['http'], deps: ['api', 'auth'] },
  { key: 'auth', plugin: authPlugin, desc: '登录态 · 注册「账号」页面', provide: ['auth'], deps: ['api'], core: true },
  { key: 'adapter', plugin: adapterPlugin, desc: '云湖适配器 · Satori 统一消息与事件', provide: ['bots', 'satori'], deps: ['api', 'auth'] },
  { key: 'chat', plugin: chatPlugin, desc: '会话/消息 · 注册「聊天」页面', provide: ['chat'], deps: ['api', 'auth'], core: true },
  { key: 'ws', plugin: wsPlugin, desc: 'WebSocket 实时收发', provide: ['ws'], deps: ['api', 'auth'], core: true },
  { key: 'message-actions', plugin: messageActionsPlugin, desc: '消息操作 · 撤回/多选/转发/引用/全选', provide: ['messageActions'], deps: ['chat', 'ui'] },
  { key: 'group-admin', plugin: groupAdminPlugin, desc: '群管理 · 成员/踢出/禁言/看板/记录搜索', provide: ['group'], deps: ['api', 'chat', 'ui'] },
  { key: 'quickreply', plugin: quickReplyPlugin, desc: '快捷回复 · 注册独立页面', provide: ['quickreply'], deps: ['ui', 'chat'] },
  { key: 'commands', plugin: commandsPlugin, desc: '机器人指令 · 标题栏入口 + 输入 / 唤起（按机器人归类）', provide: ['commands'], deps: ['api', 'chat', 'ui', 'console'] },
  { key: 'deeplink', plugin: deeplinkPlugin, desc: '云湖内链 yunhu:// 支持（加好友/文章/板块）', provide: ['deeplink'], deps: ['api', 'ui', 'chat', 'console', 'community'] },
  { key: 'stickers', plugin: stickersPlugin, desc: '表情收藏面板 + 语音消息', provide: ['stickers'], deps: ['api', 'chat', 'ui', 'console'] },
  { key: 'social', plugin: socialPlugin, desc: '通讯录 · 用户/群聊/机器人 + 添加 + 创建群聊', provide: ['social'], deps: ['api', 'ui', 'console'] },
  { key: 'botconsole', plugin: botConsolePlugin, desc: '机器人控制台 · 我创建的机器人/编辑/Token/指令', provide: ['botconsole'], deps: ['api', 'ui', 'console'] },
  { key: 'community', plugin: communityPlugin, desc: '板块（文章分区）· 创建/编辑/管理/绑定群聊', provide: ['community'], deps: ['api', 'ui', 'console'] },
  { key: 'session', plugin: sessionEventPlugin, desc: 'session/event 服务 · ctx.session() 与统一事件层', provide: ['session', 'event'], deps: ['chat', 'bots', 'satori'] },
  { key: 'charbg', plugin: { name: 'charbg', inject: ['api', 'chat', 'ui'], apply: charbgPlugin }, desc: '聊天背景 · /v1/chat-background（会话/全局）', provide: ['charbg'], deps: ['api', 'chat', 'ui', 'console'] },
]

/** 服务实例变化时 +1，组件靠它建立响应式依赖（插件热插拔后 UI 才会跟着刷新） */
const revision = shallowRef(0)
const services = new Map<string, any>()

/**
 * 「应用清单」服务：给控制台「插件」页用（列插件、热挂载/卸载）
 * 注意：服务注册本身由 cordis 管，这里只管清单展示。
 */
const appService = {
  name: 'app',
  registry,
  revision,
  services,
  version: '1.0.0',

  /**
   * 插件的 Config Schema（对标 Koishi：插件导出 Config: Schema<Config>）。
   * 控制台据此**自动生成设置表单**。这里自动从插件模块上读取。
   */
  schemaOf(key: string): any {
    const item = registry.find((r) => r.key === key)
    const plug: any = (item as any)?.plugin
    // 插件对象上直接挂 Config（我们在各插件里 export const Config）
    if (plug && (plug as any).Config) return (plug as any).Config
    return undefined
  },
  /**
   * 所有声明了 Schema 的插件（供配置页生成表单分组）。
   * 用**显式映射表**而不是遍历 plugin 对象读 Config —— 插件对象可能被 Vue reactive
   * 包一层，属性读取会拿到代理导致判断失败（实测踩到过）。
   */
  schemas(): Array<{ key: string; schema: any }> {
    const map: Record<string, any> = {
      quickreply: quickReplyConfig,
    }
    return Object.entries(map)
      .filter(([, v]) => !!v)
      .map(([key, schema]) => ({ key, schema }))
  },

  list() {
    return registry.map((i) => {
      // cordis 的插件作用域用 scope.isActive 表示「还在不在」
      const active = !!i.fiber && i.fiber.isActive !== false
      return {
        key: i.key, desc: i.desc, core: !!i.core,
        provide: i.provide || [], deps: i.deps || [],
        active,
        // 控制台「插件」页读的是 state（active / unmounted），少了这个按钮状态就全错
        state: active ? 'active' : 'unmounted',
      }
    })
  },

  /** 订阅插件清单变化（页面 onMounted 里用），返回取消函数 */
  watch(cb: () => void): () => void {
    const stop = watchEffect(() => { void revision.value; cb() })
    return stop
  },

  /** 按 key 找插件项 */
  get(key: string) { return registry.find((r) => r.key === key) },

  /** 挂载一个插件（走 cordis 原生 plugin，依赖不满足会自动挂起）；也支持传 key */
  mount(itemOrKey: RegistryItem | string) {
    const item = typeof itemOrKey === 'string' ? registry.find((r) => r.key === itemOrKey) : itemOrKey
    if (!item) return undefined
    const mod: any = item.plugin?.apply ? item.plugin : { apply: item.plugin }
    const inject = mod.inject ?? item.deps ?? []
    const fiber = ctx.plugin(
      { name: item.key, inject, apply: mod.apply.bind(mod) },
      item.config ?? {},
    )
    item.fiber = fiber
    revision.value++
    recordServices()
    return fiber
  },

  /**
   * 卸载插件（cordis 会自动回滚它注册的服务、事件、effect）。
   * 参数可以传 RegistryItem，也可以直接传 key —— 控制台页面传的是 key，
   * 之前只收 item，传 key 进来就静默什么都不做（按钮看着没反应）。
   */
  unmount(itemOrKey: RegistryItem | string) {
    const item = typeof itemOrKey === 'string' ? registry.find((r) => r.key === itemOrKey) : itemOrKey
    if (!item) return
    try { item.fiber?.dispose?.() } catch { /* 忽略 */ }
    item.fiber = undefined
    revision.value++
    recordServices()
  },

  tick() { revision.value++ },

  /** 记录当前有哪些服务（仅用于展示） */
  snapshot() {
    recordServices()
    return [...services.keys()]
  },
}

function recordServices() {
  const names = ['cfg', 'logs', 'ui', 'theme', 'console', 'api', 'http', 'auth', 'bots', 'satori', 'chat', 'ws', 'messageActions', 'group', 'quickreply', 'charbg']
  for (const n of names) {
    const v = (ctx as any).get?.(n)
    if (v) services.set(n, v)
    else services.delete(n)
  }
}

// 把 app 服务注册到 cordis（`ctx.app` 即可访问）
ctx.set('app', appService)

const itemOf = (key: string) => registry.find((r) => r.key === key)!

/**
 * 等某个服务就绪。
 * cordis 的 ctx.plugin 是**异步调度**的：mount() 返回时插件未必已经跑完 apply，
 * 所以装完一个插件必须等它把服务注册好，再装下一个（否则下一个插件的依赖取不到）。
 * 这里用 cordis 原生的 ctx.inject(deps, cb) 来等（依赖满足时回调），并加超时兜底。
 */
function waitService(name: string, ms = 3000): Promise<void> {
  if ((ctx as any).get(name)) return Promise.resolve()
  return Promise.race([
    new Promise<void>((resolve) => { ctx.inject([name] as any, () => resolve()) }),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ])
}

/** 启动：先读配置，再按配置装载其余插件（顺序 = registry 顺序） */
export async function bootstrap(): Promise<Context> {
  appService.mount(itemOf('config'))
  await waitService('cfg')
  await (ctx as any).cfg.load()

  const appCfg = (ctx as any).cfg.all().app || {}
  for (const item of registry) {
    if (item.key === 'config') continue
    const own = (ctx as any).cfg.plug?.(item.key) || {}
    item.config = { ...appCfg, ...own }
    appService.mount(item)
    // 等这个插件把它提供的服务注册好，再进行下一个（cordis 的调度是异步的）
    const first = item.provide?.[0]
    if (first) await waitService(first)
  }
  // 再给一轮让所有 inject 回调跑完
  await new Promise((r) => setTimeout(r, 50))

  if (appCfg.title) document.title = appCfg.title
  ctx.emit('ready' as any)
  return ctx
}

export const app = appService
