/** Local account vault. Passwords are never retained and only public summaries reach the UI. */
import { reactive } from 'vue'
import AccountConfigPage from '../console/pages/AccountConfigPage.vue'

export const authPlugin = {
  name: 'auth',
  inject: ['api', 'storage'],
  provide: ['auth'],
  apply(ctx) {
    const api = ctx.get('api'), storage = ctx.get('storage')
    const state = reactive({ status: 'guest', user: null as any, error: '', savedAccounts: [] as any[], accountsLoading: false })
    let deviceId = '', contextAccount = '', busy = false
    let accounts: any[] = []
    let loaded: Promise<void> | undefined
    let operations = Promise.resolve<any>(undefined)
    let restoration: Promise<any> | undefined
    const newDevice = () => 'web-' + crypto.randomUUID()
    // A permission/ACL failure (403) does not establish that saved credentials expired.
    const invalidCredential = (error: any) => error?.status != null ? error.status === 401
      : /(?:token|credential).{0,20}(?:invalid|expired)|(?:invalid|expired).{0,20}(?:token|credential)|unauthori[sz]ed|未登录|(?:登录|凭证|令牌|token).{0,8}(?:失效|过期|无效)|HTTP\s*401/i.test(error?.message || String(error || ''))
    function loginError(error: any, action: string) {
      const message = error?.message || String(error)
      if (/^系统错误[。！!]?$/u.test(message.trim())) {
        return Object.assign(new Error(`云湖${action}接口返回系统错误，请稍后重试`), { status: error?.status })
      }
      return error
    }
    const publicUser = (u: any) => ({ id: String(u.id), name: u.name || String(u.id), avatar: u.avatar || '', email: u.email || '' })
    function publish() {
      state.savedAccounts = accounts.map(a => ({ ...a.user, id: a.id, savedAt: a.savedAt, needsLogin: !!a.needsLogin }))
        .sort((a, b) => b.savedAt - a.savedAt)
    }
    async function loadAccounts(refresh = false) {
      if (refresh && !state.accountsLoading) loaded = undefined
      if (!loaded) loaded = (async () => {
        state.accountsLoading = true
        try {
          const read = (name: string) => refresh && storage.refresh ? storage.refresh(name) : storage.load(name)
          const data = await read('accounts')
          accounts = Array.isArray(data.items) ? [...new Map<string, any>(data.items.filter(a => a?.id && typeof a.token === 'string' && a.token)
            .map(a => [String(a.id), { id: String(a.id), token: a.token, device: a.device || '', user: publicUser({ ...a.user, id: a.id }), savedAt: Number(a.savedAt) || 0, needsLogin: !!a.needsLogin }])).values()] : []
          const session = await read('session')
          if (session.token && session.user?.id && !accounts.some(a => a.id === String(session.user.id))) {
            accounts.push({ id: String(session.user.id), token: session.token, device: session.device,
              user: publicUser(session.user), savedAt: 0 })
          }
          publish()
          state.error = ''
        } finally { state.accountsLoading = false }
      })().catch((error: any) => { loaded = undefined; throw error })
      return loaded
    }
    async function persistAccounts() {
      publish()
      await storage.save('accounts', { version: 1, items: accounts })
    }
    async function ensureDevice() {
      if (deviceId) return deviceId
      const s = await storage.load('session')
      deviceId = s.device || localStorage.getItem('yh.device') || newDevice()
      return deviceId
    }
    function exclusive(fn: () => Promise<any>) {
      const task = operations.then(async () => {
        busy = true; state.error = ''
        try { return await fn() }
        finally { busy = false }
      })
      operations = task.catch(() => {})
      return task
    }
    async function enter(token: string, device: string, restore = false) {
      token = token.trim()
      if (!token) throw new Error('请填写账号 Token')
      // Validate using a per-request header, leaving live credentials intact on failure.
      const user = await api.self(token).catch(error => { throw loginError(error, '账号验证') })
      if (!user?.id) throw new Error('账号信息不完整，请重新登录')
      await loadAccounts()
      const id = String(user.id)
      const remembered = accounts.find(a => a.id === id)
      const item = { id, token, device: device || remembered?.device || newDevice(), user: publicUser(user), savedAt: Date.now(), needsLogin: false }
      accounts = [...accounts.filter(a => a.id !== id), item]
      await persistAccounts()
      await storage.save('session', { token, device: item.device, user: publicUser(user) })
      localStorage.removeItem('yh.token'); localStorage.removeItem('yh.device')
      if ((contextAccount && contextAccount !== id) || (state.status === 'ready' && (String(state.user?.id) !== id || api.token !== token || deviceId !== item.device))) {
        // Restart the plugin context so WS, group caches, in-flight requests and drafts cannot cross accounts.
        state.status = 'switching'
        ctx.emit('auth/logout')
        api.setToken('')
        window.location.reload()
        return user
      }
      storage.setAccount?.(id, restore)
      api.setToken(token); deviceId = item.device; contextAccount = id
      state.user = user; state.status = 'ready'
      ctx.emit('auth/login', user)
      return user
    }
    const auth = {
      state, loadAccounts,
      get user() { return state.user },
      get isLoggedIn() { return state.status === 'ready' },
      get deviceId() { return deviceId },
      login(email: string, password: string) {
        return exclusive(async () => {
          if (!email.trim() || !password) throw new Error('请填写邮箱和密码')
          const device = state.status === 'ready' ? newDevice() : await ensureDevice()
          const token = await api.login(email.trim(), password, device).catch(error => { throw loginError(error, '邮箱登录') })
          return enter(token, device)
        })
      },
      loginWithToken(token: string) { return exclusive(async () => enter(token, state.status === 'ready' ? newDevice() : await ensureDevice())) },
      verifyToken(token: string) { return api.self(token.trim()) },
      switchAccount(id: string) {
        return exclusive(async () => {
          await loadAccounts()
          if (state.status === 'ready' && String(state.user?.id) === String(id)) return state.user
          const item = accounts.find(a => a.id === String(id))
          if (!item) throw new Error('未找到本地账号，请重新登录')
          try { return await enter(item.token, item.device) }
          catch (error) { if (invalidCredential(error)) { item.needsLogin = true; await persistAccounts() }; throw error }
        })
      },
      async forgetAccount(id: string) {
        if (busy) throw new Error('正在处理账号，请稍候')
        await loadAccounts()
        if (String(state.user?.id) === String(id)) throw new Error('请先退出当前账号')
        accounts = accounts.filter(a => a.id !== String(id)); await persistAccounts()
      },
      async logout() {
        if (busy) return
        busy = true
        try {
          // End the local session; saved accounts are removed explicitly in the account list.
          // Revoking the upstream device here would invalidate the remembered login too.
          await loadAccounts()
          state.status = 'guest'; state.user = null; api.setToken('')
          ctx.emit('auth/logout')
          publish()
          for (const name of ['session', 'cache', 'recall', 'pin', 'lock', 'relay']) await storage.remove(name).catch(() => {})
          storage.setAccount?.('')
          deviceId = ''
          localStorage.removeItem('yh.token'); localStorage.removeItem('yh.device')
        } finally { busy = false }
      },
      restore() {
        if (restoration) return restoration
        restoration = exclusive(async () => {
        await loadAccounts()
        const session = await storage.load('session')
        const token = session.token || localStorage.getItem('yh.token')
        if (!token) return
        try { await enter(token, await ensureDevice(), true) }
        catch (error) {
          const item = accounts.find(a => a.token === token)
          if (item && invalidCredential(error)) { item.needsLogin = true; await persistAccounts() }
          else state.error = error?.message || String(error)
          api.setToken(''); state.status = 'guest'; state.user = null
        }
        })
        return restoration
      },
    }
    ctx.on('auth/login', u => ctx.logger?.info(`已登录：${u.name} (${u.id})`))
    ctx.on('auth/logout', () => ctx.logger?.info('已退出登录'))
    ctx.set('auth', auth)
    ctx.inject(['console'], (ctx) => {
      ctx.console.addEntry(cc => cc.page({ name: '账号与配置', path: '/account', icon: 'settings', order: 950, component: AccountConfigPage }))
    })
  },
}
