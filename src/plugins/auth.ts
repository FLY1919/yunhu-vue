/**
 * auth 插件
 * 提供 ctx.auth：登录态管理（邮箱登录 / token 登录 / 持久化 / 自动恢复）
 * 依赖：api
 */
import { reactive, watch } from 'vue'
import AccountPage from '../console/pages/AccountPage.vue'

export const authPlugin = {
  name: 'auth',
  inject: ['api'],
  provide: ['auth'],

  apply(ctx) {
    const api = ctx.get('api')

    const state = reactive({
      status: 'guest', // guest | loading | ready
      user: null,
      error: '',
    })

    const deviceId = (() => {
      let d = localStorage.getItem('yh.device')
      if (!d) { d = 'web-' + Math.random().toString(36).slice(2); localStorage.setItem('yh.device', d) }
      return d
    })()

    async function enter(token) {
      api.setToken(token)
      state.status = 'loading'
      state.error = ''
      try {
        const user = await api.self()
        state.user = user
        state.status = 'ready'
        localStorage.setItem('yh.token', token)
        ctx.emit('auth/login', user)
        return user
      } catch (e) {
        api.setToken('')
        localStorage.removeItem('yh.token')
        state.status = 'guest'
        state.user = null
        throw e
      }
    }

    const auth = {
      state,
      get user() { return state.user },
      get isLoggedIn() { return state.status === 'ready' },

      async login(email, password) {
        state.error = ''
        const token = await api.login(email, password, deviceId, 'web')
        return enter(token)
      },

      async loginWithToken(token) {
        return enter(token.trim())
      },

      logout() {
        api.setToken('')
        localStorage.removeItem('yh.token')
        state.user = null
        state.status = 'guest'
        ctx.emit('auth/logout')
      },

      /** 页面加载时尝试恢复上次的登录态 */
      async restore() {
        const t = localStorage.getItem('yh.token')
        if (!t) return
        try { await enter(t) } catch { /* 忽略，回到登录页 */ }
      },
    }

    // 登录/登出时自动打日志（演示事件总线）
    ctx.on('auth/login', u => ctx.logger?.info(`已登录：${u.name} (${u.id})`))
    ctx.on('auth/logout', () => ctx.logger?.info('已退出登录'))

    // 避免未使用告警
    void watch

    ctx.set('auth', auth)

    /* ---- 控制台扩展：账号页面 ---- */
    ctx.inject(['console'], (ctx) => {
      ctx.console.addEntry((cc) => {
        cc.page({ name: '账号', path: '/account', icon: 'userCircle', order: 950, component: AccountPage })
      })
    })
  },
}
