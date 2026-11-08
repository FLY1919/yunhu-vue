/**
 * lock 插件 —— 锁屏 + 手机端弹窗解锁（QQ 式，无摄像头方案）
 *
 * 桌面端「锁定」后显示全屏锁屏页，两种解锁方式：
 *   1) 本地 PIN（首次锁定时设置，SHA-256 哈希存 文档/yhchat/pin.json）
 *   2) 向云端 KV 中继写解锁请求 → 同账号的手机端 App 在前台时秒级弹窗
 *      （解锁/拒绝）→ 回写结果 → 桌面端轮询取回自动解锁。
 *      手机端在后台时收不到推送（云湖公开接口无 push 通道），锁屏页会提示打开手机端。
 *
 * 中继数据（storage 'relay'）：
 *   lockreq: { nonce, device, platform, ts, by }   桌面写请求
 *   lockres: { nonce, approved, ts }               手机写应答
 * 请求 5 分钟过期；退出账号时 pin/lock/relay 一并清除（见 auth.logout）。
 */
import { reactive } from 'vue'
import LockScreen from '../console/components/LockScreen.vue'
import { createAutoLock, type AutoLockPreferences } from '../core/auto-lock'

const REQ_TTL = 5 * 60 * 1000

async function sha256(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // 非安全上下文兜底：djb2（仅防明文存 PIN，不抗暴力破解）
    let h = 5381
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
    return 'djb2:' + (h >>> 0).toString(16)
  }
}

export const lockPlugin = {
  name: 'lock',
  inject: ['storage', 'auth', 'ui', 'console'],
  provide: ['lock'],

  apply(ctx) {
    const storage = ctx.get('storage')
    const auth = ctx.get('auth')

    const state = reactive({
      locked: false,
      hasPin: false,
      preferences: { minimize: false, blurMinutes: 0, startup: false, captureProtection: false } as AutoLockPreferences,
      /** 桌面端发出的解锁请求 nonce（等手机应答用） */
      reqNonce: null as string | null,
      reqStatus: '' as '' | 'waiting' | 'denied' | 'expired',
      /** 手机端待确认的解锁请求 */
      pending: null as any,
    })

    let pinHash = ''
    let relayCache: any = null
    const autoLock = createAutoLock(() => state.preferences, () => { if (state.hasPin && auth.state.status === 'ready') lock() })
    function persistLock() { return storage.save('lock', { locked: state.locked, preferences: { ...state.preferences }, ts: Date.now() }) }
    async function setAutoLock(patch: Partial<AutoLockPreferences>) {
      if (!state.hasPin && (patch.minimize || patch.blurMinutes || patch.startup)) throw new Error('请先设置锁定 PIN')
      const previous = { ...state.preferences }
      state.preferences = { ...state.preferences, ...patch }
      state.preferences.blurMinutes = Math.max(0, Math.min(1440, Number(state.preferences.blurMinutes) || 0))
      try { autoLock.configure(); await syncPrivacy(); await persistLock() }
      catch (e) { state.preferences = previous; autoLock.configure(); await syncPrivacy().catch(() => {}); throw e }
    }

    async function syncPrivacy() {
      window.dispatchEvent(new CustomEvent('yh-media-locked', { detail: state.locked }))
      const invoke = (window as any).__TAURI__?.core?.invoke
      if (invoke) await invoke('set_privacy', { locked: state.locked, capture: !!state.preferences.captureProtection })
      else if (state.preferences.captureProtection) throw new Error('反截屏需要 Windows 桌面版')
    }

    async function relay(): Promise<any> {
      relayCache = await storage.load('relay').catch(() => ({})) || {}
      return relayCache
    }
    async function putRelay(patch: any) {
      const r = await relay()
      relayCache = { ...r, ...patch }
      await storage.save('relay', relayCache).catch(() => {})
    }

    /** 启动时恢复锁状态（锁着重启仍是锁着） */
    async function restore() {
      const [l, p] = await Promise.all([
        storage.load('lock').catch(() => ({})),
        storage.load('pin').catch(() => ({})),
      ])
      state.hasPin = !!p.hash
      pinHash = p.hash || ''
      state.preferences = { minimize: !!l.preferences?.minimize, blurMinutes: Math.max(0, Math.min(1440, Number(l.preferences?.blurMinutes) || 0)), startup: !!l.preferences?.startup, captureProtection: !!l.preferences?.captureProtection }
      state.locked = state.hasPin && (!!l.locked || !!state.preferences.startup)
      if (state.locked) ctx.ui?.dismissMessages?.()
      await syncPrivacy().catch(() => ctx.ui?.toast?.('安全设置应用失败，请重试', 'error'))
      if (document.hidden || !document.hasFocus()) autoLock.blur()
    }

    function lock() {
      if (state.locked) return
      state.locked = true
      ctx.ui?.dismissMessages?.()
      void syncPrivacy().catch(() => {})
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {})
      state.reqNonce = null
      state.reqStatus = ''
      autoLock.stop(); persistLock().catch(() => {})
    }

    async function unlock() {
      state.locked = false
      state.reqNonce = null
      state.reqStatus = ''
      state.pending = null
      await syncPrivacy().catch(() => {})
      ctx.emit('app/unlock')
      await persistLock().catch(() => {})
      // 清掉中继里的旧请求/应答，避免下次误触
      await putRelay({ lockreq: null, lockres: null })
    }

    /** PIN 校验 */
    async function checkPin(pin: string): Promise<boolean> {
      if (!pinHash) return false
      return (await sha256(pin)) === pinHash
    }

    /** 首次锁定前设置 PIN（4-6 位数字） */
    async function setPin(pin: string): Promise<boolean> {
      if (!/^\d{4,6}$/.test(pin)) return false
      const hash = await sha256(pin)
      await storage.save('pin', { hash })
      pinHash = hash; state.hasPin = true
      return true
    }

    /** 忘记密码流程：身份验证通过后清除旧 PIN（调用方随后走 setPin 重设） */
    async function clearPin(): Promise<void> {
      pinHash = ''
      state.hasPin = false
      await storage.remove('pin').catch(() => {})
    }

    /** 桌面端：发起手机端解锁请求 */
    async function requestRemoteUnlock(): Promise<void> {
      const nonce = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
      state.reqNonce = nonce
      state.reqStatus = 'waiting'
      await putRelay({
        lockreq: {
          nonce,
          device: auth.deviceId || 'desktop',
          platform: navigator.platform || 'desktop',
          ts: Date.now(),
          by: auth.state.user?.name || '',
        },
        lockres: null,
      })
    }

    /* ---- 桌面端：锁定时轮询手机应答 ---- */
    let deskTimer: any = null
    function watchDesk() {
      clearInterval(deskTimer)
      deskTimer = setInterval(async () => {
        if (!state.locked || !state.reqNonce) return
        const r = await relay().catch(() => ({}))
        const res = r.lockres
        if (!res || res.nonce !== state.reqNonce) {
          const req = r.lockreq
          if (req && req.nonce === state.reqNonce && Date.now() - req.ts > REQ_TTL) state.reqStatus = 'expired'
          return
        }
        if (res.approved) await unlock()
        else { state.reqStatus = 'denied'; state.reqNonce = null }
      }, 2000)
    }

    ctx.effect(() => {
      restore()
      watchDesk()
      const focus = () => { if (!document.hidden) autoLock.focus() }
      const blur = () => autoLock.blur()
      const visibility = () => {
        if (document.hidden) {
          autoLock.blur()
          if (!(window as any).__TAURI__ && !/Electron/i.test(navigator.userAgent)) autoLock.minimize(true)
        } else if (document.hasFocus()) autoLock.focus()
      }
      const focused = (event: Event) => { if ((event as CustomEvent).detail === true) focus(); else blur() }
      window.addEventListener('yh-window-focused', focused)
      const minimized = (event: Event) => autoLock.minimize(!!(event as CustomEvent).detail)
      window.addEventListener('focus', focus); window.addEventListener('blur', blur)
      window.addEventListener('yh-window-minimized', minimized); document.addEventListener('visibilitychange', visibility)
      return () => {
        clearInterval(deskTimer); autoLock.stop()
        window.removeEventListener('yh-window-focused', focused)
        window.removeEventListener('focus', focus); window.removeEventListener('blur', blur)
        window.removeEventListener('yh-window-minimized', minimized); document.removeEventListener('visibilitychange', visibility)
      }
    })

    ctx.on('app/lock', () => lock())
    ctx.on('auth/logout', () => { autoLock.stop(); state.locked = false; state.hasPin = false; pinHash = ''; state.preferences = { minimize: false, blurMinutes: 0, startup: false, captureProtection: false }; void syncPrivacy().catch(() => {}) })
    ctx.on('auth/login', () => restore())

    const lockApi = {
      captureSupported: !!(window as any).__TAURI__ && /Windows/i.test(navigator.userAgent),
      state, lock, unlock, checkPin, setPin, clearPin, requestRemoteUnlock, setAutoLock,
      get isLocked() { return state.locked },
    }
    ctx.set('lock', lockApi)

    /* 全局浮层：锁屏页 + 手机端解锁确认弹窗（console 全局插槽，盖住整个外壳） */
    ctx.inject(['console'], (c) => {
      c.console.addEntry((cc) => {
        cc.slot({ type: 'global', component: LockScreen, order: 900 })
      })
    })
  },
}
