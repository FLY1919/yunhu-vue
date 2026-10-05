import { createApp } from 'vue'
import App from './App.vue'
import { ctx, bootstrap } from './app'
import './styles.css'

const app = createApp(App)
app.provide('ctx', ctx)
app.config.errorHandler = (err: any) => ctx.logger?.error('vue error:', err?.message || String(err))

;(async () => {
  try {
    await bootstrap()
  } catch (e: any) {
    console.error('[bootstrap]', e)
  }
  app.mount('#app')
  // 启动时尝试恢复上次登录
  ;(ctx as any).auth?.restore?.()
  // 调试句柄：控制台里可直接查看插件/服务/页面状态
  ;(window as any).__yunhu = ctx
})()
