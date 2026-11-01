import { resUrl } from './res'

/** Render through the existing resource proxy; WinRT cannot load authenticated/proxied URLs itself. */
export function notificationAvatar(src?: string): Promise<string | undefined> {
  if (!src) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const img = new Image()
    const finish = (value?: string) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(value) }
    const timer = setTimeout(() => finish(), 2000)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 96
        const context = canvas.getContext('2d')!
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        context.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 96, 96)
        finish(canvas.toDataURL('image/png'))
      } catch { finish() }
    }
    img.onerror = () => finish()
    img.crossOrigin = 'anonymous'
    img.src = resUrl(src)
  })
}

/** Windows 通知桥接。订阅完成才允许显示；初始化失败可在下一次测试/消息时重试。 */
export function createNativeNotifications(activate: (id: string) => void, fail: (id: string, error: string) => void) {
  const tauri = (window as any).__TAURI__
  const available = !!(tauri?.core?.invoke && tauri?.event?.listen)
  let supported = available
  let disposed = false
  let initialized = false
  let initializationError = ''
  let flight: Promise<boolean> | undefined
  const unlisteners: (() => void)[] = []
  function ensureReady(): Promise<boolean> {
    if (!available || disposed) return Promise.resolve(false)
    if (initialized) return Promise.resolve(true)
    if (flight) return flight
    flight = (async () => {
      try {
        supported = !!await tauri.core.invoke('native_notifications_supported')
        if (!supported || disposed) return false
        await tauri.core.invoke('clear_message_notifications')
        for (const [event, callback] of [
          ['message-notification-activated', (e: any) => activate(e.payload)],
          ['message-notification-failed', (e: any) => fail(e.payload.id, e.payload.error)],
        ] as const) {
          if (disposed) return false
          const unlisten = await tauri.event.listen(event, callback)
          if (disposed) unlisten()
          else unlisteners.push(unlisten)
        }
        initialized = !disposed
        initializationError = ''
        return initialized
      } catch (error: any) {
        initializationError = error?.message || String(error)
        for (const unlisten of unlisteners.splice(0)) unlisten()
        return false
      } finally { flight = undefined }
    })()
    return flight
  }
  const ready = ensureReady()
  return {
    available, ready,
    get supported() { return supported },
    get error() { return initializationError },
    async show(id: string, title: string, body: string, isActive: () => boolean, avatar?: string) {
      if (!await ensureReady() || disposed) throw new Error(initializationError || '当前环境不支持 Windows 系统通知')
      const image = await notificationAvatar(avatar)
      if (!isActive()) return
      await tauri.core.invoke('show_message_notification', { id, title, body, avatar: image || null })
    },
    async dismiss(id: string) {
      if (available) await tauri.core.invoke('dismiss_message_notification', { id }).catch(() => {})
    },
    dispose() {
      disposed = true
      for (const unlisten of unlisteners.splice(0)) unlisten()
    },
  }
}
