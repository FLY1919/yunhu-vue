import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(root, 'node_modules', '.group-test-'))
const file = join(temp, 'group.mjs')
await build({ stdin: { contents: `export { apiPlugin } from './src/plugins/api.ts'; export { socialPlugin } from './src/plugins/social.ts'; export * as pb from './src/core/pb.ts'`, resolveDir: root }, outfile: file,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'sfc-stub', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }] })
const { apiPlugin, socialPlugin, pb } = await import(pathToFileURL(file))
const originalFetch = globalThis.fetch
const response = (id = '3333333', code = 1, msg = '') => new Response(pb.build(pb.fBytes(1, pb.build(pb.fNum(2, code), pb.fStr(3, msg))), pb.fStr(2, id)))
function apiFixture() {
  const ctx = { set(k, v) { this[k] = v } }
  apiPlugin.apply(ctx, { base: 'https://example.test' }); ctx.api.setToken('test-token')
  return ctx.api
}
function socialFixture(api) {
  const listeners = new Map(), toasts = []
  const ctx = { api: { ...api, token: '' }, auth: { state: { user: { avatar: 'https://example.test/avatar.png' } } },
    ui: { toast: (...args) => toasts.push(args) }, console: { addEntry() {} },
    on(n, f) { listeners.set(n, f) }, set(k, v) { this[k] = v }, get(k) { return this[k] }, setTimeout() {}, effect() {},
    chat: { loadConversations: async () => {} } }
  socialPlugin.apply(ctx)
  return { ctx, social: ctx.social, toasts, logout: () => listeners.get('auth/logout')() }
}
await test('documented protobuf create request and scalar group_id response, including formerly freezing IDs', async () => {
  const api = apiFixture()
  let calls = 0
  globalThis.fetch = async (url, opts) => {
    calls++; assert.equal(url, 'https://example.test/v1/group/create-group'); assert.equal(opts.method, 'POST')
    assert.equal(opts.headers.token, 'test-token'); assert.equal(opts.headers['Content-Type'], 'application/x-protobuf')
    const req = pb.decode(opts.body)
    assert.equal(pb.str(req, 2), '测试群'); assert.equal(pb.str(req, 3), '简介'); assert.equal(pb.str(req, 4), 'avatar/key.png')
    return response('3333333')
  }
  assert.equal(await api.createGroup('测试群', '简介', 'avatar/key.png'), '3333333')
  assert.equal(calls, 1)
})
await test('business errors, missing status or group ID, HTTP and HTML errors never report success', async () => {
  const api = apiFixture()
  for (const [res, pattern] of [[response('', 1100, '请求参数错误'), /请求参数错误/], [response(''), /缺少群 ID/],
    [new Response(pb.fStr(2, '1234567')), /状态/], [new Response('bad gateway', { status: 502 }), /HTTP 502/],
    [new Response('<html>error</html>'), /有效/], [new Response(new Uint8Array([0x12, 0xff])), /Protobuf/]]) {
    globalThis.fetch = async () => res
    await assert.rejects(api.createGroup('测试群', '', 'avatar'), pattern)
  }
})
await test('JSON proxy responses tolerate whitespace and use explicit business status', async () => {
  const api = apiFixture()
  globalThis.fetch = async () => new Response(' \n' + JSON.stringify({ code: 1, data: { groupId: '1234567' } }))
  assert.equal(await api.createGroup('群', '', 'avatar'), '1234567')
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 1100, msg: '头像不合规' }))
  await assert.rejects(api.createGroup('群', '', 'avatar'), /头像不合规/)
})
await test('timeout aborts the transport even if fetch ignores abort; no automatic create retry', async () => {
  const api = apiFixture(); let signal, calls = 0
  globalThis.fetch = (_, opts) => { calls++; signal = opts.signal; return new Promise(() => {}) }
  await assert.rejects(api.createGroup('群', '', 'avatar', { timeout: 15 }), { name: 'TimeoutError' })
  assert.equal(signal.aborted, true); assert.equal(calls, 1)
})
await test('cancellation covers pending response bodies and pre-cancelled requests', async () => {
  const api = apiFixture(); const ctrl = new AbortController(); let reads = 0, signal
  globalThis.fetch = async (_, opts) => { signal = opts.signal; return { arrayBuffer() { reads++; return new Promise(() => {}) } } }
  const pending = api.createGroup('群', '', 'avatar', { signal: ctrl.signal })
  await Promise.resolve(); ctrl.abort()
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(reads, 1); assert.equal(signal.aborted, true)
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  await assert.rejects(api.createGroup('群', '', 'avatar', { signal: ctrl.signal }), { name: 'AbortError' })
})
await test('blank name and missing avatar are rejected before sending', async () => {
  const api = apiFixture(); globalThis.fetch = async () => { throw new Error('must not fetch') }
  await assert.rejects(api.createGroup(' ', '', 'avatar'), /群名称/)
  await assert.rejects(api.createGroup('群'), /头像/)
})
await test('successful create returns immediately while the address book hangs', async () => {
  const { social, toasts } = socialFixture({ createGroup: async () => '3333333', addressBook: () => new Promise(() => {}) })
  assert.equal(await social.createGroup(' 群 ', ' 简介 '), '3333333')
  assert.equal(social.state.creation.pending, false); assert.equal(social.state.book.groups[0].id, '3333333')
  assert.equal(toasts.filter(x => x[1] === 'success').length, 1)
})
await test('concurrent submits send once; failures release state and permit a manual retry', async () => {
  let reject, calls = 0
  const { social } = socialFixture({ createGroup: () => { calls++; return new Promise((_, r) => { reject = r }) } })
  const first = social.createGroup('群'); assert.equal(await social.createGroup('群'), null); assert.equal(calls, 1)
  reject(new Error('头像不合规')); assert.equal(await first, null); assert.equal(social.state.creation.pending, false)
  assert.match(social.state.creation.error, /头像不合规/)
  const second = social.createGroup('群'); assert.equal(calls, 2); reject(new Error('拒绝')); await second
})
await test('stop waiting aborts creation, warns about uncertainty, and releases the form', async () => {
  const api = apiFixture(); let signal
  globalThis.fetch = (_, opts) => { signal = opts.signal; return new Promise(() => {}) }
  const { social, toasts } = socialFixture(api)
  const pending = social.createGroup('群'); social.cancelCreateGroup()
  assert.equal(await pending, null); assert.equal(signal.aborted, true); assert.equal(social.state.creation.pending, false)
  assert.match(social.state.creation.error, /避免重复创建/); assert.equal(toasts[0][1], 'warn')
})
await test('logout suppresses late results, refreshes, and notifications from the previous account', async () => {
  let finish
  const { social, logout, toasts } = socialFixture({ createGroup: () => new Promise(r => { finish = r }) })
  const pending = social.createGroup('群'); logout(); finish('3333333')
  assert.equal(await pending, null); assert.equal(social.state.creation.pending, false)
  assert.equal(social.state.book.groups.length, 0); assert.equal(toasts.length, 0)
})
await test('protobuf groups remain compatible and malformed data always terminates (worker watchdog)', async () => {
  const worker = new Worker(`const { parentPort } = require('node:worker_threads'); (async () => {
    const { pb } = await import(${JSON.stringify(pathToFileURL(file).href)});
    const good = pb.build(pb.tag(3,3), pb.fNum(2,8), pb.tag(4,3), pb.fStr(1,'x'), pb.tag(4,4), pb.tag(3,4), pb.fStr(2,'ok'));
    if (pb.str(pb.decode(good),2) !== 'ok') throw Error('valid group rejected');
    const bad = [[0x33], [0x33,0x34,0x34], [0x80], [0x08,...Array(11).fill(0x80)], [0x12,9,1], [0x0d,1], [0x0f], [0], [0x0c], ...Array.from({length:8},(_,i)=>Array.from(new TextEncoder().encode(String(i).repeat(7))))];
    for (const b of bad) { let rejected=false; try { pb.decode(Uint8Array.from(b)) } catch { rejected=true } if (!rejected) throw Error('invalid data accepted: '+b) }
    let seed=123; for(let n=0;n<5000;n++){ const b=Uint8Array.from({length:n%64},()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed>>>24 }); try { pb.decode(b) } catch {} }
    parentPort.postMessage('ok');
  })().catch(e => { throw e })`, { eval: true })
  try { await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('decoder hung')), 5000)
    worker.once('message', m => { clearTimeout(timer); assert.equal(m, 'ok'); resolve() })
    worker.once('error', e => { clearTimeout(timer); reject(e) })
  }) } finally { await worker.terminate() }
})
globalThis.fetch = originalFetch
await rm(temp, { recursive: true, force: true })
