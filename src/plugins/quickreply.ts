/**
 * quickreply 插件（示例扩展）
 * 在聊天输入区注入「快捷回复」按钮条，并自带一个控制台页面。
 * 配置项（yunhu.config.yml → plugins.quickreply）：
 *   enabled: boolean
 *   items: string[]
 * 依赖：ui、chat
 */
import { reactive, watch } from 'vue'
import type { Context } from '../core/context'
import QuickReplyPage from '../console/pages/QuickReplyPage.vue'

export const quickReplyPlugin = {
  name: 'quickreply',
  inject: ['ui', 'chat'],
  provide: ['quickreply'],

  apply(ctx: Context, config: any = {}) {
    const chat = ctx.chat
    const ui = ctx.ui

    const saved = JSON.parse(localStorage.getItem('yh.quickreply') || 'null')
    // ⚠️ 优先级：**配置文件** > localStorage 兜底 > 默认值。
    // 之前 localStorage 优先，导致「改了 yunhu.config.yml 却没用」，看着像跟配置不是一套东西。
    const state = reactive({
      enabled: config.enabled ?? (saved?.enabled ?? true),
      items: (Array.isArray(config.items) && config.items.length
        ? config.items
        : (saved?.items || ['收到 ✅', '稍等一下', '好的', '哈哈哈哈', '（溜了）'])) as string[],
    })

    ctx.effect(() => {
      // 本地缓存 + **写回 yunhu.config.yml**（防抖，避免每敲一个字就落盘）
      let timer: any = null
      const stop = watch(
        () => [state.items, state.enabled] as any,
        () => {
          localStorage.setItem('yh.quickreply', JSON.stringify(state.items))
          clearTimeout(timer)
          timer = setTimeout(() => {
            // ⚠️ 配置服务叫 cfg（'config' 被 cordis 内置占用），之前写成 config 导致**静默不写**
            ;(ctx as any).cfg?.savePlugin?.('quickreply', {
              enabled: state.enabled,
              items: [...state.items],
            }).then(() => ctx.logger?.info('快捷回复已写回配置文件'))
              .catch((e: any) => ctx.logger?.warn('写回配置失败：' + e.message))
          }, 600)
        },
        { deep: true },
      )
      return () => { clearTimeout(timer); stop() }
    })

    const quickreply = {
      state,
      async fire(text: string) {
        try { await chat.send(text); ui.toast('已发送快捷回复', 'success', 1500) } catch { /* chat 已提示 */ }
      },
      add(text: string) { if (text && !state.items.includes(text)) state.items.push(text) },
      remove(i: number) { state.items.splice(i, 1) },
    }

    /**
     * 快捷回复作为「输入区按钮」由插件贡献。
     * ⚠️ 必须跟着 items 变化**重新注册**：之前是一次性快照，
     *    在设置页加了/删了条目，输入区那排按钮不会变（看着像没生效）。
     */
    const syncComposer = () => {
      const items = state.items.map((q: string, i: number) => ({
        id: 'qr.' + i + '.' + q, kind: 'quick', value: q, label: q, order: 200 + i,
        when: () => state.enabled,
      }))
      // ⚠️ 第三个参数必须传**自己的 ctx**：不传就绑到 chat 插件上，卸载本插件时按钮不会回收
      chat.composer('composer', items, ctx)
      // 清掉已经不在列表里的旧按钮
      chat.composerRemove?.('composer', (it: any) => it.id.startsWith('qr.') && !items.some((n) => n.id === it.id))
    }
    ctx.effect(() => {
      syncComposer()
      const stop = watch(() => [...state.items], () => syncComposer(), { deep: true })
      return () => stop()
    })

    ctx.set('quickreply', quickreply)
    ctx.logger?.info(`quickreply 插件已加载（${state.items.length} 条）`)

    /* ---- 控制台扩展：快捷回复页面（卸载即消失） ---- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addEntry((cc: any) => {
        cc.page({ name: '快捷回复', path: '/quickreply', icon: 'bolt', order: 100, component: QuickReplyPage })
      })
    })
  },
}
