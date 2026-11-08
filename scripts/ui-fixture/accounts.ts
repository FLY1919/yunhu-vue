/** Real auth + storage + login UI with synthetic encrypted-vault responses. */
import { createApp } from 'vue'
import Login from '../../src/components/Login.vue'
import { authPlugin } from '../../src/plugins/auth'
import { storagePlugin } from '../../src/plugins/storage'
import '../../src/styles.css'
import '../../src/styles-m3.css'
const items = ['a', 'b', 'expired'].map(id => ({ id, token: 'fixture-' + id, device: 'device-' + id, user: { id, name: '本地账号 ' + id, email: id + '@example.test' }, savedAt: 1, needsLogin: id === 'expired' }))
const vault = new Map([['accounts', JSON.stringify({ items })]])
let deny = new URLSearchParams(location.search).has('deny')
;(window as any).__TAURI__ = { core: { async invoke(command: string, args: any) {
  if (deny) throw 'secure_read not allowed by ACL'
  if (command === 'secure_read') return vault.get(args.name) ?? null
  if (command === 'secure_write') vault.set(args.name, args.data)
  if (command === 'secure_delete') vault.delete(args.name)
} } }
const ctx: any = {
  api: { token: '', base: '/offline', setToken(t: string) { this.token = t }, async self(token: string) {
    const id = token.replace('fixture-', '')
    if (id === 'expired') throw new Error('token expired')
    return { id, name: '本地账号 ' + id, email: id + '@example.test' }
  } }, ui: { confirm: async () => true }, on() {}, emit() {}, inject() {},
  get(k: string) { return this[k] }, set(k: string, v: any) { this[k] = v },
}
storagePlugin.apply(ctx); authPlugin.apply(ctx)
createApp(Login).provide('ctx', ctx).mount('#app')
;(window as any).__accounts = { ctx, vault, allow() { deny = false } }
