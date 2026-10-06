/**
 * quickreply 插件 —— 快捷回复
 *
 * 对标 Koishi 插件规范：导出 name + Config: Schema<Config>。
 * 控制台会按 Config Schema **自动生成设置表单**（无需手搓 UI），
 * 改完写回 yunhu.config.yml（对标 koishi.yml）。
 *
 * 存储策略：
 *   - 配置文件（yunhu.config.yml → plugins.quickreply）只提供**默认值**
 *   - 用户新增 / 隐藏的条目存在 IndexedDB（本地数据库），不回写配置文件
 *
 * 依赖：ui、chat
 */
import { reactive, watch } from 'vue'
import Schema from 'schemastery'
import type { Context } from '../core/context'
import { idbOpen, idbAll, idbPut, idbDel } from '../core/idb'
import QuickReplyPage from '../console/pages/QuickReplyPage.vue'

export const name = 'quickreply'

export interface Config {
  enabled: boolean
  items: string[]
}

/** 配置构型：控制台据此生成表单 */
export const quickReplyConfig: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('是否启用快捷回复按钮条'),
  items: Schema.array(Schema.string())
    .default(['收到 ✅', '稍等一下', '好的', '哈哈哈哈', '（溜了）'])
    .description('默认快捷回复（用户新增的存在浏览器本地数据库，不写回配置文件）'),
})

const DB_NAME = 'yunhu'
const DB_VER = 1
const PREFIX = 'qr:'

export const quickReplyPlugin = {
  name: 'quickreply',
  Config: quickReplyConfig,
  inject: ['ui', 'chat'],
  provide: ['quickreply'],

  async apply(ctx: Context, config: Config) {
    const chat = ctx.chat
    const ui = ctx.ui

    // 默认值来自 Schema 校验后的 config（已有默认值兜底）
    const defaults: string[] = Array.isArray(config?.items) && config.items.length
      ? [...config.items]
      : ['收到 ✅', '稍等一下', '好的', '哈哈哈哈', '（溜了）']

    const state = reactive({
      enabled: config?.enabled ?? true,
      /** 本地新增（IndexedDB） */
      custom: [] as string[],
      /** 本地隐藏的默认项 */
      hidden: [] as string[],
    })

    let db: IDBDatabase | null = null
    try {
      db = await idbOpen(DB_NAME, DB_VER)
      const all = await idbAll<{ id: string; text?: string; kind?: string }>(db)
      state.custom = all.filter((r) => r.id.startsWith(PREFIX) && r.kind === 'add').map((r) => r.text || '')
      state.hidden = all.filter((r) => r.id.startsWith(PREFIX) && r.kind === 'hide').map((r) => r.text || '')
    } catch (e: any) {
      ctx.logger?.warn('本地数据库打开失败，快捷回复仅使用默认项：' + e.message)
    }

    /** 最终展示：默认项（去掉隐藏的）+ 本地新增 */
    const visible = () => {
      const base = defaults.filter((t) => !state.hidden.includes(t))
      const extra = state.custom.filter((t) => !base.includes(t))
      return [...base, ...extra]
    }

    const quickreply = {
      state,
      defaults,
      visible,
      async fire(text: string) {
        try { await chat.send(text); ui.toast('已发送快捷回复', 'success', 1500) } catch { /* chat 已提示 */ }
      },
      async add(text: string) {
        if (!text || visible().includes(text)) return
        state.custom.push(text)
        if (db) { try { await idbPut(db, { id: PREFIX + 'add:' + text, kind: 'add', text }) } catch { /* 忽略 */ } }
      },
      async remove(text: string) {
        if (state.custom.includes(text)) {
          state.custom = state.custom.filter((t) => t !== text)
          if (db) { try { await idbDel(db, PREFIX + 'add:' + text) } catch { /* 忽略 */ } }
          return
        }
        if (defaults.includes(text) && !state.hidden.includes(text)) {
          state.hidden.push(text)
          if (db) { try { await idbPut(db, { id: PREFIX + 'hide:' + text, kind: 'hide', text }) } catch { /* 忽略 */ } }
        }
      },
      async restore(text: string) {
        if (state.hidden.includes(text)) {
          state.hidden = state.hidden.filter((t) => t !== text)
          if (db) { try { await idbDel(db, PREFIX + 'hide:' + text) } catch { /* 忽略 */ } }
        }
      },
      toggle() { state.enabled = !state.enabled },
    }

    /** 输入区按钮：跟随列表变化重新注册（一次性快照会导致加了条目按钮不变） */
    const syncComposer = () => {
      const list = visible()
      const items = list.map((q: string, i: number) => ({
        id: 'qr.' + i + '.' + q, kind: 'quick', value: q, label: q, order: 200 + i,
        when: () => state.enabled,
      }))
      // 第三个参数传自己的 ctx：不传会绑到 chat 插件，卸载时按钮不回收
      chat.composer('composer', items, ctx)
      chat.composerRemove?.('composer', (it: any) => it.id.startsWith('qr.') && !items.some((n) => n.id === it.id))
    }
    ctx.effect(() => {
      syncComposer()
      const stop = watch(() => [...state.custom, ...state.hidden, state.enabled], () => syncComposer(), { deep: true })
      return () => stop()
    })

    ctx.set('quickreply', quickreply)
    ctx.logger?.info(`quickreply 插件已加载（默认 ${defaults.length} 条 + 本地 ${state.custom.length} 条）`)

    ctx.inject(['console'], (c: Context) => {
      c.console.addEntry((cc: any) => {
        cc.page({ name: '快捷回复', path: '/quickreply', icon: 'bolt', order: 100, component: QuickReplyPage })
      })
    })
  },
}
