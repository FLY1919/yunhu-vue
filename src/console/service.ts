/**
 * Console 服务（对标 @koishijs/plugin-console）
 * ------------------------------------------------------------------
 * 后端风格 API（插件在自己的 apply 里调用）：
 *   ctx.console.addEntry(clientEntry)        注册一个「客户端入口」
 *   ctx.console.addListener(name, cb, opts)  注册一个可供前端 send() 调用的接口
 *
 * 客户端风格 API（在客户端入口里调用，前后端同构所以可直接用）：
 *   ctx.page({ name, path, icon, order, component, fields, authority })
 *   ctx.slot({ type, component, order, disabled })
 *   ctx.action(id, { action, disabled })
 *   ctx.menu(id, items)
 *   send(name, ...args)                      调用后端 listener
 *
 * 所有注册都会绑定到「调用它的上下文」，插件卸载时自动移除对应页面/插槽。
 */
import { reactive, markRaw } from 'vue'
import { Service, Context } from '../core/context'

export class ConsoleService extends Service {
  state: any
  listeners: Map<string, { cb: (...a: any[]) => any; options: any }>

  constructor(ctx) {
    super(ctx, 'console', true)
    this.state = reactive({
      pages: [],        // 已注册页面
      slots: [],        // 已注册插槽
      actions: {},      // 动作表
      menus: {},        // 菜单表
      entries: [],      // 客户端入口
      settings: [],     // 用户设置（对标 Koishi ctx.settings，与插件配置分离）
    })
    this.listeners = new Map()
  }

  /* ---------------- 后端风格 ---------------- */

  /**
   * 注册客户端入口：entry 可以是函数，或 { dev, prod, client }
   *
   * 这里**不再用 Proxy hack**（换成真 cordis 之后，代理包住 ctx 会让 page/slot 丢掉）。
   * 改成显式把「调用方的 ctx」传下去：谁调的 addEntry，注册的页面就挂在谁身上，
   * 那个插件卸载时页面自动消失。
   */
  addEntry(entry) {
    const owner = this.ctx
    const fn = typeof entry === 'function' ? entry : (entry.client || entry.prod || entry.dev)
    this.state.entries.push(markRaw(entry))
    if (typeof fn !== 'function') return

    // 客户端入口拿到的东西：Koishi 风格的 cc.page / cc.slot / cc.action / cc.menu / cc.send
    const facade = {
      page: (cfg) => this.page(cfg, owner),
      slot: (cfg) => this.slot(cfg, owner),
      action: (id, impl) => this.action(id, impl, owner),
      menu: (id, items) => this.menu(id, items, owner),
      settings: (cfg) => this.settings(cfg),
      send: (name, ...args) => this.send(name, ...args),
    }
    try { fn(facade) } catch (e) { console.error('[console] client entry error', e) }

    // 卸载时：从入口列表移除（页面/插槽由各自的 effect 回收）
    owner.effect(() => () => {
      const i = this.state.entries.indexOf(entry)
      if (i >= 0) this.state.entries.splice(i, 1)
    })
  }

  /** 注册一个前端可调用的接口 */
  addListener(name, cb, options = {}) {
    const owner = this.ctx
    this.listeners.set(name, { cb, options })
    owner.effect(() => () => this.listeners.delete(name))
  }

  /** 前端调用后端接口 */
  async send(name, ...args) {
    const hit = this.listeners.get(name)
    if (!hit) throw new Error(`未注册的接口：${name}`)
    return hit.cb(...args)
  }

  /* ---------------- 客户端风格 ---------------- */

  page(config, owner = this.ctx) {
    const entry = markRaw({ order: 100, icon: 'page', ...config })
    this.state.pages.push(entry)
    this._sort()
    owner.effect(() => () => {
      const i = this.state.pages.indexOf(entry)
      if (i >= 0) this.state.pages.splice(i, 1)
    })
    return entry
  }

  slot(config, owner = this.ctx) {
    const entry = markRaw({ order: 100, ...config })
    this.state.slots.push(entry)
    this.state.slots.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    owner.effect(() => () => {
      const i = this.state.slots.indexOf(entry)
      if (i >= 0) this.state.slots.splice(i, 1)
    })
    return entry
  }

  action(id, impl, owner = this.ctx) {
    this.state.actions[id] = impl
    owner.effect(() => () => { delete this.state.actions[id] })
  }

  menu(id, items, owner = this.ctx) {
    this.state.menus[id] = items
    owner.effect(() => () => { delete this.state.menus[id] })
  }

  /** 执行一个动作 */
  async run(id, payload) {
    const impl = this.state.actions[id]
    if (!impl) return
    if (impl.disabled?.()) return
    return impl.action?.(payload)
  }

  slotsOf(type) { return this.state.slots.filter(s => s.type === type && !s.disabled?.()) }

  /**
   * 注册「用户设置」表单（对标 Koishi ctx.settings）。
   * 与插件配置的区别：
   *   · 插件配置 = 管理员决定，存 yunhu.config.yml
   *   · 用户设置 = 每个用户自己决定，存 IndexedDB（如主题、语言、气泡样式）
   *
   * usage: ctx.console.settings({ id: 'appearance', title: '外观', schema })
   */
  settings(config) {
    const entry = markRaw(config)
    this.state.settings.push(entry)
    return () => {
      const i = this.state.settings.indexOf(entry)
      if (i >= 0) this.state.settings.splice(i, 1)
    }
  }

  /** 取某个用户设置项 */
  settingsOf(id) { return this.state.settings.find((x) => x.id === id) || null }
  /** 当前页（由 Console.vue 同步进来，Class 里要用 = 而不是 :） */
  currentPage = ''

  /**
   * 跳到控制台某个页面。
   *   ctx.console.goto('/community')
   * 之前我直接调 ctx.console.navigate(...) —— 那个方法压根不存在，
   * 所以「点击板块跳转」是静默失效的。
   */
  goto(path: string) {
    const hit = (this.state.pages || []).find((p: any) => p.path === path)
    this.currentPage = path
    if (!hit) return false
    return true
  }

  get pages() { return this.state.pages }

  _sort() { this.state.pages.sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }
}

/** 供前端直接 import 的 send */
export function send(ctx, name, ...args) { return ctx.console.send(name, ...args) }
