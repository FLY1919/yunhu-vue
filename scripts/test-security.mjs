import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const temp = await mkdtemp(join(process.cwd(), 'node_modules', '.security-test-'))
await build({ entryPoints: ['src/plugins/lock.ts'], outfile: join(temp, 'lock.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'vue', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }] })
const { lockPlugin } = await import(pathToFileURL(join(temp, 'lock.mjs')))
after(() => rm(temp, { recursive: true, force: true }))
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
async function fixture(startup = false) {
  globalThis.window = Object.assign(new EventTarget(), { __TAURI__: { core: { invoke: async (command, data) => { calls.push({ command, data }) } } } })
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true, activeElement: null })
  const saved = { pin: { hash: createHash('sha256').update('1234').digest('hex') }, lock: { preferences: { startup, captureProtection: true } } }, calls = [], handlers = {}, dispose = []
  let cleared = 0
  const ctx = { storage: { load: async k => structuredClone(saved[k] || {}), save: async (k, v) => { saved[k] = structuredClone(v) }, remove: async k => { delete saved[k] } }, auth: { state: { status: 'ready', user: { id: 'me' } } }, ui: { dismissMessages: () => cleared++, toast() {} }, console: {}, get(k) { return this[k] }, set(k,v) { this[k]=v }, inject() {}, effect(f) { dispose.push(f()) }, on(k,f) { handlers[k]=f }, emit(k) { handlers[k]?.() } }
  lockPlugin.apply(ctx); await tick()
  return { ctx, saved, calls, cleared: () => cleared, dispose: () => dispose.forEach(f => f?.()) }
}
await test('startup lock restores the PIN, clears messages, and applies native privacy state', async () => {
  const h = await fixture(true); try {
    assert.equal(h.ctx.lock.isLocked, true); assert.equal(h.cleared(), 1)
    assert.deepEqual(h.calls.at(-1), { command: 'set_privacy', data: { locked: true, capture: true } })
    assert.equal(await h.ctx.lock.checkPin('1234'), true); assert.equal(await h.ctx.lock.checkPin('0000'), false)
    await h.ctx.lock.unlock(); assert.equal(h.ctx.lock.isLocked, false)
    assert.deepEqual(h.calls.at(-1).data, { locked: false, capture: true })
  } finally { h.dispose() }
})
await test('manual locking clears messages and settings persist independently of lock state', async () => {
  const h = await fixture(); try {
    assert.equal(h.ctx.lock.isLocked, false)
    await h.ctx.lock.setAutoLock({ startup: true, minimize: true, blurMinutes: 3, captureProtection: false })
    assert.equal(h.saved.lock.preferences.startup, true); assert.equal(h.saved.lock.preferences.blurMinutes, 3)
    h.ctx.lock.lock(); await tick(); assert.equal(h.cleared(), 1)
    assert.equal(h.calls.at(-1).data.locked, true)
    assert.equal(await h.ctx.lock.setPin('12'), false)
    assert.equal(await h.ctx.lock.setPin('5678'), true); assert.equal(await h.ctx.lock.checkPin('5678'), true)
  } finally { h.dispose() }
})
