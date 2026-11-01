import { createApp } from 'vue'
import { platform, applyPlatformAttr, enableRipple } from './platform'
import './styles.css'
import './styles-m3.css'   // M3 质感层（Kazumi 式观感），必须后加载覆盖基础变量

applyPlatformAttr(platform)
enableRipple()

/**
 * 外链全局委托：Tauri（WebView2）里 target=_blank 的新窗口导航被默认拦截，
 * 表现为「点网址没反应」。捕获阶段拦截所有 http(s) 外链点击，交 opener 插件用系统浏览器打开。
 * web 版（无 __TAURI__）保持原生行为不动。
 */
document.addEventListener('click', (e) => {
  const w = window as any
  if (!w.__TAURI__?.opener?.openUrl) return
  const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (!/^https?:\/\//i.test(href)) return
  e.preventDefault()
  e.stopPropagation()
  w.__TAURI__.opener.openUrl(href).catch(() => { window.open(href, '_blank') })
}, true)

;(async () => {
  const sessionId = new URLSearchParams(location.search).get('ai-panel')
  if (sessionId) {
    // A detached view never bootstraps auth, WebSocket, user Bots or the account vault.
    const { default: FloatingAiPanel } = await import('./components/FloatingAiPanel.vue')
    createApp(FloatingAiPanel, { sessionId }).mount('#app')
    return
  }
  const [{ default: App }, { ctx, bootstrap }, { installAiPanelHost }] = await Promise.all([import('./App.vue'), import('./app'), import('./core/ai-panel')])
  const app = createApp(App)
  app.provide('ctx', ctx)
  app.config.errorHandler = (err: any) => ctx.logger?.error('vue error:', err?.message || String(err))
  try {
    await bootstrap()
    installAiPanelHost(ctx)
  } catch (e: any) {
    console.error('[bootstrap]', e)
    showCrash(e)
  }
  app.mount('#app')
  // 启动时尝试恢复上次登录
  ;(ctx as any).auth?.restore?.()?.catch?.(() => {})
  // 调试句柄：控制台里可直接查看插件/服务/页面状态
  ;(window as any).__yunhu = ctx
})()

/**
 * 崩溃可视化（借鉴 Yhchat_md3 的 CrashHandler 思路）：
 * 启动期/运行期抛错且界面没渲染出来时，显示红色错误页而不是黑屏，
 * 安卓 WebView 里 console 看不到，没有这层用户只会看到「黑屏」。
 */
function showCrash(e: any) {
  const root = document.getElementById('app')
  if (!root || root.childElementCount > 0) return
  root.innerHTML =
    '<div style="padding:28px;color:#ffd7d7;font:13px/1.7 monospace;white-space:pre-wrap">' +
    '<b style="font-size:15px">启动失败</b>\n\n' +
    String(e?.message || e).replace(/[<>&]/g, '') +
    '\n\n请截图发给开发者，或点「重载」重试。</div>' +
    '<button onclick="location.reload()" style="margin:0 28px;padding:8px 22px;border-radius:8px;border:0;background:#f2635f;color:#fff;font-size:14px">重载</button>'
}
window.addEventListener('error', (ev) => showCrash(ev.error || ev.message))
window.addEventListener('unhandledrejection', (ev) => showCrash(ev.reason))
