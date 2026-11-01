import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { reactive, nextTick } from 'vue'
import gifenc from 'gifenc'
const { GIFEncoder } = gifenc
const temp = await mkdtemp(join(process.cwd(), 'node_modules', '.features-regression-'))
await build({ stdin: { contents: `export { socialPlugin } from './src/plugins/social'; export { stickersPlugin } from './src/plugins/stickers'; export { botConsolePlugin } from './src/plugins/botconsole'; export { apply as backgroundApply } from './src/plugins/charbg'; export { apiPlugin } from './src/plugins/api'; export { storagePlugin } from './src/plugins/storage';
  export { authPlugin } from './src/plugins/auth'; export { groupAdminPlugin } from './src/plugins/group-admin'; export * as pb from './src/core/pb'; export { createAutoLock } from './src/core/auto-lock';
  export { decodeGif, encodeGif } from './src/core/gif-edit'; export { stickerDirectory } from './sticker-directory';`, resolveDir: process.cwd() },
  outfile: join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'components', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }],
})
const { socialPlugin, stickersPlugin, botConsolePlugin, backgroundApply, apiPlugin, storagePlugin, authPlugin, groupAdminPlugin, pb, createAutoLock, decodeGif, encodeGif, stickerDirectory } = await import(pathToFileURL(join(temp, 'test.mjs')))
class LocalStorage {
  values = new Map()
  getItem(k) { return this.values.get(k) ?? null }
  setItem(k, v) { this.values.set(k, String(v)) }
  removeItem(k) { this.values.delete(k) }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const apiHarness = () => { const ctx = { set(k, v) { this[k] = v } }; apiPlugin.apply(ctx, { base: '/test' }); return ctx.api }
try {
  await test('guest startup skips authenticated lists, then login loads each list', async () => {
    const calls = [], listeners = new Map(), deferredTimers = []
    globalThis.localStorage = new LocalStorage()
    const ctx = { api: { token: '',
      async addressBook() { calls.push('contacts'); return { users: [], groups: [], bots: [] } },
      async friendRequests() { calls.push('requests'); return [] },
      async expressionList() { calls.push('favorites'); return [] },
      async stickerPacks() { calls.push('packs'); return [] },
      async myBots() { calls.push('bots'); return { list: [], total: 0 } },
      async chatBackgroundList() { calls.push('backgrounds'); return [] },
    }, auth: { state: { user: null } }, ui: { toast() { throw new Error('guest startup must not toast') } },
      chat: { composer() {}, slot() {} }, console: { addEntry(fn) { fn({ page() {}, slot() {} }) } }, logger: { info() {} },
      get(k) { return this[k] }, set(k,v) { this[k] = v }, effect(fn) { fn() },
      setTimeout(fn) { deferredTimers.push(fn) }, on(name,fn) { const a=listeners.get(name)||[];a.push(fn);listeners.set(name,a) } }
    socialPlugin.apply(ctx); stickersPlugin.apply(ctx); botConsolePlugin.apply(ctx); backgroundApply(ctx)
    for (const fn of deferredTimers) fn()
    await nextTick(); assert.deepEqual(calls, [])
    ctx.api.token = 'test'; ctx.auth.state.user = { id: 'me' }
    for (const fn of listeners.get('auth/login') || []) fn()
    await nextTick(); await Promise.resolve()
    for (const name of ['contacts','requests','favorites','packs','bots','backgrounds']) assert.equal(calls.filter(x=>x===name).length,1,name)
  })
  await test('a stalled local service times out without permanently holding the save queue', async () => {
    const oldFetch=globalThis.fetch, oldSet=globalThis.setTimeout, oldClear=globalThis.clearTimeout
    globalThis.localStorage=new LocalStorage(); let abort, online=false
    globalThis.setTimeout=(fn,ms)=>{ if(ms===8000){abort=fn;return 12345} return oldSet(fn,ms) }
    globalThis.clearTimeout=id=>{ if(id!==12345) oldClear(id) }
    globalThis.fetch=async (_url,init={})=>{
      if(online) return new Response('{}')
      return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))
    }
    try {
      const ctx={set(k,v){this[k]=v}};storagePlugin.apply(ctx)
      const first=ctx.storage.save('lock',{locked:true}); await Promise.resolve();await Promise.resolve()
      assert.equal(typeof abort,'function');abort();assert.equal(await first,false)
      online=true;assert.equal(await ctx.storage.save('lock',{locked:false}),true)
      assert.deepEqual(await ctx.storage.load('lock'),{locked:false})
    } finally {globalThis.fetch=oldFetch;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear}
  })
  await test('video HTTP 400 region hint retries the same token/file/key in the correct region and caches by bucket', async () => {
    globalThis.localStorage = new LocalStorage()
    const api = apiHarness(), oldFetch = globalThis.fetch, oldXHR = globalThis.XMLHttpRequest, uploads = []
    const uploadToken = 'test-ak:signature:' + Buffer.from(JSON.stringify({ scope: 'chat68-video' })).toString('base64url')
    api.uploadToken = async () => uploadToken
    globalThis.fetch = async () => new Response(JSON.stringify({ hosts: [{ up: { domains: ['upload.qiniup.com'] } }] }))
    globalThis.XMLHttpRequest = class {
      upload = {}
      open(_method, url) { this.url = url }
      send(body) {
        uploads.push({ url: this.url, token: body.get('token'), key: body.get('key'), file: body.get('file') })
        this.status = this.url.includes('up-cn-east-2') ? 200 : 400
        this.responseText = JSON.stringify(this.status === 200 ? { key: body.get('key') } : { error: 'incorrect region, please use up-cn-east-2.qiniup.com, bucket is: chat68-video' })
        queueMicrotask(() => this.onload())
      }
    }
    try {
      const file = new File(['fake video bytes'], 'clip.mp4', { type: 'video/mp4' })
      const result = await api.uploadFile(file, 'video')
      assert.equal(result.host, 'up-cn-east-2.qiniup.com'); assert.equal(uploads.length, 2)
      assert.equal(uploads[0].key, uploads[1].key); assert.equal(uploads[0].token, uploads[1].token)
      assert.equal(await uploads[1].file.text(), 'fake video bytes')
      await api.uploadFile(file, 'video'); assert.equal(uploads.length, 3)
      assert.match(uploads[2].url, /up-cn-east-2/)
    } finally { globalThis.fetch = oldFetch; globalThis.XMLHttpRequest = oldXHR }
  })
  await test('discovery uses documented category strings, groupList and botList fields', async () => {
    const api = apiHarness(), oldFetch = globalThis.fetch, requests = []
    globalThis.fetch = async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) })
      const data = url.endsWith('recommend-category-list') ? { categories: ['精选', '游戏'] }
        : url.endsWith('recommend-list') ? { groupList: [{ chatId: '60923138', nickname: '测试群', avatarUrl: 'avatar' }] }
        : { botList: [{ chatId: 'bot', nickname: '助手' }] }
      return new Response(JSON.stringify({ code: 1, data }))
    }
    try {
      const categories = await api.recommendCategories(); assert.equal(categories[0].id, '精选')
      const groups = await api.recommendList(categories[0].id); assert.equal(groups[0].chatType, 2); assert.equal(groups[0].name, '测试群')
      assert.deepEqual(requests[0].body, { appChannel: 'default' })
      assert.deepEqual(requests[1].body, { category: '精选', keyword: '', size: 30, page: 1 })
      assert.equal((await api.recommendBots())[0].chatType, 3)
    } finally { globalThis.fetch = oldFetch }
  })
  await test('a late initial account read cannot overwrite the first successful account save', async () => {
    const oldFetch = globalThis.fetch, get = deferred(), started = deferred(); globalThis.localStorage = new LocalStorage()
    const ctx = { set(k, v) { this[k] = v } }; storagePlugin.apply(ctx)
    globalThis.fetch = async (url, init = {}) => {
      if (url === '/data/session') return new Response('{}')
      if (!init.method && url === '/data/accounts') { started.resolve(); return get.promise }
      return new Response('{}')
    }
    try {
      const loading = ctx.storage.load('accounts'); await started.promise
      const saved = { items: [{ id: 'first', token: 'local-test-token' }] }
      await ctx.storage.save('accounts', saved)
      get.resolve(new Response('{}')); await loading
      assert.deepEqual(await ctx.storage.load('accounts'), saved)
    } finally { globalThis.fetch = oldFetch }
  })
  await test('startup restoration finishes before the first new login; list and disk contain the new account after one login', async () => {
    const data = { session: { token: 'old', user: { id: 'old' } } }, hold = deferred(), events = []
    globalThis.localStorage = new LocalStorage(); globalThis.window = { location: { reload() { events.push('reload') } } }
    const ctx = { api: { token: '', setToken(t) { this.token = t }, async self(t) { if (t === 'old') await hold.promise; return { id: t, name: t } } },
      storage: { async load(k) { return structuredClone(data[k] || {}) }, async save(k, value) { data[k] = structuredClone(value) }, setAccount() {} },
      get(k) { return this[k] }, set(k, v) { this[k] = v }, on() {}, emit() {}, inject() {} }
    authPlugin.apply(ctx)
    const restoring = ctx.auth.restore(), login = ctx.auth.loginWithToken('first')
    hold.resolve(); await restoring; await login
    assert.equal(data.session.user.id, 'first'); assert.equal(data.accounts.items.filter(x => x.id === 'first').length, 1)
    assert.ok(ctx.auth.state.savedAccounts.some(x => x.id === 'first')); assert.equal(events.length, 1)
  })
  await test('lock-state writes are ordered so a delayed lock save cannot overwrite a later unlock', async () => {
    const oldFetch=globalThis.fetch, hold=deferred(), started=deferred(), writes=[]
    globalThis.localStorage=new LocalStorage()
    const ctx={set(k,v){this[k]=v}};storagePlugin.apply(ctx)
    globalThis.fetch=async (_url,init={})=>{
      if(init.method==='PUT'){writes.push(JSON.parse(init.body));if(writes.length===1){started.resolve();await hold.promise}}
      return new Response('{}')
    }
    try {
      const lock=ctx.storage.save('lock',{locked:true});await started.promise
      const unlock=ctx.storage.save('lock',{locked:false});await Promise.resolve()
      assert.equal(writes.length,1);assert.equal((await ctx.storage.load('lock')).locked,false)
      hold.resolve();await Promise.all([lock,unlock]);assert.deepEqual(writes,[{locked:true},{locked:false}])
    } finally {globalThis.fetch=oldFetch}
  })
  await test('automatic lock preserves the original blur deadline, cancels on timely focus and handles throttled timers', () => {
    let now = 0, nextId = 0, locked = 0, prefs = { minimize: false, blurMinutes: 2 }
    const timers = new Map(), clock = { now: () => now, set(fn, ms) { const id = ++nextId; timers.set(id, { fn, due: now + ms }); return id }, clear(id) { timers.delete(id) } }
    const lock = createAutoLock(() => prefs, () => { locked++ }, clock)
    lock.blur(); now = 60000; lock.blur(); assert.equal([...timers.values()][0].due, 120000)
    lock.focus(); now = 130000; assert.equal(timers.size, 0); assert.equal(locked, 0)
    lock.blur(); now = 260001; lock.focus(); assert.equal(locked, 1)
    prefs = { minimize: true, blurMinutes: 0 }; lock.minimize(true); assert.equal(locked, 2)
    lock.stop(); assert.equal(timers.size, 0)
  })
  await test('GIF decode/export preserves all frames, timing, loop count and transparent pixels', async () => {
    const encoded = GIFEncoder(), palette = [[255,0,0,255], [0,0,0,0], [0,0,255,255]]
    encoded.writeFrame(new Uint8Array([0,1,1,0]), 2, 2, { palette, delay: 70, repeat: 3, transparent: true, transparentIndex: 1, dispose: 2 })
    encoded.writeFrame(new Uint8Array([1,2,2,1]), 2, 2, { palette, delay: 130, transparent: true, transparentIndex: 1, dispose: 3 }); encoded.finish()
    const source = await decodeGif(new Uint8Array(encoded.bytes()).buffer)
    assert.equal(source.frames.length, 2); assert.deepEqual(source.delays, [70,130]); assert.equal(source.repeat, 3)
    assert.equal(source.frames[1].data[3], 0); assert.equal(source.frames[1].data[6], 255)
    const output = await encodeGif(source, frame => ({ ...frame, data: frame.data.slice() }))
    const roundtrip = await decodeGif(await output.arrayBuffer())
    assert.equal(output.type, 'image/gif'); assert.equal(roundtrip.frames.length, 2); assert.deepEqual(roundtrip.delays, [70,130]); assert.equal(roundtrip.repeat, 3)
    assert.deepEqual([...roundtrip.frames[1].data], [...source.frames[1].data])
    const controller = new AbortController(); controller.abort(); await assert.rejects(decodeGif(await output.arrayBuffer(), controller.signal), { name: 'AbortError' })
  })
  await test('directory bridge forwards author_id and all=true without forwarding account credentials', async () => {
    const oldFetch = globalThis.fetch; let payload, status
    globalThis.fetch = async (url, options) => { assert.equal(new URL(url).searchParams.get('author_id'), '100002'); assert.equal(new URL(url).searchParams.get('all'), 'true'); assert.equal(options.headers, undefined); return new Response('{"total":1,"data":[{"id":123,"name":"测试"}]}') }
    const response = { writeHead(value) { status = value; return this }, end(text) { payload = JSON.parse(text) } }
    try {
      await stickerDirectory({ method: 'GET', headers: { token: 'private-token' } }, response, 'author_id=100002')
      assert.equal(status, 200); assert.equal(payload.data[0].name, '测试')
      await stickerDirectory({ method: 'GET' }, response, 'author_id=not-an-id'); assert.equal(status, 400)
    } finally { globalThis.fetch = oldFetch }
  })
  await test('address book uses explicit chat types or documented list labels; unknown sections never become bots', async () => {
    const api = apiHarness(), oldFetch = globalThis.fetch
    const section = (name, type, id) => pb.fBytes(2,pb.build(pb.fStr(1,name),type ? pb.fNum(3,type):null,pb.fBytes(2,pb.build(pb.fStr(1,id),pb.fStr(8,id)))))
    globalThis.fetch = async () => new Response(pb.build(pb.fBytes(1,pb.fNum(2,1)),section('用户',1,'friend'),section('我加入的群聊',0,'60923138'),section('机器人',3,'bot'),section('未知项目',0,'unknown')))
    try { const book = await api.addressBook();assert.equal(book.groups[0].id,'60923138');assert.deepEqual(book.bots.map(x=>x.id),['bot']);assert.equal(book.users[0].id,'friend') }
    finally { globalThis.fetch = oldFetch }
  })
  await test('friend lookup retries a failed startup load, normalizes IDs, follows address-book edits and rejects post-logout replies', async () => {
    const listeners = new Map(), cleanups = [], ctx = { chat: { state: reactive({ current: null }) },
      api: { addressBook: async () => { throw new Error('not signed in yet') } }, ui: { toast() {} },
      social: { state: reactive({ loaded:false, book:{ users:[] } }) },
      get(k){return this[k]},set(k,v){this[k]=v},on(name,fn){listeners.set(name,fn)},effect(fn){cleanups.push(fn())},inject(){} }
    groupAdminPlugin.apply(ctx);await nextTick();await Promise.resolve()
    assert.equal(ctx.group.state.friendsLoaded,false)
    ctx.api.addressBook = async () => ({users:[{id:42}]});await ctx.group.loadFriends()
    assert.equal(ctx.group.isFriend('42'),true)
    ctx.social.state.loaded=true;ctx.social.state.book.users=[{id:43}]
    assert.equal(ctx.group.isFriend('42'),false);assert.equal(ctx.group.isFriend('43'),true)
    listeners.get('auth/logout')();const late=deferred();ctx.api.addressBook=()=>late.promise
    const load=ctx.group.loadFriends();listeners.get('auth/logout')();late.resolve({users:[{id:'old-account-friend'}]});await load
    assert.deepEqual(ctx.group.state.friendIds,[])
    for(const cleanup of cleanups)cleanup?.()
  })
  await test('GIF restore-to-previous disposal and opaque-to-transparent exports do not leave trails', async () => {
    const gif=GIFEncoder(),palette=[[255,0,0,255],[0,0,0,0],[0,0,255,255]]
    for(const [pixels,dispose] of [[[0,1,1,1],1],[[1,2,1,1],3],[[1,1,0,1],1]])gif.writeFrame(new Uint8Array(pixels),2,2,{palette,transparent:true,transparentIndex:1,delay:60,dispose})
    gif.finish();const animation=await decodeGif(new Uint8Array(gif.bytes()).buffer)
    assert.deepEqual([...animation.frames[2].data.slice(0,8)],[255,0,0,255,0,0,0,0])
    const opaque={width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255])}
    const clear={...opaque,data:new Uint8ClampedArray(16)}
    const output=await encodeGif({frames:[opaque,clear],delays:[100,100],repeat:0},x=>x)
    assert.equal((await decodeGif(await output.arrayBuffer())).frames[1].data[3],0)
  })
} finally { await rm(temp, { recursive: true, force: true }) }
