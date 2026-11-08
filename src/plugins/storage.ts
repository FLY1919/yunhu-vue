/**
 * storage 插件
 * 提供 ctx.storage：用户数据持久化（登录态/会话缓存/PIN/锁/扫码中继）
 *   · Web：走本地 server 的 /data/<name>（server.ts 落盘到「文档/yhchat」）
 *   · 桌面/安卓：端点不可用时自动回退 localStorage，登录不被阻塞
 * 内存镜像：同一会话内重复读同一 key 不再发请求。
 */
export const storagePlugin = {
  name: 'storage',
  provide: ['storage'],

  apply(ctx) {
    const mem = new Map<string, any>()
    const scoped = new Set(['cache', 'recall', 'userbots'])
    const privateNames = new Set(['accounts', 'session', 'userbots'])
    const legacyPrivateNames = new Set(['accounts', 'session'])
    const secure = () => (globalThis as any).window?.__TAURI__?.core?.invoke as undefined | ((command: string, args: any) => Promise<any>)
    const writes = new Map<string, Promise<any>>()
    const rawWrites = new Map<string, Promise<any>>()
    const loads = new Map<string, Promise<any>>()
    const revisions = new Map<string, number>()
    let accountId = ''
    let adoptLegacy = false
    let ok: boolean | null = null   // 仅缓存「可用」，失败下次仍重试（dev 时 server 可能后起）

    // A stalled sidecar must release the write queue and let the interface recover.
    async function localRequest(url: string, options: RequestInit = {}): Promise<Response> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try { return await fetch(url, { ...options, signal: controller.signal }) }
      finally { clearTimeout(timer) }
    }

    async function probe(): Promise<boolean> {
      if (ok === true) return true
      try {
        const r = await localRequest('/data/session', { method: 'GET' })
        ok = r.ok
      } catch { ok = false }        // 本次不可用，下次调用再探
      return ok === true
    }

    /** 读一份数据；不存在/不可用返回 {} */
    async function readRaw(name: string): Promise<any> {
      if (mem.has(name)) return mem.get(name)
      const invoke = secure()
      if (invoke && privateNames.has(name)) {
        const version = revisions.get(name) || 0
        const encrypted = await invoke('secure_read', { name })
        if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
        if (encrypted !== null && encrypted !== undefined) {
          if (legacyPrivateNames.has(name)) await eraseLegacy(name)
          if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
          const value = JSON.parse(encrypted); mem.set(name, value); return value
        }
        if (!legacyPrivateNames.has(name)) { const value = {}; mem.set(name, value); return value }
        // Upgrade older installations only after DPAPI successfully writes the whole value.
        const legacy = await readLegacy(name)
        if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
        if (Object.keys(legacy).length) {
          const migration = (rawWrites.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
            if (version !== (revisions.get(name) || 0)) return
            await invoke('secure_write', { name, data: JSON.stringify(legacy) })
            await eraseLegacy(name)
          })
          rawWrites.set(name, migration)
          await migration
        }
        if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
        mem.set(name, legacy); return legacy
      }
      return readLegacy(name)
    }
    async function readLegacy(name: string): Promise<any> {
      const version = revisions.get(name) || 0
      if (await probe()) {
        try {
          const r = await localRequest('/data/' + name)
          if (r.ok) {
            const j = await r.json()
            if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
            if (j && Object.keys(j).length) { mem.set(name, j); return j }
          }
        } catch { /* 落到回退 */ }
      }
      if (version !== (revisions.get(name) || 0)) return mem.get(name) || {}
      // 回退：localStorage（旧版本数据 / 无本地 server 的端）
      try {
        const raw = localStorage.getItem('yh.data.' + name)
        if (raw) {
          const j = JSON.parse(raw)
          mem.set(name, j)
          return j
        }
      } catch { /* 忽略坏数据 */ }
      const empty = {}
      mem.set(name, empty)
      return empty
    }
    function loadRaw(name: string): Promise<any> {
      if (mem.has(name)) return Promise.resolve(mem.get(name))
      if (loads.has(name)) return loads.get(name)!
      const job = readRaw(name).finally(() => { loads.delete(name) })
      loads.set(name, job)
      return job
    }

    /** 写一份数据；返回是否落到了文件（false=只落在 localStorage 回退） */
    function saveRaw(name: string, value: any): Promise<boolean> {
      revisions.set(name, (revisions.get(name) || 0) + 1)
      const version = revisions.get(name)
      mem.set(name, value)
      const raw = JSON.stringify(value)
      const job = (rawWrites.get(name) || Promise.resolve()).catch(() => {}).then(() => writeRaw(name, raw)).catch((error) => {
        if (secure() && privateNames.has(name) && revisions.get(name) === version) mem.delete(name)
        throw error
      })
      rawWrites.set(name, job)
      return job
    }
    async function writeRaw(name: string, raw: string): Promise<boolean> {
      const invoke = secure()
      if (invoke && privateNames.has(name)) {
        await invoke('secure_write', { name, data: raw })
        if (legacyPrivateNames.has(name)) await eraseLegacy(name)
        return true
      }
      if (await probe()) {
        try {
          const r = await localRequest('/data/' + name, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: raw,
          })
          if (r.ok) { localStorage.removeItem('yh.data.' + name); return true }
        } catch { /* 落到回退 */ }
      }
      try { localStorage.setItem('yh.data.' + name, raw) } catch { /* 配额满等，忽略 */ }
      return false
    }
    async function eraseLegacy(name: string): Promise<void> {
      if (!await probe()) throw new Error('本地服务不可用，无法确认旧凭据已清理')
      const response = await localRequest('/data/' + name, { method: 'DELETE' })
      if (!response.ok) throw new Error('无法清理旧的本地凭据')
      localStorage.removeItem('yh.data.' + name)
    }

    /** 删一份数据（幂等） */
    async function removeRaw(name: string): Promise<void> {
      revisions.set(name, (revisions.get(name) || 0) + 1)
      mem.set(name, {})
      await rawWrites.get(name)?.catch(() => {})
      const invoke = secure()
      if (invoke && privateNames.has(name)) await invoke('secure_delete', { name })
      if (await probe()) {
        try { await localRequest('/data/' + name, { method: 'DELETE' }) } catch { /* 忽略 */ }
      }
      try { localStorage.removeItem('yh.data.' + name) } catch { /* 忽略 */ }
    }

    // Capture the owner before awaiting: old requests cannot write into a newly selected account.
    async function load(name: string): Promise<any> {
      const owner = accountId, migrate = adoptLegacy
      const raw = await loadRaw(name)
      if (!scoped.has(name)) return raw
      if (!owner) return {}
      if (raw.__yh_accounts) return raw.__yh_accounts[owner] || {}
      if (!migrate) return {}
      // Claim a legacy single-account cache before another account is ever restored.
      if (Object.keys(raw).length) await saveRaw(name, { __yh_accounts: { [owner]: raw } })
      return raw
    }
    function save(name: string, value: any): Promise<boolean> {
      if (!scoped.has(name)) return saveRaw(name, value)
      const owner = accountId, migrate = adoptLegacy
      if (!owner) return Promise.resolve(false)
      const write = (writes.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
        const raw = await loadRaw(name)
        const accounts = raw.__yh_accounts || (migrate ? { [owner]: raw } : {})
        return saveRaw(name, { __yh_accounts: { ...accounts, [owner]: value } })
      })
      writes.set(name, write)
      return write
    }
    async function remove(name: string): Promise<void> {
      if (scoped.has(name)) { await save(name, {}); return }
      await removeRaw(name)
    }
    ctx.set('storage', { load, save, remove, probe,
      async refresh(name: string) {
        await rawWrites.get(name)?.catch(() => {})
        await loads.get(name)?.catch(() => {})
        mem.delete(name)
        return load(name)
      },
      setAccount(id: string, migrate = false) { accountId = String(id || ''); adoptLegacy = migrate },
    })
  },
}
