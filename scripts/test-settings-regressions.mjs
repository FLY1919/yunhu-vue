/** Offline checks for account isolation, migration, per-request credentials and actual image pixels. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const temp = await mkdtemp(join(process.cwd(), 'node_modules', '.settings-regression-'))
await build({ stdin: { contents: `export { authPlugin } from './src/plugins/auth'; export { storagePlugin } from './src/plugins/storage';
  export { apiPlugin } from './src/plugins/api'; export * as pb from './src/core/pb';
  export { ImageEditSession, editedImageName } from './src/core/image-edit'; export { searchSettings } from './src/core/settings-catalog';`, resolveDir: process.cwd() },
  outfile: join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'components', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }],
})
const { authPlugin, storagePlugin, apiPlugin, pb, ImageEditSession, editedImageName, searchSettings } = await import(pathToFileURL(join(temp, 'test.mjs')))
class LocalStorage {
  data = new Map()
  getItem(k) { return this.data.get(k) ?? null }
  setItem(k, v) { this.data.set(k, String(v)) }
  removeItem(k) { this.data.delete(k) }
}
const copy = value => JSON.parse(JSON.stringify(value))
const user = id => ({ id, name: 'Offline ' + id, avatar: '', email: id + '@example.test' })
const account = id => ({ id, token: 'offline-token-' + id, device: 'offline-device-' + id, user: user(id), savedAt: 1 })
function authHarness(seed = {}) {
  globalThis.localStorage = new LocalStorage()
  let reloads = 0
  globalThis.window = { location: { reload() { reloads++ } } }
  const data = new Map(Object.entries(copy(seed))), events = [], removed = []
  const api = { token: '', setToken(t) { this.token = t }, async self(t) {
    if (!t.startsWith('offline-token-')) throw new Error('expired credential')
    return user(t.slice('offline-token-'.length))
  }, async login(email, password) { if (password !== 'test-password') throw new Error('invalid password'); return 'offline-token-' + email.split('@')[0] }, async logoutDevice() {} }
  const storage = { async load(name) { return copy(data.get(name) || {}) }, async save(name, value) { data.set(name, copy(value)); return true },
    async remove(name) { removed.push(name); data.delete(name) }, setAccount(id) { this.accountId = id } }
  const ctx = { api, storage, get(k) { return this[k] }, set(k, v) { this[k] = v }, on() {}, emit(...args) { events.push(args) }, inject() {}, logger: { info() {} } }
  authPlugin.apply(ctx)
  return { ...ctx, auth: ctx.auth, data, events, removed, reloads: () => reloads }
}
try {
  await test('legacy saved session is recognized, migrated and exposed without credentials', async () => {
    const a = account('a'), h = authHarness({ session: { token: a.token, device: a.device, user: a.user } })
    await h.auth.restore()
    assert.equal(h.auth.user.id, 'a'); assert.equal(h.api.token, a.token)
    assert.equal(h.storage.accountId, 'a')
    assert.deepEqual(h.auth.state.savedAccounts.map(a => a.id), ['a'])
    assert.ok(!JSON.stringify(h.auth.state.savedAccounts).includes('offline-token'))
    assert.ok(!JSON.stringify(h.data.get('accounts')).includes('test-password'))
    assert.equal(h.data.get('session').user.id, 'a')
  })
  await test('failed account switch and token verification retain the active token, user and session', async () => {
    const a = account('a'), b = { ...account('b'), token: 'expired' }
    const h = authHarness({ session: { ...a }, accounts: { items: [a, b] } })
    await h.auth.restore()
    await assert.rejects(h.auth.switchAccount('b'), /expired/)
    await assert.rejects(h.auth.verifyToken('expired'), /expired/)
    assert.equal(h.api.token, a.token); assert.equal(h.auth.user.id, 'a'); assert.equal(h.auth.state.status, 'ready')
    assert.equal(h.data.get('session').user.id, 'a'); assert.equal(h.reloads(), 0)
    assert.equal(h.auth.state.savedAccounts.find(a => a.id === 'b').needsLogin, true)
  })
  await test('successful switching persists both accounts, stops old context and restarts exactly once', async () => {
    const a = account('a'), b = account('b')
    const h = authHarness({ session: { ...a }, accounts: { items: [a, b] } })
    await h.auth.restore(); await h.auth.switchAccount('b')
    assert.deepEqual(h.data.get('accounts').items.map(a => a.id).sort(), ['a', 'b'])
    assert.equal(h.data.get('session').user.id, 'b'); assert.equal(h.data.get('session').device, b.device)
    assert.equal(h.auth.state.status, 'switching'); assert.equal(h.api.token, '')
    assert.equal(h.events.filter(e => e[0] === 'auth/logout').length, 1); assert.equal(h.reloads(), 1)
  })
  await test('temporary network failure leaves saved credentials retryable', async () => {
    const a = account('a'), b = account('b'), h = authHarness({ session: { ...a }, accounts: { items: [a, b] } })
    await h.auth.restore()
    h.api.self = async () => { throw new Error('Failed to fetch') }
    await assert.rejects(h.auth.switchAccount('b'), /Failed to fetch/)
    assert.equal(h.auth.state.savedAccounts.find(a => a.id === 'b').needsLogin, false)
    assert.equal(h.auth.user.id, 'a'); assert.equal(h.api.token, a.token)
  })
  await test('403 and native ACL errors leave saved accounts retryable; explicit credential expiry requires login', async () => {
    for (const error of [Object.assign(new Error('permission denied'), { status: 403 }), new Error('secure_read not allowed by ACL'), new Error('token lookup network timeout')]) {
      const a = account('a'), b = account('b'), h = authHarness({ session: { ...a }, accounts: { items: [a, b] } })
      await h.auth.restore(); h.api.self = async () => { throw error }
      await assert.rejects(h.auth.switchAccount('b'))
      assert.equal(h.auth.state.savedAccounts.find(a => a.id === 'b').needsLogin, false)
      assert.equal(h.auth.user.id, 'a')
    }
  })
  await test('refresh reloads the persistent account list without changing the active session', async () => {
    const a = account('a'), b = account('b'), h = authHarness({ session: { ...a }, accounts: { items: [a] } })
    await h.auth.restore(); h.data.set('accounts', { items: [a, b] })
    await h.auth.loadAccounts(true)
    assert.deepEqual(h.auth.state.savedAccounts.map(a => a.id).sort(), ['a', 'b'])
    assert.equal(h.auth.user.id, 'a'); assert.equal(h.api.token, a.token)
  })
  await test('adding an account deduplicates; logout keeps saved accounts and explicit removal deletes only the selected account', async () => {
    const a = account('a'), b = account('b')
    const h = authHarness({ session: { ...a }, accounts: { items: [a, b] } })
    await h.auth.restore(); await h.auth.loginWithToken(a.token)
    assert.equal(h.auth.state.savedAccounts.filter(a => a.id === 'a').length, 1)
    // Restore creates a fresh context just like the page reload after reauthentication.
    const loggedIn = authHarness(Object.fromEntries(h.data)); await loggedIn.auth.restore(); await loggedIn.auth.logout()
    assert.equal(loggedIn.auth.state.status, 'guest')
    assert.deepEqual(loggedIn.auth.state.savedAccounts.map(a => a.id).sort(), ['a', 'b'])
    await loggedIn.auth.forgetAccount('a')
    assert.deepEqual(loggedIn.data.get('accounts').items.map(a => a.id), ['b'])
    assert.ok(!loggedIn.data.has('session'))
  })
  await test('API validation sends an isolated auth header without changing active credentials', async () => {
    const previous = globalThis.fetch, calls = [], ctx = { set(k, v) { this[k] = v } }
    apiPlugin.apply(ctx, { base: '/api' }); ctx.api.setToken('active')
    globalThis.fetch = async (_url, init) => {
      calls.push(init.headers.token)
      return new Response(pb.build(pb.fBytes(1, pb.fNum(2, 1)), pb.fBytes(2, pb.build(pb.fStr(1, 'b'), pb.fStr(2, 'B')))))
    }
    try { assert.equal((await ctx.api.self('candidate')).id, 'b'); await ctx.api.self(); assert.deepEqual(calls, ['candidate', 'active']); assert.equal(ctx.api.token, 'active') }
    finally { globalThis.fetch = previous }
  })
  await test('adding an email account never attaches the active account token to its login request', async () => {
    const previous = globalThis.fetch, ctx = { set(k, v) { this[k] = v } }
    apiPlugin.apply(ctx, { base: '/api' }); ctx.api.setToken('active')
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers.token, undefined)
      assert.equal(JSON.parse(init.body).email, 'offline@example.test')
      return new Response(JSON.stringify({ code: 1, data: { token: 'new-account' } }))
    }
    try { assert.equal(await ctx.api.login('offline@example.test', 'fake-password', 'fake-device'), 'new-account'); assert.equal(ctx.api.token, 'active') }
    finally { globalThis.fetch = previous }
  })
  await test('scoped caches and late queued writes stay with their captured account; legacy data migrates once', async () => {
    const previous = globalThis.fetch
    const backend = new Map([['cache', { convs: [{ id: 'legacy-a' }] }]])
    globalThis.localStorage = new LocalStorage()
    globalThis.fetch = async (url, init = {}) => {
      const name = String(url).split('/').pop()
      if (init.method === 'PUT') { backend.set(name, JSON.parse(init.body)); return new Response('{}') }
      if (init.method === 'DELETE') { backend.delete(name); return new Response('{}') }
      return new Response(JSON.stringify(backend.get(name) || {}))
    }
    try {
      const ctx = { set(k, v) { this[k] = v } }; storagePlugin.apply(ctx)
      const s = ctx.storage
      s.setAccount('a', true); assert.equal((await s.load('cache')).convs[0].id, 'legacy-a')
      s.setAccount('b', true); assert.deepEqual(await s.load('cache'), {})
      s.setAccount('a'); const lateA = s.save('cache', { convs: [{ id: 'new-a' }] })
      s.setAccount('b'); await s.save('cache', { convs: [{ id: 'new-b' }] }); await lateA
      assert.equal((await s.load('cache')).convs[0].id, 'new-b')
      s.setAccount('a'); assert.equal((await s.load('cache')).convs[0].id, 'new-a')
      await s.remove('cache'); s.setAccount('b'); assert.equal((await s.load('cache')).convs[0].id, 'new-b')
    } finally { globalThis.fetch = previous }
  })
  await test('settings search handles NFKC, case, multiple words and exact destinations', () => {
    assert.equal(searchSettings('Ｔｏａｓｔ')[0].category, 'notifications')
    assert.equal(searchSettings('账号 切换')[0].anchor, 'saved-accounts')
    assert.ok(searchSettings('表情 数量').some(r => r.anchor === 'config-stickers'))
    assert.deepEqual(searchSettings('a feature that does not exist'), [])
  })
  await test('image geometry and pixels survive crop, rotation, invert, undo/redo and branch edits', () => {
    const source = { width: 2, height: 2, data: new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]) }
    const original = [...source.data], s = new ImageEditSession(source)
    s.apply({ crop: { x: 1, y: 0, width: 1, height: 2 } })
    assert.deepEqual([...s.pixels().data], [0,255,0,255, 255,255,255,255])
    s.apply({ filter: 'invert' }); assert.deepEqual([...s.pixels().data], [255,0,255,255, 0,0,0,255])
    s.undo(); assert.deepEqual([...s.pixels().data], [0,255,0,255, 255,255,255,255]); s.redo()
    s.undo(); s.apply({ rotate: 90, crop: null }); assert.equal(s.canRedo, false)
    assert.equal(s.pixels().width, 2); assert.equal(s.pixels().height, 2)
    s.reset(); assert.deepEqual([...s.pixels().data], original); assert.deepEqual([...source.data], original)
  })
  await test('image export bounds pathological sizes and preserves a safe copy filename', () => {
    const s = new ImageEditSession({ width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) })
    s.apply({ crop: { x: 99, y: -4, width: -1, height: 99 }, resize: { width: 99999, height: 99999 } })
    assert.deepEqual(s.design.crop, { x: 7, y: 0, width: 1, height: 6 })
    assert.ok(s.outputSize.width * s.outputSize.height <= 16_777_216)
    assert.equal(editedImageName('photo.webp'), 'photo_edited.png')
    assert.equal(editedImageName('photo.webp', 'image/jpeg'), 'photo_edited.jpg')
  })
} finally { await rm(temp, { recursive: true, force: true }) }
