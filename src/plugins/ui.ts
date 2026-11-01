/** ui 插件：主题、Toast 提示、视图状态（主题可由配置文件的 app.theme 指定） */
import { reactive } from 'vue'
import type { Context } from '../core/context'
import { openExternalUrl } from '../core/links'
import { createNativeNotifications } from '../core/notifications'

export interface ToastOptions {
  title?: string
  avatar?: string
  key?: string
  onClick?: () => void | Promise<void>
}
interface NativeToast extends ToastOptions { id: number; nativeId: string; text: string; ms: number }

export const uiPlugin = {
  name: 'ui',
  provide: ['ui'],

  apply(ctx: Context, config: any = {}) {
    // 主题三态：auto（跟随系统色）/ dark / light。默认 auto；手动切换为覆盖。
    const saved = localStorage.getItem('yh.theme') || config.theme || 'auto'
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const sysDark = () => mq?.matches ?? true
    const effective = (t: string) => (t === 'auto' ? (state.systemDark ? 'dark' : 'light') : t)
    const preferredMode = localStorage.getItem('yh.notification.mode')
    const state = reactive({ theme: saved, systemDark: sysDark(), toasts: [] as any[], panel: 'chat', confirmReq: null as any,
      notificationMode: preferredMode === 'in-app' ? 'in-app' : preferredMode === 'windows' ? 'windows' :
        ((window as any).__TAURI__ ? 'windows' : 'in-app'),
      nativeNotificationsAvailable: false, nativeNotificationsSupported: false, notificationError: '',
    })
    let seq = 0
    let disposed = false
    let windowMinimized = false
    const instance = Math.random().toString(36).slice(2, 10)
    const nativeTimeoutMs = Math.max(10, Number(config.nativeTimeoutMs) || 8000)
    const nativeToasts = new Map<number, NativeToast>()
    const native = createNativeNotifications((id) => {
      const toast = [...nativeToasts.values()].find(t => t.nativeId === id)
      if (toast) void ui.activate(toast.id)
    }, (id, error) => {
      const toast = [...nativeToasts.values()].find(t => t.nativeId === id)
      if (toast) fallback(toast, error)
    })
    state.nativeNotificationsSupported = native.available
    void native.ready.then(available => {
      if (!disposed) {
        state.nativeNotificationsAvailable = available
        state.nativeNotificationsSupported = native.supported
        if (native.error) state.notificationError = native.error
      }
    })
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    const hiddenMessageDelays = new Map<number, number>()
    let confirmResolve: ((ok: boolean) => void) | null = null

    const ui = {
      state,
      /** 实际生效的主题（auto 解析后） */
      get effectiveTheme() { return effective(state.theme) },
      /**
       * web 确认框（替代 window.confirm）：返回 Promise<boolean>。
       * 全局单例；同一时刻只允许一个，后发的顶掉前一个（前一个按 false 结算）。
       */
      confirm(title: string, message = '', opts: { okText?: string; cancelText?: string; danger?: boolean } = {}): Promise<boolean> {
        if (confirmResolve) confirmResolve(false)
        state.confirmReq = { title, message, ...opts }
        return new Promise<boolean>((resolve) => { confirmResolve = resolve })
      },
      resolveConfirm(ok: boolean) {
        state.confirmReq = null
        const r = confirmResolve
        confirmResolve = null
        r?.(ok)
      },
      toast(text: string, type = 'info', ms = 3200, options: ToastOptions = {}) {
        if (disposed || (type === 'message' && (ctx as any).lock?.isLocked)) return 0
        if (type === 'message' && state.notificationMode === 'windows') {
          if (options.key) ui.dismissMessages(key => key === options.key)
          const id = ++seq
          const toast = { ...options, id, nativeId: instance + id.toString(36), text, ms }
          nativeToasts.set(id, toast)
          // 通知中心的点击回调保留到用户操作；不能按软件内 Toast 的几秒超时移除。
          while (nativeToasts.size > 100) ui.dismiss(nativeToasts.keys().next().value)
          // 桥接调用偶发不返回时，不能让消息永远卡在等待中；迟到的原生通知随后会被撤销。
          timers.set(id, setTimeout(() => fallback(toast, 'Windows 通知响应超时'), nativeTimeoutMs))
          void native.show(toast.nativeId, options.title || '云湖牢大版', text, () => nativeToasts.has(id), options.avatar).then(() => {
            if (disposed || !nativeToasts.has(id)) void native.dismiss(toast.nativeId)
            else { state.nativeNotificationsAvailable = true; state.notificationError = '' }
          }).catch(e => fallback(toast, e?.message || String(e))).finally(() => {
            clearTimeout(timers.get(id)); timers.delete(id)
          })
          return id
        }
        return showToast(text, type, ms, options)
      },
      dismissMessages(matches: (key: string) => boolean = () => true) {
        for (const toast of [...state.toasts.filter(t => t.type === 'message'), ...nativeToasts.values()]) {
          if (matches(toast.key || '')) ui.dismiss(toast.id)
        }
      },
      setNotificationMode(mode: string) {
        if (mode !== 'windows' && mode !== 'in-app') return
        ui.dismissMessages()
        state.notificationMode = mode
        state.notificationError = ''
        localStorage.setItem('yh.notification.mode', mode)
      },
      testNotification() {
        ui.toast('这是一条测试通知。新消息通知仅接收未开启免打扰的会话。', 'message', 6500, {
          title: '云湖牢大版 · 通知测试', key: 'test:notification',
          onClick: () => { ui.toast('通知点击成功', 'success') },
        })
      },
      dismiss(id: number) {
        const nativeToast = nativeToasts.get(id)
        if (nativeToast) {
          nativeToasts.delete(id)
          void native.dismiss(nativeToast.nativeId)
        }
        clearTimeout(timers.get(id))
        timers.delete(id)
        hiddenMessageDelays.delete(id)
        const i = state.toasts.findIndex((t: any) => t.id === id)
        if (i >= 0) state.toasts.splice(i, 1)
      },
      async activate(id: number) {
        if ((ctx as any).lock?.isLocked) { ui.dismiss(id); return }
        const toast = nativeToasts.get(id) || state.toasts.find((t: any) => t.id === id)
        ui.dismiss(id)
        try { await toast?.onClick?.() }
        catch (e: any) { ui.toast('打开通知失败：' + (e?.message || '未知错误'), 'error') }
      },
      setPanel(p: string) { state.panel = p },
      setTheme(t: string) {
        state.theme = t
        localStorage.setItem('yh.theme', t)
        applyTheme(effective(t))
      },
      /** 循环：dark → light → auto（跟随系统）→ dark */
      toggleTheme() {
        ui.setTheme(state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'auto' : 'dark')
      },
    }

    function fallback(toast: NativeToast, error: string) {
      if (disposed || !nativeToasts.has(toast.id)) return
      ui.dismiss(toast.id)
      state.notificationError = error
      showToast(toast.text, 'message', toast.ms, toast)
    }

    function showToast(text: string, type: string, ms: number, options: ToastOptions) {
      if (type === 'message' && (ctx as any).lock?.isLocked) return 0
      // 同一会话只保留最新通知；限制堆叠，避免突发消息挤满屏幕。
      const existing = options.key && state.toasts.find((t: any) => t.key === options.key)
      const id = existing ? existing.id : ++seq
      const toast = { ...options, id, text, type }
      if (existing) Object.assign(existing, toast)
      else state.toasts.push(toast)
      clearTimeout(timers.get(id))
      timers.delete(id)
      hiddenMessageDelays.delete(id)
      // 软件内消息在隐藏、最小化或锁屏时无法看到，恢复可见后才开始计时。
      if (type === 'message' && (document.hidden || windowMinimized || (ctx as any).lock?.isLocked)) hiddenMessageDelays.set(id, ms)
      else timers.set(id, setTimeout(() => ui.dismiss(id), ms))
      while (state.toasts.length > 5) ui.dismiss(state.toasts[0].id)
      return id
    }
    function resumeHiddenMessages() {
      if (document.hidden || windowMinimized || (ctx as any).lock?.isLocked) return
      for (const [id, ms] of hiddenMessageDelays) {
        hiddenMessageDelays.delete(id)
        if (state.toasts.some((t: any) => t.id === id)) timers.set(id, setTimeout(() => ui.dismiss(id), ms))
      }
    }

    function applyTheme(t: string) { document.documentElement.dataset.theme = t }

    ctx.effect(() => {
      applyTheme(effective(state.theme))
      // 系统色变化时，auto 模式实时跟随
      const onSys = () => { state.systemDark = sysDark(); if (state.theme === 'auto') applyTheme(effective('auto')) }
      mq?.addEventListener?.('change', onSys)
      const onExternalClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || !(window as any).__TAURI__?.core?.invoke) return
        const link = (event.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!link || link.hasAttribute('download') || !/^https?:\/\//i.test(link.href)) return
        // 同源文件下载保留浏览器默认行为。
        if (new URL(link.href).origin === location.origin) return
        event.preventDefault()
        openExternalUrl(link.href).catch((e) => ui.toast('打开链接失败：' + e.message, 'error'))
      }
      document.addEventListener('click', onExternalClick)
      const onMinimized = (event: Event) => { windowMinimized = (event as CustomEvent).detail === true; resumeHiddenMessages() }
      window.addEventListener('yh-window-minimized', onMinimized)
      document.addEventListener('visibilitychange', resumeHiddenMessages)
      return () => {
        disposed = true
        for (const id of [...nativeToasts.keys()]) ui.dismiss(id)
        native.dispose()
        mq?.removeEventListener?.('change', onSys)
        document.removeEventListener('click', onExternalClick)
        window.removeEventListener('yh-window-minimized', onMinimized)
        document.removeEventListener('visibilitychange', resumeHiddenMessages)
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        hiddenMessageDelays.clear()
        state.toasts = []
        ui.resolveConfirm(false)
      }
    })

    ctx.on('ui/toast', ({ text, type, ms, ...options }: any) => ui.toast(text, type, ms, options))
    ctx.on('app/unlock' as any, resumeHiddenMessages)
    ctx.on('auth/logout', () => {
      for (const t of [...state.toasts, ...nativeToasts.values()]) ui.dismiss(t.id)
    })
    ctx.set('ui', ui)
  },
}
