/**
 * 平台检测 —— 决定当前用哪套视觉设计语言。
 *
 *   desktop = Electron 窗口      → WinUI 3 / Fluent 视觉（亚克力、克制圆角、细阴影）
 *   android = Capacitor 原生壳   → Material 3 视觉（大圆角、色调容器、涟漪反馈）
 *   web     = 纯浏览器           → 跟随 desktop 的 Fluent 视觉
 *
 * 检测结果写进 <html data-platform="...">，styles.css 按它分支；
 * 组件里需要判断时直接 import { platform }。
 */
export type Platform = 'desktop' | 'android' | 'web'

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web'
  const w = window as any
  if (w.Capacitor?.isNativePlatform?.()) return 'android'
  const ua = navigator.userAgent || ''
  if (/Electron/i.test(ua) || w.process?.versions?.electron) return 'desktop'
  return 'web'
}

export const platform: Platform = detectPlatform()

export function applyPlatformAttr(p: Platform) {
  document.documentElement.dataset.platform = p
}

/**
 * Material 3 涟漪反馈（仅 android 平台启用）。
 * 捕获阶段监听 pointerdown，在按钮/列表行上溅一枚墨点 —— 纯 DOM，不引组件库。
 */
export function enableRipple() {
  if (platform !== 'android' || typeof document === 'undefined') return
  document.addEventListener('pointerdown', (e) => {
    const t = (e.target as HTMLElement).closest?.('button, .qr-chip, .convs li, .rm-item, .cm-item') as HTMLElement | null
    if (!t || t.hasAttribute('disabled')) return
    const r = t.getBoundingClientRect()
    const d = Math.max(r.width, r.height)
    const s = document.createElement('span')
    s.className = 'ripple-ink'
    s.style.width = s.style.height = d + 'px'
    s.style.left = e.clientX - r.left - d / 2 + 'px'
    s.style.top = e.clientY - r.top - d / 2 + 'px'
    t.classList.add('ripple-host')
    t.appendChild(s)
    setTimeout(() => s.remove(), 520)
  }, true)
}
