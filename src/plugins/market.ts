/**
 * market 插件 —— 允许用户自己安装插件（对标 Koishi 插件市场）
 *
 * 设计：浏览器端「运行时插件」= 一段 JS 模块，导出 apply(ctx) 或 { name, apply, Config }。
 * 用户可以：
 *   · 从 URL 安装（GitHub raw / jsDelivr / 任意直链）
 *   · 粘贴代码安装
 *   · 启用 / 禁用 / 卸载
 *   · 已装的插件存在 IndexedDB，刷新后自动重新装载
 *
 * 装载方式：把模块源码转成 Blob URL，用动态 import() 载入（浏览器原生 ESM）。
 * 插件拿到的 ctx 与主应用同一个，所以能注册页面/插槽/菜单/动作 —— 万物皆插件。
 *
 * ⚠️ 安全提示（写给用户看）：第三方插件能读到你的 token，只装信任的来源。
 */
import { reactive, h } from 'vue'
import { idbOpen, idbAll, idbPut, idbDel } from '../core/idb'
import type { Context } from '../core/context'
import MarketPage from '../console/pages/MarketPage.vue'

const DB = 'yunhu'
const VER = 1
const PREFIX = 'plugin:'

export interface InstalledPlugin {
  id: string        // 唯一 id（用来源 URL 或用户起名）
  name: string
  source: string    // 'url' | 'code'
  url?: string
  code?: string
  enabled: boolean
  installedAt: number
}

export const marketPlugin = {
  name: 'market',
  inject: ['api', 'ui', 'chat'],
  provide: ['market'],

  async apply(ctx: Context) {
    const ui = ctx.ui

    const state = reactive({
      installed: [] as InstalledPlugin[],
      loading: false,
      error: '',
    })

    /** 当前已装载的用户插件（id -> 卸载函数） */
    const loaded = new Map<string, () => void>()

    let db: IDBDatabase | null = null
    try {
      db = await idbOpen(DB, VER)
      const all = await idbAll<any>(db)
      state.installed = all
        .filter((r) => r.id.startsWith(PREFIX))
        .map((r) => ({ ...r, id: r.id.slice(PREFIX.length) }))
    } catch { /* 忽略 */ }

    async function persist(p: InstalledPlugin) {
      if (!db) return
      try { await idbPut(db, { ...p, id: PREFIX + p.id }) } catch { /* 忽略 */ }
    }
    async function unpersist(id: string) {
      if (!db) return
      try { await idbDel(db, PREFIX + id) } catch { /* 忽略 */ }
    }

    /** 装载一个用户插件：拉源码 → 转 Blob → 动态 import → 调 apply */
    async function loadPlugin(p: InstalledPlugin) {
      if (loaded.has(p.id)) return { ok: true }
      let code = p.code || ''
      if (p.source === 'url' && p.url) {
        try {
          const res = await fetch(p.url)
          if (!res.ok) throw new Error('HTTP ' + res.status)
          code = await res.text()
        } catch (e: any) {
          return { ok: false, msg: '下载失败：' + e.message }
        }
      }
      if (!code.trim()) return { ok: false, msg: '插件代码为空' }

      try {
        // 浏览器原生 ESM：把源码变成 Blob URL 后 import
        const blob = new Blob([code], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        const mod: any = await import(/* @vite-ignore */ url)
        URL.revokeObjectURL(url)

        /*
         * 运行时插件需要 h 来写渲染函数（它没有编译期，template 字符串用不了）。
         * 这里把 Vue 的 h 挂到 ctx 上，插件用 ctx.h(...) 即可。
         */
        ;(ctx as any).h = h
        const fn = mod.apply || mod.default?.apply || (typeof mod.default === 'function' ? mod.default : null)
        if (typeof fn !== 'function') return { ok: false, msg: '插件需导出 apply(ctx) 函数' }

        // 用 cordis 装载：fork 一个子作用域，卸载时自动回收它注册的一切
        const fork = ctx.plugin(fn as any, {})
        loaded.set(p.id, () => { fork?.dispose?.(); loaded.delete(p.id) })
        return { ok: true, name: mod.name || mod.default?.name || p.name }
      } catch (e: any) {
        return { ok: false, msg: '装载失败：' + (e?.message || e) }
      }
    }

    /** 安装：从 URL 或代码 */
    async function install(input: { name: string; url?: string; code?: string }) {
      state.loading = true
      state.error = ''
      try {
        const id = (input.name || (input.url || 'local')).replace(/[^a-zA-Z0-9_.-]/g, '_')
        const p: InstalledPlugin = {
          id,
          name: input.name || id,
          source: input.url ? 'url' : 'code',
          url: input.url,
          code: input.code,
          enabled: true,
          installedAt: Date.now(),
        }
        const r = await loadPlugin(p)
        if (!r.ok) { state.error = r.msg; return false }
        const i = state.installed.findIndex((x) => x.id === id)
        if (i >= 0) state.installed[i] = p
        else state.installed.push(p)
        await persist(p)
        ui.toast('已安装：' + p.name, 'success')
        return true
      } finally {
        state.loading = false
      }
    }

    /** 卸载 */
    async function uninstall(id: string) {
      const stop = loaded.get(id)
      if (stop) stop()
      state.installed = state.installed.filter((x) => x.id !== id)
      await unpersist(id)
      ui.toast('已卸载', 'success')
    }

    /** 启用 / 禁用 */
    async function toggle(id: string) {
      const p = state.installed.find((x) => x.id === id)
      if (!p) return
      if (p.enabled) {
        const stop = loaded.get(id)
        if (stop) stop()
        p.enabled = false
      } else {
        const r = await loadPlugin(p)
        if (!r.ok) { state.error = r.msg; return }
        p.enabled = true
      }
      await persist(p)
    }

    /** 启动时自动装载所有启用的插件 */
    for (const p of state.installed) {
      if (p.enabled) await loadPlugin(p)
    }

    ctx.set('market', { state, install, uninstall, toggle })
    ctx.logger?.info(`market 插件已加载（已装 ${state.installed.length} 个用户插件）`)

    ctx.inject(['console'], (c: Context) => {
      c.console.addEntry((cc: any) => {
        cc.page({ name: '插件市场', path: '/market', icon: 'puzzle', order: 120, component: MarketPage })
      })
    })
  },
}
