/** ui 插件：主题、Toast 提示、视图状态（主题可由配置文件的 app.theme 指定） */
import { reactive } from 'vue'
import type { Context } from '../core/context'

export const uiPlugin = {
  name: 'ui',
  provide: ['ui'],

  apply(ctx: Context, config: any = {}) {
    const saved = localStorage.getItem('yh.theme') || config.theme || 'dark'
    const state = reactive({ theme: saved, toasts: [] as any[], panel: 'chat' })
    let seq = 0

    const ui = {
      state,
      toast(text: string, type = 'info', ms = 3200) {
        const id = ++seq
        state.toasts.push({ id, text, type })
        setTimeout(() => ui.dismiss(id), ms)
        return id
      },
      dismiss(id: number) {
        const i = state.toasts.findIndex((t: any) => t.id === id)
        if (i >= 0) state.toasts.splice(i, 1)
      },
      setPanel(p: string) { state.panel = p },
      setTheme(t: string) {
        state.theme = t
        localStorage.setItem('yh.theme', t)
        applyTheme(t)
      },
      toggleTheme() { ui.setTheme(state.theme === 'dark' ? 'light' : 'dark') },
    }

    function applyTheme(t: string) { document.documentElement.dataset.theme = t }

    ctx.effect(() => { applyTheme(state.theme); return () => { /* 随插件卸载回收 */ } })

    ctx.on('ui/toast', ({ text, type }: any) => ui.toast(text, type))
    ctx.set('ui', ui)
  },
}
