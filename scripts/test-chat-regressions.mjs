/** Offline regressions against real plugins and compiled SFC setup hooks. No account/API access. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, reactive, nextTick } from 'vue'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(join(root, 'node_modules', '.chat-regression-'))
const bundle = join(temp, 'subject.mjs')
await build({
  stdin: { contents: `export { chatPlugin } from './src/plugins/chat.ts';
    export { apiPlugin } from './src/plugins/api.ts';
    export * as pb from './src/core/pb.ts';
    export { uiPlugin } from './src/plugins/ui.ts';
    export { themePlugin, PRESETS } from './src/plugins/theme.ts';
    export { themePalette, contrast } from './src/core/theme-colors.ts';
    export { messagePreview, messageQuote } from './src/core/message-preview.ts';
    export { linkify } from './src/core/render.ts';
    export { fixResourceUrls } from './src/core/res.ts';
    export { openExternalUrl } from './src/core/links.ts';
    export { rankSearchResults } from './src/core/search.ts';
    export { groupTagStyle, messageGroupTags } from './src/core/group-tag.ts';
    export { groupAdminPlugin } from './src/plugins/group-admin.ts';
    export { decodePush } from './src/plugins/ws.ts';
    export { render as renderElements, parse as parseElements } from './src/satori/element.ts';
    export { createRecallCache } from './src/core/recall-cache.ts';
    export { default as Composer } from './src/components/Composer.vue';
    export { default as ChatView } from './src/components/ChatView.vue';
    export { default as Sidebar } from './src/components/Sidebar.vue';
    export { default as StickerPanel } from './src/components/StickerPanel.vue';`, resolveDir: root },
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'vue-setup', setup(b) {
    b.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      // Windows 上 esbuild onLoad 的 path 是反斜杠分隔，正则必须同时容忍 / 和 \，
      // 否则 Composer/StickerPanel 被整体桩成空组件（setupState 冻结 → 13 项全挂）。
      if (!/[\\/](Composer|StickerPanel|ChatView|Sidebar)\.vue$/.test(path)) return { contents: 'export default {}', loader: 'js' }
      const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
      return { contents: compileScript(descriptor, { id: 'regression' }).content,
        loader: 'ts', resolveDir: dirname(path) }
    })
  } }],
})
const { chatPlugin, apiPlugin, pb, uiPlugin, themePlugin, PRESETS, themePalette, contrast, messagePreview, messageQuote, linkify, fixResourceUrls, openExternalUrl, rankSearchResults, groupTagStyle, messageGroupTags, groupAdminPlugin, decodePush, renderElements, parseElements, createRecallCache, Sidebar, Composer, StickerPanel, ChatView } = await import(pathToFileURL(bundle))

class MemoryStorage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, val) { this.data.set(key, String(val)) }
  removeItem(key) { this.data.delete(key) }
}
globalThis.localStorage = new MemoryStorage()
globalThis.window = Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1280 })
globalThis.document = Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible', documentElement: { dataset: {} } })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const message = (id, ts = 1) => ({ id, ts, senderId: 'other', sender: 'Other', type: 1, content: { text: id } })
const channel = (id, type = 2) => ({ id, type, name: id })
const turn = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }

function harness(overrides = {}, storage = new MemoryStorage(), chatConfig = {}, uiConfig = {}) {
  globalThis.localStorage = storage
  const listeners = new Map(), cleanups = [], emitted = []
  const api = {
    messages: async () => [], messagesBefore: async () => [], messagesAround: async () => [],
    conversations: async () => [], searchChat: async () => [], dismiss: async () => {},
    send: async () => 'sent', ...overrides,
  }
  const ctx = {
    api, auth: { state: reactive({ status: 'guest', user: { id: 'me', name: 'Me' } }) },
    storage: { load: async () => ({}), save: async () => {} },
    console: { state: { currentPage: '/' }, goto(path) { this.state.currentPage = path } },
    logger: { error() {}, info() {} },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(fn)
      return () => listeners.get(name).delete(fn)
    },
    emit(name, ...args) {
      emitted.push([name, ...args])
      for (const fn of [...(listeners.get(name) || [])]) fn(...args)
    },
    set(key, value) { ctx[key] = value },
    effect(fn) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); return cleanup },
    inject() {},
  }
  uiPlugin.apply(ctx, uiConfig)
  chatPlugin.apply(ctx, chatConfig)
  return { ctx, chat: ctx.chat, api, emitted, listeners, dispose() {
    for (const fn of cleanups.reverse()) fn()
    listeners.clear()
  } }
}
// A Vue renderer mounts/unmounts actual SFC setup hooks, without a browser or external DOM library.
const renderer = createRenderer({
  createElement: (tag) => ({ tag }), createText: (text) => ({ text }), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
})
function mountComposer(ctx) {
  const app = renderer.createApp({ ...Composer, render: () => null })
  app.provide('ctx', ctx)
  app.mount({})
  return { setup: app._instance.setupState, unmount: () => app.unmount() }
}
function mountStickerPanel(initial = {}) {
  const calls = []
  const state = reactive({ panelOpen: true, list: [], packs: [], keyword: '', activeTab: 'fav',
    loading: false, packsLoading: false, locateSticker: null, browsePack: null, ...initial })
  const ctx = { auth: { state: reactive({ user: { id: 'me' } }) }, confirmation: true,
    api: {
      stickerDeletePack: async id => { calls.push(['deletePack', id]) },
      stickerRemovePack: async id => { calls.push(['removePack', id]) },
      stickerRemoveSticker: async (packId, id) => { calls.push(['removeSticker', packId, id]) },
      stickerRenamePack: async (id, name) => { calls.push(['renamePack', id, name]) },
    },
    stickers: { state, load: async () => { calls.push(['load']) },
    loadPacks: async () => { calls.push(['loadPacks']) },
    closeBrowse: () => { state.browsePack = null },
    addFileToTarget: (file, tab) => { calls.push(['upload', file, tab]) },
    remove: async item => { calls.push(['removeFavorite', item.id]); state.list = state.list.filter(x => x.id !== item.id) },
    topping: async item => { calls.push(['topFavorite', item.id]) },
  }, ui: { toast: (...args) => calls.push(['toast', ...args]), confirm: async (...args) => { calls.push(['confirm', ...args]); return ctx.confirmation } } }
  const app = renderer.createApp({ ...StickerPanel, render: () => null })
  app.provide('ctx', ctx)
  app.mount({})
  return { ctx, state, calls, setup: app._instance.setupState, unmount: () => app.unmount() }
}
const key = (changes = {}) => ({ key: 'Enter', isComposing: false, keyCode: 13,
  shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, ...changes })

// Real UI/chat code with only the operating-system boundary mocked.
function nativeHost(options = {}) {
  const previous = window.__TAURI__, events = new Map(), calls = [], visible = new Set()
  window.__TAURI__ = {
    core: { async invoke(command, args) {
      calls.push([command, args])
      if (command === 'native_notifications_supported') return options.initialize ? options.initialize() : true
      if (command === 'show_message_notification') {
        if (options.show) await options.show(args)
        visible.add(args.id)
      }
      if (command === 'dismiss_message_notification') visible.delete(args.id)
      if (command === 'clear_message_notifications') visible.clear()
    } },
    event: { async listen(name, fn) {
      if (options.listen) await options.listen(name)
      events.set(name, fn)
      return () => events.delete(name)
    } },
  }
  return { calls, visible, events,
    emit(name, payload) { events.get(name)?.({ payload }) },
    async flush() { for (let i = 0; i < 12; i++) await turn() },
    shown() { return calls.filter(([command]) => command === 'show_message_notification').map(([, args]) => args) },
    restore() { if (previous) window.__TAURI__ = previous; else delete window.__TAURI__ },
  }
}

try {
  await test('nested cloud bot buttons retain rows, labels and each distinct action without object coercion', () => {
    const rows = [[{ text: '打开', actionType: 1, url: 'https://example.com/path' },
      { text: '复制', actionType: 2, value: '复制内容' }], [{ text: '签到', actionType: 3, value: 'sign-in' }]]
    for (const buttons of [JSON.stringify(rows), rows]) {
      const elements = parseElements({ text: '机器人消息', buttons }, 1)
      const parsed = elements.filter(x => x.type === 'button').map(x => x.attrs)
      assert.deepEqual(parsed.map(x => [x.text, x.rowIndex, x.actionType]), [['打开', 0, 1], ['复制', 0, 2], ['签到', 1, 3]])
      assert.equal(parsed[0].url, 'https://example.com/path')
      assert.equal(parsed[1].value, '复制内容')
      assert.equal(parsed[2].value, 'sign-in')
    }
    assert.deepEqual(parseElements({ buttons: JSON.stringify([[{}, { text: '正常', action_type: 3, value: 0 }]]) }, 1)
      .filter(x => x.type === 'button').map(x => [x.attrs.text, x.attrs.value]), [['正常', '0']])
    assert.deepEqual(parseElements({ buttons: JSON.stringify([{ label: '旧格式', value: 'x' }]) }, 1)
      .filter(x => x.type === 'button').map(x => x.attrs.text), ['旧格式'])
  })
  await test('button report uses the documented protobuf fields and exposes server failure', async () => {
    const previousFetch = globalThis.fetch, sent = [], ctx = { set(key, value) { this[key] = value } }
    apiPlugin.apply(ctx, { base: '/api' })
    globalThis.fetch = async (url, init) => { sent.push([url, pb.decode(init.body)]); return new Response(JSON.stringify({ code: 1 })) }
    try {
      await ctx.api.buttonReport({ msgId: 'message-id', chatType: 2, chatId: 'group-id', userId: 'self-id', value: 'sign-in' })
      const [url, request] = sent[0]
      assert.ok(url.endsWith('/v1/msg/button-report'))
      assert.equal(request[1], undefined)
      assert.equal(pb.str(request, 2), 'message-id')
      assert.equal(pb.num(request, 3), 2)
      assert.equal(pb.str(request, 4), 'group-id')
      assert.equal(pb.str(request, 5), 'self-id')
      assert.equal(pb.str(request, 6), 'sign-in')
      globalThis.fetch = async () => new Response(JSON.stringify({ code: 403, msg: '回调被拒绝' }))
      await assert.rejects(ctx.api.buttonReport({ msgId: 'x', chatType: 1, chatId: 'y', userId: 'z', value: '' }), /回调被拒绝/)
    } finally { globalThis.fetch = previousFetch }
  })
  await test('located messages keep their highlight on target clicks, clear on outside click/Escape, and release listeners', async () => {
    const h = harness(), previousElement = globalThis.Element, previousCSS = globalThis.CSS
    globalThis.Element = class { closest() { return this.located ? this : null } }
    globalThis.CSS = { escape: value => value }
    const app = renderer.createApp({ ...ChatView, render: () => null })
    app.provide('ctx', h.ctx)
    app.mount({})
    const p = app._instance.setupState
    const classes = new Set(), target = new Element()
    target.located = true
    const row = { scrollIntoView() {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }
    try {
      await h.chat.open(channel('a'))
      h.chat.state.messages = [message('target')]
      p.box = { querySelector: () => row }
      h.chat.state.locateId = 'target'; await turn()
      assert.equal(classes.has('flash'), true)
      p.dismissLocate({ target })
      assert.equal(h.chat.state.locateId, 'target')
      document.dispatchEvent(new Event('click')); await turn()
      assert.equal(h.chat.state.locateId, null)
      assert.equal(classes.has('flash'), false)
      h.chat.state.locateId = 'target'; await turn()
      const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' })
      document.dispatchEvent(escape); await turn()
      assert.equal(h.chat.state.locateId, null)
      app.unmount()
      h.chat.state.locateId = 'after-unmount'
      document.dispatchEvent(new Event('click'))
      assert.equal(h.chat.state.locateId, 'after-unmount')
    } finally {
      if (!app._instance?.isUnmounted) app.unmount()
      h.dispose(); globalThis.Element = previousElement; globalThis.CSS = previousCSS
    }
  })
  await test('text and media replies use SendMsgRequest field 8; received history still reads field 9', async () => {
    const previousFetch = globalThis.fetch, sent = [], ctx = { set(key, value) { this[key] = value } }
    apiPlugin.apply(ctx, { base: '/api' })
    const target = '0123456789abcdef0123456789abcdef'
    globalThis.fetch = async (url, init) => {
      if (url.endsWith('/send-message')) {
        sent.push(pb.decode(init.body))
        return new Response(JSON.stringify({ code: 1 }))
      }
      return new Response(pb.build(pb.fBytes(2, pb.build(pb.fStr(1, 'received'), pb.fStr(9, target)))))
    }
    try {
      for (const [type, content] of [[1, { text: 'reply' }], [2, { image_url: 'photo.png' }]]) {
        await ctx.api.send('group', 2, type, content, { quoteId: target })
        const request = sent.at(-1)
        assert.equal(pb.str(request, 8), target)
        assert.equal(request[9], undefined)
      }
      await ctx.api.sendText('group', 2, 'no quote')
      assert.equal(sent.at(-1)[8], undefined)
      assert.equal((await ctx.api.messages('group', 2))[0].quoteId, target)
    } finally { globalThis.fetch = previousFetch }
  })
  await test('conversation API merges sticky entries, reads field 11 mute and sends native pin/mute requests', async () => {
    const originalFetch = globalThis.fetch, requests = [], ctx = { set(k, v) { this[k] = v } }
    apiPlugin.apply(ctx, { base: '/api' })
    globalThis.fetch = async (url, init) => {
      requests.push([url, init.body])
      if (url.endsWith('/sticky/list')) return new Response(JSON.stringify({ code: 1, data: { sticky: [
        { id: 5, chatId: 'g', chatType: 2, chatName: '云端置顶' },
        { id: 6, chatId: 'only-pin', chatType: 3, chatName: '单独置顶' },
      ] } }))
      if (url.endsWith('/conversation/list')) return new Response(pb.build(pb.fBytes(2, pb.build(
        pb.fStr(1, 'g'), pb.fNum(2, 2), pb.fStr(3, '群备注'), pb.fNum(11, 1), pb.fStr(15, '群名称')))))
      return new Response(JSON.stringify({ code: 1 }))
    }
    try {
      const rows = await ctx.api.conversations()
      assert.equal(rows[0].name, '群备注'); assert.equal(rows[0].pinned, true); assert.equal(rows[0].noDisturb, true)
      assert.equal(rows[1].id, 'only-pin'); assert.equal(rows[1].pinned, true)
      await ctx.api.setPinned('g', 2, false); await ctx.api.noNotify('g', false)
      assert.deepEqual(JSON.parse(requests.find(([url]) => url.endsWith('/sticky/delete'))[1]), { chatId: 'g', chatType: 2 })
      assert.deepEqual(JSON.parse(requests.find(([url]) => url.endsWith('/friend/no-notify'))[1]), { chatId: 'g', noNotify: 0 })
    } finally { globalThis.fetch = originalFetch }
  })
  await test('message lookup never encodes negative seq into uint64, and WS quote ids support documented field 11', async () => {
    const originalFetch = globalThis.fetch, ctx = { set(k, v) { this[k] = v } }; let body
    apiPlugin.apply(ctx, { base: '/api' })
    globalThis.fetch = async (_url, init) => { body = pb.decode(init.body); return new Response(pb.build()) }
    try {
      await ctx.api.messagesAround('g', 2, 'target', 30, -1)
      assert.equal(body[3], undefined); assert.equal(pb.str(body, 8), 'target')
      await ctx.api.messagesAround('g', 2, 'target', 30, 123)
      assert.equal(pb.num(body, 3), 123)
      const id = '0123456789abcdef0123456789abcdef'
      assert.equal(decodePush(pb.build(pb.fStr(11, id))).quoteId, id)
      assert.equal(decodePush(pb.build(pb.fStr(9, id))).quoteId, id)
    } finally { globalThis.fetch = originalFetch }
  })
  await test('pins stay first, the active unpinned conversation follows, and remaining unread conversations reorder', async () => {
    const h = harness()
    try {
      h.chat.state.conversations = [
        { ...channel('read-new'), ts: 100, unread: 0 },
        { ...channel('unread-old'), ts: 1, unread: 2 },
        { ...channel('read-pin'), ts: 2, unread: 0 },
        { ...channel('muted-unread'), ts: 3, unread: 1 },
      ]
      h.chat.togglePin('read-pin'); h.chat.toggleMute('muted-unread')
      assert.deepEqual(h.chat.filtered().map(c => c.id), ['read-pin', 'muted-unread', 'unread-old', 'read-new'])
      await h.chat.open(channel('unread-old'))
      assert.deepEqual(h.chat.filtered().map(c => c.id), ['read-pin', 'unread-old', 'muted-unread', 'read-new'])
      h.chat.markUnread('read-new')
      assert.deepEqual(h.chat.filtered().map(c => c.id), ['read-pin', 'unread-old', 'read-new', 'muted-unread'])
      h.chat.state.keyword = 'read-new'
      assert.equal(h.chat.filtered()[0].id, 'read-new')
    } finally { h.dispose() }
  })
  await test('the active grouped conversation is shown below pins even when its group is collapsed, with no duplication', async () => {
    const h = harness()
    try {
      h.chat.setPinMode('top')
      h.chat.state.conversations = [channel('pin'), channel('active'), channel('other')]
      h.chat.togglePin('pin'); h.chat.groups.groups.push({ id: 'folder', name: '文件夹' })
      h.chat.assignTo('active', 'folder'); h.chat.toggleCollapse('folder')
      await h.chat.open(channel('active'))
      let sections = h.chat.sections(h.chat.filtered())
      assert.deepEqual(sections.pinned.map(c => c.id), ['pin'])
      assert.deepEqual(sections.active.map(c => c.id), ['active'])
      assert.equal(sections.groups[0].items.length, 0)
      assert.deepEqual(sections.ungrouped.map(c => c.id), ['other'])
      assert.equal(h.chat.groupOf('active'), 'folder')
      await h.chat.open(channel('other')); sections = h.chat.sections(h.chat.filtered())
      assert.deepEqual(sections.active.map(c => c.id), ['other'])
      assert.deepEqual(sections.groups[0].items.map(c => c.id), ['active'])
      await h.chat.open(channel('pin')); sections = h.chat.sections(h.chat.filtered())
      assert.equal(sections.active.length, 0); assert.equal(sections.pinned.filter(c => c.id === 'pin').length, 1)
    } finally { h.dispose() }
  })
  await test('Windows registration failures retain the actual error and recover on the next test notification', async () => {
    let broken = true
    const host = nativeHost({ initialize: async () => {
      if (broken) throw new Error('AUMID registration failed: 0x80070057')
      return true
    } }), h = harness()
    try {
      await host.flush()
      assert.match(h.ctx.ui.state.notificationError, /0x80070057/)
      assert.equal(h.ctx.ui.state.nativeNotificationsSupported, true)
      h.ctx.ui.testNotification(); await host.flush()
      assert.equal(host.visible.size, 0)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      broken = false
      h.ctx.ui.testNotification(); await host.flush()
      assert.equal(host.visible.size, 1)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      assert.equal(h.ctx.ui.state.nativeNotificationsAvailable, true)
      assert.equal(h.ctx.ui.state.notificationError, '')
      assert.equal(host.events.size, 2)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('Tauri commands have generated permissions and the detached AI window cannot access account secrets', async () => {
    const [buildRs, mainRs, notifications, links, capability, panelCapability] = await Promise.all([
      'src-tauri/build.rs', 'src-tauri/src/main.rs', 'src/core/notifications.ts', 'src/core/links.ts',
      'src-tauri/capabilities/default.json',
      'src-tauri/capabilities/ai-panel.json',
    ].map(path => readFile(join(root, path), 'utf8')))
    const cap = JSON.parse(capability)
    const panelCap = JSON.parse(panelCapability)
    const commandList = buildRs.match(/AppManifest::new\(\)\.commands\(&\[([\s\S]*?)\]/)?.[1] || ''
    const manifest = [...commandList.matchAll(/"([a-z_]+)"/g)].map(m => m[1])
    const registered = (mainRs.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] || '')
      .split(',').map(s => s.trim().split('::').at(-1)).filter(Boolean)
    assert.deepEqual(manifest.toSorted(), registered.toSorted())
    const invokes = [...(notifications + links + mainRs).matchAll(/invoke\(['"]([a-z_]+)['"]/g)].map(m => m[1])
    assert.ok(invokes.includes('native_notifications_supported'))
    for (const command of new Set([...invokes, ...registered])) {
      assert.ok(manifest.includes(command), `missing app manifest command ${command}`)
      const scoped = command === 'ai_panel_action' ? panelCap : cap
      assert.ok(scoped.permissions.includes('allow-' + command.replaceAll('_', '-')), `missing capability ${command}`)
    }
    assert.deepEqual(cap.windows, ['main'])
    assert.deepEqual(cap.remote.urls, ['http://127.0.0.1:*/*'])
    assert.deepEqual(panelCap.windows, ['ai-reply'])
    assert.deepEqual(panelCap.permissions, ['core:default', 'allow-ai-panel-action'])
    assert.match(mainRs, /on_navigation/)
    assert.ok(mainRs.includes('url.port_or_known_default() == Some(app_port())'))
  })
  await test('search relevance beats recency, pinning and grouping; normalization handles full-width names and numeric IDs', () => {
    const h = harness()
    try {
      const entries = [
        { id: 'preview', name: '其他会话', preview: '正在讨论云湖', ts: 900 },
        { id: 'contains', name: '我的云湖群', ts: 800 },
        { id: 'prefix', name: '云湖开发者', ts: 700 },
        { id: 'exact', name: '云湖', ts: 1 },
        { id: 'other', name: '无关', ts: 1000 },
      ]
      h.chat.state.conversations = entries
      h.chat.togglePin('preview')
      h.chat.addGroup('项目')
      h.chat.assignTo('exact', h.chat.groups.groups[0].id)
      h.chat.toggleCollapse(h.chat.groups.groups[0].id)
      h.chat.setPinMode('tabs')
      h.chat.state.keyword = ' 云湖 '
      const found = h.chat.filtered()
      assert.deepEqual(found.map(c => c.id), ['exact', 'prefix', 'contains', 'preview'])
      for (const tab of ['unpinned', 'pinned']) {
        const sections = h.chat.sections(found, tab)
        assert.equal(sections.groups.length, 0)
        assert.equal(sections.pinned.length, 0)
        assert.deepEqual(sections.ungrouped.map(c => c.id), ['exact', 'prefix', 'contains', 'preview'])
      }
      const normalized = rankSearchResults([{ name: 'X ABC' }, { name: 'ＡＢＣ' }, { id: 123 }], ' abc ', true)
      assert.deepEqual(normalized.map(c => c.name), ['ＡＢＣ', 'X ABC'])
      assert.equal(rankSearchResults([{ id: 123 }], '１２３', true).length, 1)
      assert.deepEqual(entries.map(c => c.id), ['preview', 'contains', 'prefix', 'exact', 'other'])
    } finally { h.dispose() }
  })
  await test('global search ranks across types before truncation and ignores stale replies, clears and unmounted views', async () => {
    const first = deferred(), second = deferred(), last = deferred()
    let request = 0
    const h = harness({ homeSearch: () => [first, second, last][request++].promise })
    const app = renderer.createApp({ ...Sidebar, render: () => null })
    app.provide('ctx', h.ctx); app.mount({})
    const sidebar = app._instance.setupState
    try {
      h.chat.state.keyword = 'old'; const old = sidebar.globalSearch()
      h.chat.state.keyword = '云湖'; const current = sidebar.globalSearch()
      second.resolve({ users: Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, name: `我的云湖 ${i}` })),
        groups: [{ id: 'best', name: '云湖' }], bots: [{ id: 'bot', name: '云湖助手' }] })
      await current
      assert.equal(sidebar.gsResults.length, 8)
      assert.equal(sidebar.gsResults[0].id, 'best')
      assert.equal(sidebar.gsResults[1].id, 'bot')
      first.resolve({ users: [{ id: 'stale', name: 'old' }] }); await old
      assert.equal(sidebar.gsResults[0].id, 'best')
      h.chat.state.keyword = ''; assert.equal(sidebar.gsResults.length, 0)
      h.chat.state.keyword = 'last'; const pending = sidebar.globalSearch()
      app.unmount(); last.resolve({ groups: [{ id: 'late', name: 'last' }] }); await pending
      assert.equal(sidebar.gsResults.length, 0)
    } finally { if (app._instance) app.unmount(); h.dispose() }
  })
  await test('pin modes persist, separate both tabs, keep grouped pins at the top and never duplicate or lose conversations', () => {
    const store = new MemoryStorage(), h = harness({}, store)
    try {
      h.chat.state.conversations = ['a', 'b', 'c', 'd'].map(id => channel(id))
      h.chat.addGroup('项目')
      const group = h.chat.groups.groups[0].id
      h.chat.assignTo('b', group); h.chat.assignTo('c', group)
      h.chat.toggleCollapse(group)
      h.chat.togglePin('b'); h.chat.togglePin('d')
      const ids = s => [...s.pinned, ...s.groups.flatMap(g => g.items), ...s.ungrouped].map(c => c.id)
      let sections = h.chat.sections(h.chat.filtered())
      assert.deepEqual(sections.pinned.map(c => c.id), ['b', 'd'])
      assert.deepEqual(ids(sections).toSorted(), ['a', 'b', 'c', 'd'])
      h.chat.setPinMode('tabs')
      assert.deepEqual(ids(h.chat.sections(h.chat.filtered(), 'unpinned')).toSorted(), ['a', 'c'])
      assert.deepEqual(ids(h.chat.sections(h.chat.filtered(), 'pinned')).toSorted(), ['b', 'd'])
      h.chat.togglePin('b')
      assert.deepEqual(ids(h.chat.sections(h.chat.filtered(), 'pinned')), ['d'])
      assert.deepEqual(ids(h.chat.sections(h.chat.filtered(), 'unpinned')).toSorted(), ['a', 'b', 'c'])
      h.chat.setPinMode('invalid'); assert.equal(h.chat.groups.pinMode, 'tabs')
      const reload = harness({}, store)
      try {
        assert.equal(reload.chat.groups.pinMode, 'tabs')
        assert.equal(reload.chat.groupOf('b'), group)
        assert.equal(reload.chat.isPinned('d'), true)
        reload.chat.setPinMode('top')
      } finally { reload.dispose() }
      assert.equal(store.getItem('yunhu.conv.pinMode'), 'top')
    } finally { h.dispose() }
  })
  await test('group tags always use opaque backgrounds with readable foregrounds, including shorthand, alpha and malformed colors', () => {
    for (const color of ['#000', '#fff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#888', '#abc4', '#ff000022', '', null, 123, 'red', 'rgba(0,0,0,.1)']) {
      const style = groupTagStyle(color)
      assert.match(style.backgroundColor, /^#(?:[\da-f]{3}|[\da-f]{6})$/i)
      assert.ok(contrast(style.color, style.backgroundColor) >= 4.5, `unreadable tag ${color}`)
    }
    assert.equal(groupTagStyle('#aabbcc22').backgroundColor, '#aabbcc')
    assert.equal(groupTagStyle('#abc2').backgroundColor, '#abc')
  })
  await test('an initially closed sticker panel mounts safely and cleans pending context-menu listeners on close', async () => {
    const p = mountStickerPanel({ panelOpen: false, packs: [{ id: 2, items: [] }] })
    try {
      assert.equal(p.setup.menu, null)
      p.state.panelOpen = true; await turn()
      p.setup.openMenu('favorite-item', { type: 'contextmenu', clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ right: 10, bottom: 10 }) } }, { id: 9 })
      assert.equal(p.setup.menu.item.id, 9)
      p.state.panelOpen = false; await turn()
      assert.equal(p.setup.menu, null)
    } finally { p.unmount() }
  })
  await test('large sticker collections keep pack and item searches independent and normalize string pack IDs', async () => {
    const packs = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1), name: `合集 ${i + 1}`,
      items: Array.from({ length: 200 }, (_, j) => ({ id: j + 1, name: `CAT_${j + 1}.png`, url: `${j}.png` })) }))
    const p = mountStickerPanel({ packs, activeTab: '120' })
    try {
      assert.equal(p.setup.tab, 120)
      assert.equal(p.setup.visiblePackItems.length, 24)
      assert.equal(p.setup.matchingPackItems.length, 200)
      assert.equal(p.setup.pageCount, 9)
      p.setup.packKeyword = '合集 2'; p.state.keyword = 'ｃａｔ＿１９９'
      assert.equal(p.setup.filteredPacks.length, 11)
      assert.equal(p.setup.visiblePackItems.length, 1)
      assert.equal(p.setup.visiblePackItems[0].id, 199)
      assert.equal(p.setup.currentTotal, 200)
      assert.equal(p.setup.currentTitle, '合集 120')
    } finally { p.unmount() }
  })
  await test('selecting a sticker category exits browse mode and clears obsolete menus, editing and item search', async () => {
    const p = mountStickerPanel({ packs: [{ id: '2', name: '合集二', items: [{ id: 9, url: '9.png' }] }],
      browsePack: { id: 99, name: '其他合集', items: [], locateId: 3 } })
    try {
      p.state.keyword = 'old'; p.setup.menu = { kind: 'favorite-item', item: { id: 1 }, x: 10, y: 10 }; p.setup.renaming = { id: 1, name: 'old' }
      p.setup.pickTab('2'); await turn()
      assert.equal(p.state.activeTab, 2)
      assert.equal(p.state.browsePack, null)
      assert.equal(p.state.keyword, '')
      assert.equal(p.setup.menu, null)
      assert.equal(p.setup.renaming, null)
      assert.equal(p.setup.visiblePackItems[0].id, 9)
    } finally { p.unmount() }
  })
  await test('external sticker location clears filters and correctly highlights favorites as well as uncollected packs', async () => {
    const p = mountStickerPanel({ packs: [{ id: 2, name: '合集二', items: [] }], activeTab: 2,
      list: [{ id: 7, name: '收藏', url: '7.png' }] })
    try {
      p.setup.packKeyword = 'hidden'; p.state.keyword = 'hidden'
      p.state.activeTab = 'fav'; p.state.locateSticker = { tab: 'fav', id: 7 }; await turn()
      assert.equal(p.setup.packKeyword, '')
      assert.equal(p.state.keyword, '')
      assert.equal(p.setup.isLocated({ id: 7 }), true)
      assert.equal(p.setup.visibleFavs.length, 1)
      p.state.keyword = 'hidden'
      p.state.browsePack = { id: 99, name: '未收藏合集', items: [{ id: 199, url: '199.png' }], locateId: 199 }
      await turn()
      assert.equal(p.setup.browseItems.length, 1)
      assert.equal(p.setup.currentTitle, '未收藏合集')
    } finally { p.unmount() }
  })
  await test('sticker location scrolls only the picture region, using its own position and scroll offset', async () => {
    const p = mountStickerPanel({ packs: [{ id: 2, items: [] }] })
    try {
      const calls = []
      p.setup.bodyEl = { clientHeight: 400, scrollTop: 120,
        getBoundingClientRect: () => ({ top: 200 }),
        querySelector: () => ({ offsetHeight: 80, getBoundingClientRect: () => ({ top: 1000 }) }),
        scrollTo: (options) => calls.push(options),
      }
      p.state.locateSticker = { tab: 'fav', id: 7 }; await turn()
      assert.deepEqual(calls.at(-1), { top: 760, behavior: 'auto' })
    } finally { p.unmount() }
  })
  await test('sticker paste targets the selected category, blocks uncollected packs and is removed on close/unmount', async () => {
    const p = mountStickerPanel({ packs: [{ id: 2, items: [] }], activeTab: 2 })
    const file = { type: 'image/png' }
    const paste = () => {
      const event = new Event('paste', { cancelable: true })
      event.clipboardData = { items: [{ kind: 'file', getAsFile: () => file }] }
      document.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      assert.equal(paste(), true)
      assert.deepEqual(p.calls.filter(c => c[0] === 'upload'), [['upload', file, 2]])
      p.state.browsePack = { id: 99, name: '未收藏', items: [], locateId: 0 }
      assert.equal(paste(), true)
      assert.equal(p.calls.filter(c => c[0] === 'upload').length, 1)
      assert.equal(p.calls.at(-1)[0], 'toast')
      p.state.panelOpen = false; await turn()
      assert.equal(paste(), false)
      p.state.panelOpen = true; await turn()
    } finally { p.unmount() }
    assert.equal(paste(), false)
  })
  await test('pack ordering survives refresh and is isolated by account, while new packs remain visible', async () => {
    localStorage = new MemoryStorage()
    const packs = [{ id: 1, name: '一', items: [] }, { id: 2, name: '二', items: [] }, { id: 3, name: '三', items: [] }]
    const p = mountStickerPanel({ packs })
    try {
      p.setup.movePack(packs[2], 'top'); await turn()
      assert.deepEqual(p.setup.orderedPacks.map(x => x.id), [3, 1, 2])
      assert.deepEqual(JSON.parse(localStorage.getItem('yh.stickers.packOrder.me')), ['3', '1', '2'])
      p.state.packs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
      assert.deepEqual(p.setup.orderedPacks.map(x => x.id), [3, 1, 2, 4])
      p.ctx.auth.state.user = { id: 'other' }; await turn()
      assert.deepEqual(p.setup.orderedPacks.map(x => x.id), [1, 2, 3, 4])
      p.ctx.auth.state.user = { id: 'me' }; await turn()
      assert.deepEqual(p.setup.orderedPacks.map(x => x.id), [3, 1, 2, 4])
      p.setup.resetPackOrder()
      assert.deepEqual(p.setup.orderedPacks.map(x => x.id), [1, 2, 3, 4])
    } finally { p.unmount() }
  })
  await test('sticker removal requires confirmation and only owners can alter pack contents or delete packs', async () => {
    const own = { id: 1, name: '我创建的', createBy: 'me', items: [{ id: 11, name: '自己的', url: '11.png' }] }
    const other = { id: 2, name: '别人创建的', createBy: 'other', items: [{ id: 22, url: '22.png' }] }
    const favorite = { id: 5, url: 'fav.png' }
    const p = mountStickerPanel({ packs: [own, other], list: [favorite], activeTab: 1 })
    try {
      p.ctx.confirmation = false
      await p.setup.removeFavorite(favorite)
      await p.setup.removePack(own, true)
      assert.equal(p.state.list.length, 1)
      assert.equal(p.calls.some(c => c[0] === 'deletePack' || c[0] === 'removeFavorite'), false)
      p.ctx.confirmation = true
      await p.setup.removeSticker(other.items[0], other)
      await p.setup.removePack(other, true)
      assert.equal(p.calls.some(c => c[0] === 'deletePack' || c[0] === 'removeSticker'), false)
      await p.setup.removeFavorite(favorite)
      assert.equal(p.state.list.length, 0)
      assert.equal(p.state.packs.length, 2)
      await p.setup.removeSticker(own.items[0], own)
      assert.ok(p.calls.some(c => c[0] === 'removeSticker' && c[1] === 1 && c[2] === 11))
      await p.setup.removePack(own, true)
      assert.equal(p.state.activeTab, 'fav')
      assert.deepEqual(p.state.packs.map(x => x.id), [2])
      assert.ok(p.calls.some(c => c[0] === 'deletePack' && c[1] === 1))
      await p.setup.removePack(other, false)
      assert.ok(p.calls.some(c => c[0] === 'removePack' && c[1] === 2))
      assert.equal(p.state.activeTab, 'fav')
    } finally { p.unmount() }
  })
  await test('a failed cloud pack removal keeps the selected pack and reports the error', async () => {
    const pack = { id: 2, name: '网络失败合集', createBy: 'other', items: [] }
    const p = mountStickerPanel({ packs: [pack], activeTab: 2 })
    try {
      p.ctx.api.stickerRemovePack = async () => { throw new Error('网络不可用') }
      await p.setup.removePack(pack, false)
      assert.equal(p.state.activeTab, 2)
      assert.equal(p.state.packs.length, 1)
      assert.ok(p.calls.some(c => c[0] === 'toast' && String(c[1]).includes('网络不可用')))
    } finally { p.unmount() }
  })
  await test('opening a conversation reaches the newest messages even if stale scrolling changes the bottom flag', async () => {
    const pending = deferred(); let history = 0
    const h = harness({ messages: async id => id === 'b' ? pending.promise : [message('old')],
      messagesBefore: async () => { history++; return [] } })
    const app = renderer.createApp({ ...ChatView, render: () => null })
    app.provide('ctx', h.ctx); app.mount({})
    const p = app._instance.setupState
    try {
      await h.chat.open(channel('a')); await turn()
      const el = { scrollTop: 0, scrollHeight: 600, clientHeight: 200 }
      p.box = el
      const opening = h.chat.open(channel('b')); await turn()
      p.onScroll()
      assert.equal(history, 0)
      h.chat.setAtBottom(false) // e.g. an old DOM scroll event races the latest-page response
      pending.resolve([message('newest', 500)])
      await opening; await turn()
      assert.equal(el.scrollTop, 600)
      assert.deepEqual(h.chat.state.messages.map(x => x.id), ['newest'])
      assert.equal(p.showJump, false)
    } finally { app.unmount(); h.dispose() }
  })
  await test('an explicit history location started during loading is never forced back to the bottom', async () => {
    const pending = deferred()
    const h = harness({ messages: async () => pending.promise })
    const app = renderer.createApp({ ...ChatView, render: () => null })
    app.provide('ctx', h.ctx); app.mount({})
    const p = app._instance.setupState
    try {
      const opening = h.chat.open(channel('a')); await turn()
      const el = { scrollTop: 22, scrollHeight: 600, clientHeight: 200 }
      p.box = el
      h.chat.state.jumpedAway = true
      h.chat.setAtBottom(false)
      pending.resolve([message('latest', 500)])
      await opening; await turn()
      assert.equal(el.scrollTop, 22)
    } finally { app.unmount(); h.dispose() }
  })
  await test('text and media sends leave a located history view, including a pending top-page scroll restoration', async () => {
    for (const media of [false, true]) {
      const older = deferred(), h = harness({ messages: async () => [message('old')], messagesBefore: async () => older.promise })
      const app = renderer.createApp({ ...ChatView, render: () => null })
      app.provide('ctx', h.ctx); app.mount({})
      const p = app._instance.setupState
      try {
        await h.chat.open(channel('a')); await turn()
        const el = { scrollTop: 0, scrollHeight: 600, clientHeight: 200 }
        p.box = el; h.chat.state.hasMore = true; p.onScroll()
        h.chat.state.jumpedAway = true; h.chat.state.locateId = 'old'; h.chat.setAtBottom(false)
        const locating = deferred(); h.api.messagesAround = () => locating.promise
        const lateLocate = h.chat.locate(channel('a'), 'older-target')
        if (media) await h.chat.sendMedia([{ type: 'img', attrs: { src: 'test' }, children: [] }]); else await h.chat.send('hello')
        await turn(); assert.equal(el.scrollTop, 600)
        assert.equal(h.chat.state.jumpedAway, false); assert.equal(h.chat.state.locateId, null)
        el.scrollHeight = 900; older.resolve([message('older')]); await turn(); await turn()
        assert.equal(el.scrollTop, 900)
        locating.resolve([message('older-target')]); await lateLocate; await turn()
        assert.equal(h.chat.state.jumpedAway, false); assert.equal(h.chat.state.locateId, null)
      } finally { app.unmount(); h.dispose() }
    }
  })
  await test('slow old conversation cannot overwrite a newly opened conversation', async () => {
    const slow = deferred()
    const h = harness({ messages: async (id) => id === 'a' ? slow.promise : [message('b-message')] })
    try {
      const first = h.chat.open(channel('a'))
      await h.chat.open(channel('b'))
      slow.resolve([message('a-message')]); await first
      assert.deepEqual(h.chat.state.messages.map((m) => m.id), ['b-message'])
      assert.equal(h.chat.state.loadingMsgs, false)
    } finally { h.dispose() }
  })
  await test('late history/search replies cannot contaminate a new conversation', async () => {
    const history = deferred(), search = deferred()
    const h = harness({ messages: async (id) => [message(id)], messagesBefore: () => history.promise, searchChat: () => search.promise })
    try {
      await h.chat.open(channel('a'))
      const older = h.chat.loadMore(), results = h.chat.search('old')
      await h.chat.open(channel('b'))
      history.resolve([message('old-a')]); search.resolve([message('search-a')])
      await Promise.all([older, results])
      assert.deepEqual(h.chat.state.messages.map((m) => m.id), ['b'])
      assert.deepEqual(h.chat.state.searchResults, [])
      assert.equal(h.chat.state.searching, false)
    } finally { h.dispose() }
  })
  await test('only the latest search result wins and clearing invalidates an in-flight search', async () => {
    const a = deferred(), b = deferred()
    const h = harness({ searchChat: ({ word }) => word === 'a' ? a.promise : b.promise })
    try {
      await h.chat.open(channel('room'))
      const first = h.chat.search('a'), second = h.chat.search('b')
      b.resolve([message('b')]); await second; a.resolve([message('a')]); await first
      assert.equal(h.chat.state.searchResults[0].id, 'b')
      const late = deferred(); h.api.searchChat = () => late.promise
      const pending = h.chat.search('late'); await h.chat.search('')
      late.resolve([message('late')]); await pending
      assert.deepEqual(h.chat.state.searchResults, [])
    } finally { h.dispose() }
  })
  await test('polling is deduplicated, preserves pending messages and protects the history window', async () => {
    const slow = deferred(); let calls = 0
    const h = harness({ messages: () => { calls++; return slow.promise } })
    try {
      h.chat.state.current = channel('a')
      h.chat.state.messages = Array.from({ length: 210 }, (_, i) => message(String(i), i))
      h.chat.state.messages.push({ ...message('pending', 300), pending: true })
      h.chat.setAtBottom(false)
      const poll = h.chat.loadMessages(true); await h.chat.loadMessages(true)
      assert.equal(calls, 1)
      slow.resolve([message('new', 400)]); await poll
      assert.equal(h.chat.state.messages[0].id, '0')
      assert.ok(h.chat.state.messages.some((m) => m.id === 'pending'))
      h.chat.state.jumpedAway = true; await h.chat.loadMessages(true)
      assert.equal(calls, 2)
      assert.equal(h.chat.state.messages[0].id, '0')
    } finally { h.dispose() }
  })
  await test('text send completing after a switch neither inserts into nor clears reply in the new conversation', async () => {
    const send = deferred(); const h = harness({ send: () => send.promise })
    try {
      await h.chat.open(channel('a'))
      const sending = h.chat.send('hello')
      await h.chat.open(channel('b')); h.chat.state.reply = { id: 'b-quote' }
      send.resolve('a-sent'); await sending
      assert.deepEqual(h.chat.state.messages, [])
      assert.equal(h.chat.state.reply.id, 'b-quote')
    } finally { h.dispose() }
  })
  await test('Enter sends, Shift+Enter inserts a newline, and IME confirmation does not send', async () => {
    const h = harness(); await h.chat.open(channel('a'))
    const sent = []; h.chat.send = async (text) => { sent.push(text) }
    const c = mountComposer(h.ctx)
    try {
      c.setup.text = '你好'; c.setup.onKey(key({ isComposing: true })); await turn()
      c.setup.onKey(key({ shiftKey: true })); await turn(); assert.equal(sent.length, 0)
      c.setup.onKey(key()); await turn(); assert.deepEqual(sent, ['你好'])
    } finally { c.unmount(); h.dispose() }
  })
  await test('reopening the same channel with refreshed metadata keeps Enter sending functional', async () => {
    const h = harness(); await h.chat.open(channel('a')); const c = mountComposer(h.ctx)
    let sent = 0; h.chat.send = async () => { sent++ }
    try {
      await h.chat.open({ ...channel('a'), name: 'refreshed' })
      c.setup.text = 'still sends'; c.setup.onKey(key()); await turn()
      assert.equal(sent, 1)
    } finally { c.unmount(); h.dispose() }
  })
  await test('failed text and edits typed during a send stay in the draft', async () => {
    const h = harness(); await h.chat.open(channel('a')); const c = mountComposer(h.ctx)
    try {
      h.chat.send = async () => { throw new Error('network') }
      c.setup.text = 'keep me'; await c.setup.submit(); assert.equal(c.setup.text, 'keep me')
      const send = deferred(); h.chat.send = () => send.promise
      const task = c.setup.submit(); c.setup.text = 'new typing'; send.resolve(); await task
      assert.equal(c.setup.text, 'new typing')
    } finally { c.unmount(); h.dispose() }
  })
  await test('drafts survive remounts, channels are isolated and event listeners are disposed', async () => {
    const h = harness(); await h.chat.open(channel('a'))
    let c = mountComposer(h.ctx)
    try {
      c.setup.text = 'draft a'; c.setup.stage(new File(['x'], 'a.txt'))
      c.unmount(); assert.equal(h.listeners.get('composer/append').size, 0)
      await h.chat.open(channel('b')); c = mountComposer(h.ctx)
      assert.equal(c.setup.text, ''); c.unmount()
      await h.chat.open(channel('a')); c = mountComposer(h.ctx)
      assert.equal(c.setup.text, 'draft a'); assert.equal(c.setup.pending.length, 1)
      h.ctx.emit('composer/append', '!'); assert.equal(c.setup.text, 'draft a!')
      assert.equal(h.chat.drafts.get(channel('a', 1)).text, '')
      h.ctx.emit('auth/logout'); assert.equal(c.setup.pending.length, 0); assert.equal(c.setup.text, '')
    } finally { c.unmount(); h.dispose() }
  })
  await test('an upload finishing after switching cannot send into the new conversation', async () => {
    const h = harness(); await h.chat.open(channel('a')); const upload = deferred(); let sent = 0
    h.api.uploadAndUrl = () => upload.promise; h.chat.sendMedia = async () => { sent++ }
    const c = mountComposer(h.ctx)
    try {
      c.setup.stage(new File(['x'], 'file.txt'))
      const task = c.setup.submit(); c.unmount(); await h.chat.open(channel('b'))
      upload.resolve({ url: 'file-key' }); await task
      assert.equal(sent, 0); assert.equal(h.chat.drafts.get(channel('a')).pending.length, 1)
    } finally { h.dispose() }
  })
  await test('a caption failure retries the caption without uploading or sending the image twice', async () => {
    const h = harness(); await h.chat.open(channel('a')); let media = 0, uploads = 0, captions = 0
    h.api.uploadAndUrl = async () => { uploads++; return { url: 'image-key' } }
    h.chat.sendMedia = async () => { media++ }
    h.chat.send = async () => { if (++captions === 1) throw new Error('network') }
    const c = mountComposer(h.ctx)
    try {
      c.setup.stage(new File(['x'], 'a.png', { type: 'image/png' })); c.setup.pending[0].caption = 'caption'
      await c.setup.submit(); assert.equal(media, 1); assert.equal(c.setup.pending.length, 1)
      await c.setup.submit(); assert.equal(media, 1); assert.equal(uploads, 1); assert.equal(c.setup.pending.length, 0)
    } finally { c.unmount(); h.dispose() }
  })
  await test('send timeout is not automatically retried as another media message', async () => {
    const h = harness(); await h.chat.open(channel('a')); let media = 0
    h.api.uploadAndUrl = async () => ({ url: 'key' })
    h.chat.sendMedia = async () => { media++; throw new Error('network timeout') }
    const c = mountComposer(h.ctx)
    try {
      c.setup.stage(new File(['x'], 'file.txt')); await c.setup.submit()
      assert.equal(media, 1); assert.equal(c.setup.pending.length, 1)
    } finally { c.unmount(); h.dispose() }
  })
  const session = (room, id, self = false) => ({ id, channel: channel(room),
    user: { id: self ? 'me' : 'other', name: 'Other' }, raw: message(id), timestamp: Date.now(), elements: [] })
  await test('settings and hidden windows retain unread messages in a selected conversation; returning to chat clears them', async () => {
    const h = harness()
    const c = { ...channel('current'), unread: 0, ts: 0 }
    h.chat.state.conversations = [c]
    await h.chat.open(c)
    try {
      h.ctx.console.state.currentPage = '/account'
      h.ctx.emit('message-created', session('current', 'while-settings'))
      assert.equal(h.chat.state.conversations[0].unread, 1)
      h.api.conversations = async () => [{ ...c, unread: 1 }]
      await h.chat.loadConversations()
      assert.equal(h.chat.state.conversations[0].unread, 1)
      h.ctx.console.state.currentPage = '/'
      window.dispatchEvent(new Event('focus'))
      assert.equal(h.chat.state.conversations[0].unread, 0)
      document.hidden = true
      h.ctx.emit('message-created', session('current', 'while-hidden'))
      assert.equal(h.chat.state.conversations[0].unread, 1)
      document.hidden = false; window.dispatchEvent(new Event('focus'))
      assert.equal(h.chat.state.conversations[0].unread, 0)
    } finally { document.hidden = false; h.dispose() }
  })
  await test('a late conversation snapshot cannot overwrite a live unread increment', async () => {
    const snapshot = deferred(), h = harness({ conversations: () => snapshot.promise })
    h.chat.state.conversations = [{ ...channel('other'), unread: 0, ts: 1 }]
    try {
      const pending = h.chat.loadConversations()
      h.ctx.emit('message-created', session('other', 'live-unread'))
      snapshot.resolve([{ ...channel('other'), unread: 0, ts: 1, preview: 'old' }])
      await pending
      assert.equal(h.chat.state.conversations[0].unread, 1)
      assert.notEqual(h.chat.state.conversations[0].preview, 'old')
    } finally { h.dispose() }
  })
  await test('message Toast skips muted/self/current conversations and deduplicates WS replays', async () => {
    const h = harness(); await h.chat.open(channel('current'))
    try {
      h.chat.state.conversations = ['normal', 'muted', 'current'].map((id) => ({ ...channel(id), unread: 0 }))
      h.chat.toggleMute('muted')
      h.ctx.emit('message-created', session('muted', 'm1'))
      h.ctx.emit('message-created', session('normal', 'mine', true))
      h.ctx.emit('message-created', session('current', 'current-msg'))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      h.ctx.emit('message-created', session('normal', 'new'))
      h.ctx.emit('message-created', session('normal', 'new'))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.equal(h.chat.state.conversations.find((c) => c.id === 'normal').unread, 1)
      h.chat.toggleMute('normal'); assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose() }
  })
  await test('a minimized selected conversation notifies, while the visible selected conversation remains quiet', async () => {
    const h = harness(); await h.chat.open(channel('current'))
    const minimize = value => { const e = new Event('yh-window-minimized'); Object.defineProperty(e, 'detail', { value }); window.dispatchEvent(e) }
    try {
      h.chat.state.conversations = [{ ...channel('current'), unread: 0, noDisturb: false }]
      minimize(true)
      h.ctx.emit('message-created', session('current', 'while-minimized'))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.equal(h.chat.state.conversations[0].unread, 1)
      h.ctx.ui.dismissMessages(); minimize(false)
      h.ctx.emit('message-created', session('current', 'while-visible'))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { minimize(false); h.dispose() }
  })
  await test('unresolved conversation metadata retries after transient failures and still respects mute', async () => {
    for (const muted of [false, true]) {
      let calls = 0
      const h = harness({
        conversations: async () => { throw new Error('list offline') },
        groupInfo: async id => { if (++calls === 1) throw new Error('temporary failure'); return { id, name: '目标会话', noDisturb: muted } },
      }, new MemoryStorage(), { notificationRetryMs: 5 })
      try {
        h.chat.state.conversations = [{ ...channel('b'), noDisturb: undefined }]
        h.ctx.emit('message-created', session('b', 'retry-message'))
        await new Promise(resolve => setTimeout(resolve, 40))
        assert.ok(calls >= 2)
        assert.equal(h.ctx.ui.state.toasts.length, muted ? 0 : 1)
        if (!muted) assert.match(h.ctx.ui.state.toasts[0].text, /retry-message/)
      } finally { h.dispose() }
    }
  })
  await test('a slow older metadata lookup cannot replace the newer notification', async () => {
    const slow = deferred(); let calls = 0
    const h = harness({ conversations: async () => [], groupInfo: async () => ++calls === 1 ? slow.promise : { noDisturb: false } })
    try {
      h.chat.state.conversations = [{ ...channel('b'), noDisturb: undefined }]
      h.ctx.emit('message-created', session('b', 'older'))
      await turn()
      h.ctx.emit('message-created', session('b', 'newer'))
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.toasts[0].text, /newer/)
      slow.resolve({ noDisturb: false }); await turn()
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.toasts[0].text, /newer/)
    } finally { h.dispose() }
  })
  await test('muting, opening, or logging out invalidates pending notification metadata', async () => {
    for (const action of ['mute', 'open', 'logout']) {
      const slow = deferred()
      const h = harness({ conversations: async () => [], groupInfo: () => slow.promise })
      try {
        h.chat.state.conversations = [{ ...channel('b'), noDisturb: undefined }]
        h.ctx.emit('message-created', session('b', 'pending'))
        await turn()
        if (action === 'mute') h.chat.toggleMute('b')
        else if (action === 'open') { await h.chat.open(channel('b')); await h.chat.open(channel('other')) }
        else h.ctx.emit('auth/logout')
        slow.resolve({ noDisturb: false }); await turn(); await turn()
        assert.equal(h.ctx.ui.state.toasts.length, 0, action)
      } finally { h.dispose() }
    }
  })
  await test('clicking a Toast navigates to the correct conversation and exact older message', async () => {
    const h = harness({ messages: async () => [message('latest')], messagesAround: async (_id, _type, mid) => [message(mid)] })
    await h.chat.open(channel('a')); h.ctx.console.state.currentPage = '/settings'
    try {
      h.chat.state.conversations = [channel('b')]
      h.ctx.emit('message-created', session('b', 'target'))
      const toast = h.ctx.ui.state.toasts[0]; assert.ok(toast.onClick)
      await h.ctx.ui.activate(toast.id)
      assert.equal(h.ctx.console.state.currentPage, '/')
      assert.equal(h.chat.state.current.id, 'b')
      assert.equal(h.chat.state.locateId, 'target')
      assert.ok(h.chat.state.messages.some(m => m.id === 'target'))
      assert.equal(h.chat.state.jumpedAway, true)
    } finally { h.dispose() }
  })
  await test('late Toast location results cannot overwrite a manually selected conversation', async () => {
    const around = deferred(); const h = harness({ messagesAround: () => around.promise })
    try {
      await h.chat.open(channel('a'))
      const locating = h.chat.locate(channel('a'), 'target'); await turn()
      await h.chat.open(channel('b')); around.resolve([message('target')]); await locating
      assert.equal(h.chat.state.current.id, 'b'); assert.equal(h.chat.state.locateId, null)
    } finally { h.dispose() }
  })
  await test('Toasts are bounded, coalesce per conversation and clear on logout', async () => {
    const h = harness()
    try {
      h.ctx.ui.toast('first', 'message', 6500, { key: 'room' })
      h.ctx.ui.toast('second', 'message', 6500, { key: 'room' })
      assert.equal(h.ctx.ui.state.toasts.length, 1); assert.equal(h.ctx.ui.state.toasts[0].text, 'second')
      for (let i = 0; i < 10; i++) h.ctx.ui.toast('toast-' + i)
      assert.equal(h.ctx.ui.state.toasts.length, 5)
      h.ctx.emit('auth/logout'); assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose() }
  })

  await test('Windows mode uses the native bridge, filters mute/self/current messages and coalesces by conversation', async () => {
    const host = nativeHost(), h = harness()
    try {
      await host.flush()
      assert.equal(h.ctx.ui.state.notificationMode, 'windows')
      assert.equal(h.ctx.ui.state.nativeNotificationsAvailable, true)
      await h.chat.open(channel('current'))
      h.chat.state.conversations = ['normal', 'muted', 'current'].map(id => ({ ...channel(id), unread: 0 }))
      h.chat.toggleMute('muted')
      h.ctx.emit('message-created', session('muted', 'muted'))
      h.ctx.emit('message-created', session('normal', 'self', true))
      h.ctx.emit('message-created', session('current', 'current'))
      h.ctx.emit('message-created', session('normal', 'first'))
      h.ctx.emit('message-created', session('normal', 'first'))
      await host.flush()
      assert.equal(host.shown().length, 1)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      h.ctx.emit('message-created', session('normal', 'second')); await host.flush()
      assert.equal(host.visible.size, 1)
      assert.notEqual(host.shown()[0].id, host.shown()[1].id)
      h.chat.toggleMute('normal'); await host.flush()
      assert.equal(host.visible.size, 0)
      host.emit('message-notification-activated', host.shown()[1].id); await host.flush()
      assert.equal(h.chat.state.current.id, 'current')
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('Windows notification click uses the existing exact-message navigation and ignores stale IDs', async () => {
    const host = nativeHost(), h = harness({ messagesAround: async (_id, _type, mid) => [message(mid)] })
    try {
      await host.flush(); await h.chat.open(channel('a'))
      h.chat.state.conversations = [channel('b')]
      h.ctx.console.state.currentPage = '/account'
      h.ctx.emit('message-created', session('b', 'target')); await host.flush()
      const nativeId = host.shown()[0].id
      host.emit('message-notification-activated', 'unknown'); await host.flush()
      assert.equal(h.chat.state.current.id, 'a')
      host.emit('message-notification-activated', nativeId); await host.flush()
      assert.equal(h.ctx.console.state.currentPage, '/')
      assert.equal(h.chat.state.current.id, 'b')
      assert.equal(h.chat.state.locateId, 'target')
      assert.equal(host.visible.size, 0)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('mode switching clears native messages and persists the software-notification preference across reloads', async () => {
    const host = nativeHost(), storage = new MemoryStorage(), h = harness({}, storage)
    let second
    try {
      await host.flush()
      h.ctx.ui.testNotification(); await host.flush(); assert.equal(host.visible.size, 1)
      h.ctx.ui.setNotificationMode('in-app'); await host.flush()
      assert.equal(host.visible.size, 0)
      h.ctx.ui.testNotification(); await host.flush()
      assert.equal(host.shown().length, 1)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.equal(storage.getItem('yh.notification.mode'), 'in-app')
      h.dispose(); await host.flush()
      second = harness({}, storage); await host.flush()
      assert.equal(second.ctx.ui.state.notificationMode, 'in-app')
      second.ctx.ui.testNotification(); await host.flush()
      assert.equal(second.ctx.ui.state.toasts.length, 1)
      assert.equal(host.shown().length, 1)
    } finally { if (second) second.dispose(); else h.dispose(); await host.flush(); host.restore() }
  })
  await test('native errors fall back to a clickable in-app message without an unhandled rejection', async () => {
    const host = nativeHost({ show: async () => { throw new Error('Windows notifications disabled') } })
    const h = harness({ messagesAround: async (_id, _type, mid) => [message(mid)] })
    try {
      await host.flush(); await h.chat.open(channel('a'))
      h.chat.state.conversations = [channel('b')]
      h.ctx.emit('message-created', session('b', 'target')); await host.flush()
      assert.match(h.ctx.ui.state.notificationError, /disabled/)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      await h.ctx.ui.activate(h.ctx.ui.state.toasts[0].id)
      assert.equal(h.chat.state.locateId, 'target')
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('asynchronous Windows failure falls back once; obsolete notifications cannot reappear', async () => {
    const host = nativeHost(), h = harness()
    try {
      await host.flush(); h.ctx.ui.testNotification(); await host.flush()
      const id = host.shown()[0].id
      host.emit('message-notification-failed', { id, error: 'native failure' }); await host.flush()
      host.emit('message-notification-failed', { id, error: 'duplicate failure' }); await host.flush()
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.notificationError, /native failure/)
      h.ctx.emit('auth/logout'); await host.flush()
      host.emit('message-notification-failed', { id, error: 'late failure' }); await host.flush()
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('a stuck Windows notification falls back once and dismisses a late native completion', async () => {
    const pending = deferred(), host = nativeHost({ show: () => pending.promise })
    const h = harness({}, new MemoryStorage(), {}, { nativeTimeoutMs: 15 })
    try {
      await host.flush(); h.ctx.ui.testNotification(); await host.flush()
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      await new Promise(resolve => setTimeout(resolve, 40))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.notificationError, /超时/)
      pending.resolve(); await host.flush()
      assert.equal(host.visible.size, 0)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('a Windows fallback waits for a minimized window to return before expiring', async () => {
    const pending = deferred(), host = nativeHost({ show: () => pending.promise })
    const h = harness({}, new MemoryStorage(), {}, { nativeTimeoutMs: 15 })
    const minimize = value => { const e = new Event('yh-window-minimized'); Object.defineProperty(e, 'detail', { value }); window.dispatchEvent(e) }
    try {
      await host.flush(); minimize(true)
      h.ctx.ui.toast('最小化期间的消息', 'message', 20, { key: 'room' })
      await new Promise(resolve => setTimeout(resolve, 80))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      pending.resolve(); await host.flush()
      assert.equal(host.visible.size, 0)
      minimize(false)
      await new Promise(resolve => setTimeout(resolve, 40))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { minimize(false); h.dispose(); await host.flush(); host.restore() }
  })
  await test('messages received while locked are suppressed and never replay after unlock', async () => {
    const h = harness(); h.ctx.lock = { isLocked: true }
    try {
      h.ctx.ui.toast('锁屏期间的消息', 'message', 15, { key: 'room' })
      await new Promise(resolve => setTimeout(resolve, 35))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      h.ctx.lock.isLocked = false; h.ctx.emit('app/unlock')
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose() }
  })
  await test('locked apps never publish native message notifications and resume only for new messages', async () => {
    const host = nativeHost(), h = harness(); h.ctx.lock = { isLocked: true }
    try {
      await host.flush()
      assert.equal(h.ctx.ui.toast('锁定消息', 'message', 100, { key: 'locked' }), 0)
      await host.flush(); assert.equal(host.shown().length, 0)
      h.ctx.lock.isLocked = false; h.ctx.emit('app/unlock'); await host.flush()
      assert.equal(host.shown().length, 0)
      h.ctx.ui.toast('解锁后的新消息', 'message', 100, { key: 'new' }); await host.flush()
      assert.equal(host.shown().length, 1)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('logout and mode changes cancel in-flight native notifications when the OS call completes', async () => {
    for (const cancel of ['logout', 'mode', 'dispose']) {
      const pending = deferred(), host = nativeHost({ show: () => pending.promise }), h = harness()
      try {
        await host.flush(); h.ctx.ui.testNotification(); await host.flush()
        assert.equal(host.shown().length, 1)
        if (cancel === 'logout') h.ctx.emit('auth/logout')
        else if (cancel === 'mode') h.ctx.ui.setNotificationMode('in-app')
        else h.dispose()
        pending.resolve(); await host.flush()
        assert.equal(host.visible.size, 0)
        assert.equal(h.ctx.ui.state.toasts.length, 0)
      } finally { if (cancel !== 'dispose') h.dispose(); await host.flush(); host.restore() }
    }
  })
  await test('slow native event subscription is disposed without leaked listeners or stale fallback Toasts', async () => {
    const pending = deferred(), host = nativeHost({ listen: () => pending.promise }), h = harness()
    try {
      h.ctx.ui.testNotification(); h.dispose()
      pending.resolve(); await host.flush()
      assert.equal(host.events.size, 0)
      assert.equal(host.shown().length, 0)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { await host.flush(); host.restore() }
  })
  await test('partial native subscription failure cleans up and falls back to software notifications', async () => {
    const host = nativeHost({ listen: async name => { if (name.endsWith('failed')) throw new Error('subscription unavailable') } }), h = harness()
    try {
      await host.flush(); h.ctx.ui.testNotification(); await host.flush()
      assert.equal(host.events.size, 0)
      assert.equal(host.shown().length, 0)
      assert.equal(h.ctx.ui.state.nativeNotificationsAvailable, false)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('switching mode before native initialization finishes never shows an obsolete Windows notification', async () => {
    const pending = deferred(), host = nativeHost({ listen: () => pending.promise }), h = harness()
    try {
      h.ctx.ui.testNotification(); h.ctx.ui.setNotificationMode('in-app')
      pending.resolve(); await host.flush()
      assert.equal(host.shown().length, 0)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      h.ctx.ui.testNotification()
      assert.equal(h.ctx.ui.state.toasts.length, 1)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('native notifications and callbacks remain bounded during a burst of different conversations', async () => {
    const host = nativeHost(), h = harness()
    try {
      await host.flush()
      for (let i = 0; i < 130; i++) h.ctx.ui.toast('message ' + i, 'message', 6500, { key: 'chat:2:' + i })
      await host.flush()
      assert.equal(host.shown().length, 100)
      assert.equal(host.visible.size, 100)
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      h.ctx.emit('auth/logout'); await host.flush()
      assert.equal(host.visible.size, 0)
    } finally { h.dispose(); await host.flush(); host.restore() }
  })
  await test('a minimized active conversation sends one Windows notification that opens the correct message', async () => {
    const host = nativeHost(), h = harness()
    const minimize = value => { const e = new Event('yh-window-minimized'); Object.defineProperty(e, 'detail', { value }); window.dispatchEvent(e) }
    try {
      await host.flush(); await h.chat.open(channel('a'))
      h.chat.state.conversations = [{ ...channel('a'), noDisturb: false }]
      minimize(true)
      h.ctx.emit('message-created', session('a', 'win-minimized'))
      h.ctx.emit('message-created', session('a', 'win-minimized'))
      await host.flush()
      assert.equal(host.shown().length, 1)
      host.emit('message-notification-activated', host.shown()[0].id); await host.flush()
      assert.equal(h.chat.state.current.id, 'a')
      assert.equal(h.chat.state.locateId, 'win-minimized')
    } finally { minimize(false); h.dispose(); await host.flush(); host.restore() }
  })
  await test('unchanged message polls preserve parsed elements, while changed text still updates', async () => {
    let text = '原始正文'
    const h = harness({ messages: async () => [{ ...message('stable'), content: { text } }] })
    try {
      await h.chat.open(channel('a'))
      const elements = h.chat.state.messages[0].elements
      for (let i = 0; i < 10; i++) await h.chat.loadMessages(true)
      assert.equal(h.chat.state.messages[0].elements, elements)
      text = '已编辑正文'; await h.chat.loadMessages(true)
      assert.equal(h.chat.state.messages[0].content.text, text)
      assert.notEqual(h.chat.state.messages[0].elements, elements)
    } finally { h.dispose() }
  })
  await test('resource mode bounds the newest active message window without dropping live arrivals', async () => {
    const h = harness({ messages: async () => Array.from({length:130}, (_,i) => message('bounded-'+i,i+1)) })
    try {
      await h.chat.open(channel('a'))
      assert.equal(h.chat.state.messages.length,80)
      assert.equal(h.chat.state.messages.at(-1).id,'bounded-129')
      h.ctx.emit('message-created',session('a','new-bounded')); await turn()
      assert.equal(h.chat.state.messages.length,80)
      assert.equal(h.chat.state.messages.at(-1).id,'new-bounded')
    } finally { h.dispose() }
  })
  await test('the displayed conversation notifies when focus is lost', async () => {
    const host = nativeHost(), h = harness()
    document.hasFocus = () => false
    try {
      await host.flush(); await h.chat.open(channel('a')); h.chat.state.conversations = [channel('a')]
      h.ctx.emit('message-created', session('a', 'background')); await host.flush()
      assert.equal(host.shown().length, 1)
    } finally { delete document.hasFocus; h.dispose(); await host.flush(); host.restore() }
  })

  await test('native focus-loss events allow current-chat notifications even if WebView still reports focus', async () => {
    const host = nativeHost(), h = harness(); document.hasFocus = () => true
    const focused = value => { const e = new Event('yh-window-focused'); Object.defineProperty(e, 'detail', {value}); window.dispatchEvent(e) }
    try {
      await host.flush(); await h.chat.open(channel('a')); h.chat.state.conversations=[channel('a')]
      focused(false); h.ctx.emit('message-created',session('a','native-blur')); await host.flush()
      assert.equal(host.shown().length,1)
      focused(true); h.ctx.emit('message-created',session('a','native-focus')); await host.flush()
      assert.equal(host.shown().length,1)
    } finally { delete document.hasFocus; h.dispose(); await host.flush(); host.restore() }
  })
  await test('a locked foreground conversation retains unread messages until unlock', async () => {
    const h = harness()
    h.ctx.lock = { isLocked: true }
    try {
      await h.chat.open(channel('a')); h.chat.state.conversations = [{ ...channel('a'), unread: 0 }]
      h.ctx.emit('message-created', session('a', 'received-while-locked')); await turn()
      assert.equal(h.chat.state.conversations[0].unread, 1)
      h.ctx.lock.isLocked = false; h.ctx.emit('app/unlock'); await turn()
      assert.equal(h.chat.state.conversations[0].unread, 0)
    } finally { h.dispose() }
  })

  await test('polling fallback notifies only new unread messages and keeps server unread counts', async () => {
    let round = 0
    const h = harness({ conversations: async () => [{ ...channel('b'), ts: ++round, unread: round }], messages: async () => [message('new-from-poll')] })
    try {
      await h.chat.loadConversations(true); await turn()
      assert.equal(h.ctx.ui.state.toasts.length, 0)
      await h.chat.loadConversations(true); await turn()
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.equal(h.chat.state.conversations[0].unread, 2)
      await h.ctx.ui.activate(h.ctx.ui.state.toasts[0].id)
      assert.equal(h.chat.state.current.id, 'b')
      assert.equal(h.chat.state.locateId, 'new-from-poll')
    } finally { h.dispose() }
  })
  await test('polling retries a failed latest-message request even when the unread count no longer changes', async () => {
    let round = 0, messages = 0
    const h = harness({ conversations: async () => [{ ...channel('b'), noDisturb: false, ts: 100, unread: round++ ? 1 : 0 }],
      messages: async () => { if (++messages === 1) throw new Error('temporary'); return [message('retried-latest')] },
    }, new MemoryStorage(), { notificationRetryMs: 5 })
    try {
      await h.chat.loadConversations(true)
      await h.chat.loadConversations(true)
      await new Promise(resolve => setTimeout(resolve, 40))
      assert.equal(messages, 2)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.toasts[0].text, /retried-latest/)
    } finally { h.dispose() }
  })
  await test('background polling detects unread changes while the WebSocket is offline', async () => {
    let round = 0
    const h = harness({ conversations: async () => [{ ...channel('b'), noDisturb: false, ts: 50, unread: round++ ? 1 : 0 }],
      messages: async () => [message('background-polled')],
    }, new MemoryStorage(), { pollMs: 20, notificationRetryMs: 5 })
    try {
      document.hidden = true
      h.ctx.auth.state.status = 'ready'
      await new Promise(resolve => setTimeout(resolve, 85))
      assert.ok(round >= 2)
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.match(h.ctx.ui.state.toasts[0].text, /background-polled/)
    } finally { document.hidden = false; h.dispose() }
  })
  await test('opening a conversation invalidates an in-flight notification poll for already-read messages', async () => {
    const pending = deferred(); let round = 0
    const h = harness({ conversations: async () => [{ ...channel('b'), noDisturb: false, ts: 100, unread: round++ ? 1 : 0 }],
      messages: async (_id, _type, count) => count === 1 ? pending.promise : [message('already-read')],
    })
    try {
      await h.chat.loadConversations(true); await h.chat.loadConversations(true)
      await h.chat.open(channel('b')); await h.chat.open(channel('other'))
      pending.resolve([message('already-read')]); await turn()
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose() }
  })
  await test('a late conversation request cannot repopulate state after logout', async () => {
    const d = deferred(); const h = harness({ conversations: () => d.promise })
    try {
      const request = h.chat.loadConversations(true)
      h.ctx.emit('auth/logout'); d.resolve([channel('stale')]); await request
      assert.deepEqual(h.chat.state.conversations, [])
    } finally { h.dispose() }
  })
  await test('media sends include the reply ID and readable quote text', async () => {
    const sent = []; const h = harness({ send: async (...args) => { sent.push(args); return 'media' } })
    try {
      await h.chat.open(channel('a'))
      h.chat.setReply({ ...message('image'), type: 2, content: { image_url: 'photo.png' } })
      await h.chat.sendMedia([{ type: 'img', attrs: { src: 'new.png' }, children: [] }])
      assert.equal(sent[0][4].quoteId, 'image')
      assert.match(sent[0][3].quote_msg_text, /\[图片\]/)
      assert.equal(h.chat.state.messages[0].quoteId, 'image')
      assert.equal(h.chat.state.reply, null)
    } finally { h.dispose() }
  })
  await test('text reply survives loss of its quoted message from the local window', async () => {
    const sent = []; const h = harness({ send: async (...args) => { sent.push(args); return 'text' } })
    try {
      await h.chat.open(channel('a'))
      h.chat.setReply(message('quoted')); h.chat.state.messages = []
      await h.chat.send('reply')
      assert.equal(sent[0][4].quoteId, 'quoted')
      assert.equal(sent[0][3].quote_msg_text, 'Other: quoted')
    } finally { h.dispose() }
  })
  await test('image/video/audio summaries show message types and image quotes have thumbnails', () => {
    assert.equal(messagePreview({ type: 2, content: { image_url: '179123-file.png' } }), '[图片]')
    assert.equal(messagePreview({ type: 10, content: { video_url: 'video.mp4' } }), '[视频]')
    assert.equal(messagePreview({ type: 11, content: { audio_url: 'audio.mp3' } }), '[语音]')
    assert.equal(messageQuote({ id: 'image', type: 2, content: { image_url: 'photo.png' } }).image, 'photo.png')
  })
  await test('multiple quotes of the same missing message share one request', async () => {
    let calls = 0; const d = deferred()
    const h = harness({ messagesAround: () => { calls++; return d.promise } })
    try {
      await h.chat.open(channel('a'))
      const a = h.chat.getQuote('image'), b = h.chat.getQuote('image')
      d.resolve([{ id: 'image', type: 2, content: { image_url: 'photo.png' } }])
      assert.equal((await a).image, 'photo.png'); assert.equal((await b).preview, '[图片]'); assert.equal(calls, 1)
    } finally { h.dispose() }
  })
  await test('a WebSocket push arriving before send acknowledgement is not inserted twice', async () => {
    const d = deferred(); const h = harness({ send: () => d.promise })
    try {
      await h.chat.open(channel('a')); const sending = h.chat.send('test')
      h.ctx.emit('message-created', session('a', 'same-id', true))
      d.resolve('same-id'); await sending
      assert.equal(h.chat.state.messages.filter((m) => m.id === 'same-id').length, 1)
    } finally { h.dispose() }
  })
  await test('active conversation still notifies when a different application page is open', async () => {
    const h = harness()
    try {
      await h.chat.open(channel('a')); h.chat.state.conversations = [channel('a')]
      h.ctx.console.state.currentPage = '/settings'
      h.ctx.emit('message-created', session('a', 'new'))
      assert.equal(h.ctx.ui.state.toasts.length, 1)
    } finally { h.dispose() }
  })
  await test('same direct message from receiver-shaped WS and peer-shaped polling produces one named Toast', async () => {
    const h = harness()
    try {
      h.chat.state.conversations = [{ id: 'peer', type: 1, name: '会话名称', avatar: 'avatar.png', noDisturb: false }]
      const incoming = { ...session('peer', 'same-id'), channel: { id: 'me', type: 1 }, user: { id: 'peer', name: '发送者' } }
      h.ctx.emit('message-created', incoming)
      h.ctx.emit('message-created', { ...incoming, channel: { id: 'peer', type: 1 } })
      assert.equal(h.ctx.ui.state.toasts.length, 1)
      assert.equal(h.ctx.ui.state.toasts[0].title, '会话名称')
      assert.equal(h.ctx.ui.state.toasts[0].avatar, 'avatar.png')
      assert.equal(h.ctx.ui.state.toasts[0].key, 'chat:1:peer')
    } finally { h.dispose() }
  })
  await test('failed target lookup leaves current messages, reply and conversation intact', async () => {
    const h = harness({ messages: async () => [message('visible')], messagesAround: async () => [] })
    try {
      await h.chat.open(channel('a')); h.chat.setReply(h.chat.state.messages[0])
      await h.chat.locate(channel('b'), 'deleted')
      assert.equal(h.chat.state.current.id, 'a')
      assert.equal(h.chat.state.messages[0].id, 'visible')
      assert.equal(h.chat.state.reply.id, 'visible')
    } finally { h.dispose() }
  })
  await test('current conversation receives WS and polling updates after locating a reference without a Toast', async () => {
    let latest = [message('visible')]
    const h = harness({ messages: async () => latest })
    try {
      await h.chat.open(channel('a'))
      await h.chat.locate(channel('a'), 'visible')
      h.ctx.emit('message-created', session('a', 'live'))
      latest = [message('poll-new', 10)]
      await h.chat.loadMessages(true)
      assert.ok(h.chat.state.messages.some(m => m.id === 'visible'))
      assert.ok(h.chat.state.messages.some(m => m.id === 'live'))
      assert.ok(h.chat.state.messages.some(m => m.id === 'poll-new'))
      assert.equal(h.ctx.ui.state.toasts.filter(t => t.type === 'message').length, 0)
    } finally { h.dispose() }
  })
  await test('cloud pinned and no-disturb flags override old local state and suppress notifications', async () => {
    const h = harness({ conversations: async () => [
      { ...channel('pin'), pinned: true, noDisturb: true },
      { ...channel('normal'), pinned: false, noDisturb: false },
    ] })
    try {
      h.chat.groups.pinned.push('normal'); h.chat.groups.muted.push('normal')
      await h.chat.loadConversations()
      assert.equal(h.chat.isPinned('pin'), true)
      assert.equal(h.chat.isPinned('normal'), false)
      assert.equal(h.chat.isMuted('pin'), true)
      assert.equal(h.chat.isMuted('normal'), false)
      assert.deepEqual(h.chat.sections(h.chat.filtered()).pinned.map(c => c.id), ['pin'])
      h.ctx.emit('message-created', session('pin', 'muted-cloud'))
      assert.equal(h.ctx.ui.state.toasts.length, 0)
    } finally { h.dispose() }
  })
  await test('anti-recall preserves an original across recall and subsequent empty server polling; opt-out hides it', async () => {
    let latest = []
    const h = harness({ messages: async () => latest })
    try {
      h.chat.setAntiRecall(true)
      await h.chat.open(channel('a'))
      h.ctx.emit('message-created', { ...session('a', 'original'), raw: { type: 1, content: { text: '本地原文' } } })
      h.ctx.emit('message-recalled', { ...session('a', 'original'), recalled: true, raw: {}, elements: [] })
      assert.equal(h.chat.state.messages[0].retainedRecall, true)
      assert.equal(h.chat.state.messages[0].content.text, '本地原文')
      latest = [{ ...message('original', Date.now()), recalled: true, content: {} }]
      await h.chat.loadMessages(true)
      assert.equal(h.chat.state.messages[0].content.text, '本地原文')
      await h.chat.clearRecallCache()
      assert.equal(h.chat.state.messages[0].retainedRecall, false)
      h.chat.setAntiRecall(false)
      assert.equal(h.chat.preferences.antiRecall, false)
    } finally { h.dispose() }
  })
  await test('anti-recall does not invent a saved body from a decoded empty recall or pre-enable history', async () => {
    const old = { ...message('old', Date.now() - 60000), content: { text: '开启前的历史' } }
    let latest = [old]
    const h = harness({ messages: async () => latest })
    try {
      await h.chat.open(channel('a'))
      h.chat.setAntiRecall(true)
      h.ctx.emit('message-recalled', { ...session('a', 'old'), recalled: true, raw: { type: 1, content: { text: '', image_url: '', _raw: { 1: [] } } }, elements: [] })
      assert.equal(h.chat.state.messages.find(m => m.id === 'old').retainedRecall, false)
      h.ctx.emit('message-recalled', { ...session('a', 'missing'), recalled: true, raw: { type: 1, content: { text: '', _raw: {} } }, elements: [] })
      assert.equal(h.chat.state.messages.find(m => m.id === 'missing').retainedRecall, false)
      latest = [old, { ...message('missing'), recalled: true, content: { text: '', _raw: {} } }]
      await h.chat.loadMessages(true)
      assert.equal(h.chat.state.messages.find(m => m.id === 'old').retainedRecall, false)
      assert.equal(h.chat.state.messages.find(m => m.id === 'missing').retainedRecall, false)
    } finally { h.dispose() }
  })
  await test('a background recall received before cache loading restores the exact stored body when opened', async () => {
    const deferredLoad = deferred()
    const h = harness()
    h.ctx.storage.load = key => key === 'recall' ? deferredLoad.promise : Promise.resolve({})
    try {
      h.chat.setAntiRecall(true)
      h.ctx.emit('message-recalled', { ...session('back', 'saved'), recalled: true, raw: {}, elements: [] })
      deferredLoad.resolve({ messages: { 'me:2:back:saved': { ...message('saved', Date.now()), content: { text: '本机原文' }, cachedAt: Date.now() } } })
      await turn()
      await h.chat.open(channel('back'))
      assert.equal(h.chat.state.messages.find(m => m.id === 'saved').retainedRecall, true)
      assert.equal(h.chat.state.messages.find(m => m.id === 'saved').content.text, '本机原文')
    } finally { h.dispose() }
  })
  await test('loading older history inserts locally retained recalls omitted by the server', async () => {
    const now = Date.now()
    let latest = []
    const h = harness({ messages: async () => latest, messagesBefore: async () => [message('older', now - 120000)] })
    try {
      h.chat.setAntiRecall(true)
      await h.chat.open(channel('a'))
      h.ctx.emit('message-created', { ...session('a', 'saved-history'), timestamp: now - 60000, raw: { type: 1, content: { text: '被撤回的历史消息' } } })
      h.ctx.emit('message-recalled', { ...session('a', 'saved-history'), timestamp: now - 60000, recalled: true, raw: {}, elements: [] })
      h.chat.state.messages = []
      latest = [message('newer', now)]
      await h.chat.loadMessages()
      await h.chat.loadMore()
      assert.deepEqual(h.chat.state.messages.map(m => m.id), ['older', 'saved-history', 'newer'])
      assert.equal(h.chat.state.messages[1].retainedRecall, true)
      assert.equal(h.chat.state.messages[1].content.text, '被撤回的历史消息')
      assert.equal(h.chat.state.hasMore, false)
    } finally { h.dispose() }
  })
  await test('sticker page size persists and locating an item selects its page', async () => {
    const items = Array.from({ length: 110 }, (_, i) => ({ id: i + 1, name: `item ${i + 1}`, url: `${i}.png` }))
    const p = mountStickerPanel({ list: items, activeTab: 'fav' })
    try {
      p.setup.pageSize = 12; await turn()
      assert.equal(p.setup.visibleFavs.length, 12)
      assert.equal(localStorage.getItem('yh.stickers.pageSize'), '12')
      p.state.locateSticker = { tab: 'fav', id: 103 }; await turn()
      assert.equal(p.setup.page, 9)
      assert.ok(p.setup.visibleFavs.some(e => e.id === 103))
    } finally { p.unmount() }
  })
  await test('sender tags only appear in their owning group; private chats have none', () => {
    const tags = [{ groupId: 'a', text: 'A' }, { groupId: 'b', text: 'B' }]
    assert.deepEqual(messageGroupTags(tags, channel('a')).map(t => t.text), ['A'])
    assert.deepEqual(messageGroupTags(tags, channel('b')).map(t => t.text), ['B'])
    assert.deepEqual(messageGroupTags(tags, channel('a', 1)), [])
  })
  await test('late group-tag membership responses cannot populate a different group', async () => {
    const old = deferred()
    const h = harness({ listTags: async gid => [{ id: gid, tag: gid }],
      tagMembers: gid => gid === 'a' ? old.promise : Promise.resolve([{ id: 'member' }]) })
    groupAdminPlugin.apply(h.ctx)
    try {
      await h.chat.open(channel('a')); await turn()
      await h.chat.open(channel('b')); await h.ctx.group.loadTagMap(); await turn()
      old.resolve([{ id: 'member' }]); await turn()
      assert.deepEqual(h.ctx.group.tagsOf('member').map(t => t.tag), ['b'])
      await h.chat.open(channel('private', 1))
      assert.deepEqual(h.ctx.group.tagsOf('member'), [])
    } finally { h.dispose() }
  })
  await test('a stale polling response cannot erase a newer live edit or blank its content', async () => {
    const slow = deferred()
    const h = harness({ messages: () => slow.promise })
    try {
      h.chat.state.current = channel('a'); h.chat.state.messages = [message('live', 1)]
      const poll = h.chat.loadMessages(true)
      h.ctx.emit('message-updated', { ...session('a', 'live'), raw: { type: 1, content: { text: 'newer text' } } })
      slow.resolve([{ ...message('live', 1), content: { text: 'stale text' } }]); await poll
      assert.equal(h.chat.state.messages[0].content.text, 'newer text')
      h.ctx.emit('message-updated', { ...session('a', 'live'), raw: { content: { text: '', _raw: {} } }, elements: [{ type: 'text', attrs: { content: '' } }] })
      assert.equal(h.chat.state.messages[0].content.text, 'newer text')
    } finally { h.dispose() }
  })
  await test('a local edit survives an older in-flight poll and edit events retain the original send time', async () => {
    const h = harness({ messages: async () => [message('edit-target', 1000)], editMessage: async () => {} })
    try {
      await h.chat.open(channel('a'))
      const old = deferred(); h.api.messages = () => old.promise
      const polling = h.chat.loadMessages(true)
      await h.chat.edit('edit-target', 'edited body')
      old.resolve([message('edit-target', 1000)]); await polling
      assert.equal(h.chat.state.messages[0].content.text, 'edited body')
      h.ctx.emit('message-updated', { id: 'edit-target', channel: channel('a'), user: { id: 'other', name: 'Other' }, timestamp: 999999999, raw: { type: 1, content: { text: 'remote edit' } } })
      assert.equal(h.chat.state.messages[0].ts, 1000)
      assert.equal(h.chat.state.messages[0].content.text, 'remote edit')
    } finally { h.dispose() }
  })
  await test('video messages preserve native type, a nonzero duration and file metadata', () => {
    const result = renderElements([{ type: 'video', attrs: { src: 'https://chat-video1.jwznb.com/test.mp4', time: 6.2, width: 640, height: 360, name: 'test.mp4', size: 1234 } }])
    assert.equal(result.contentType, 10)
    assert.equal(result.content.video_url, 'test.mp4')
    assert.equal(result.content.video_time, 7)
    assert.equal(result.content.file_name, 'test.mp4')
    assert.equal(result.content.width, 640)
    assert.equal(renderElements([{ type: 'video', attrs: { src: 'test.mp4' } }]).content.video_time, 1)
  })
  await test('anti-recall stores decoded numeric protobuf without BigInt serialization errors', async () => {
    let saved = {}, enabled = true
    const cache = createRecallCache({ load: async () => ({}), save: async (_key, value) => { saved = value } }, () => 'me', () => enabled)
    await cache.ready()
    cache.merge(channel('a'), { id: 'v', ts: Date.now(), type: 10, content: { video_url: 'v.mp4', _raw: { 20: [7n] } } }, true)
    cache.merge(channel('a'), { id: 'v', recalled: true, content: {} })
    cache.dispose(); await turn()
    assert.equal(saved.messages['me:2:a:v'].content.video_url, 'v.mp4')
    assert.equal(saved.messages['me:2:a:v'].content._raw, undefined)
    enabled = false
  })
  await test('web links support www and query strings, exclude punctuation and escape HTML', () => {
    const result = linkify('看看 www.example.com； https://example.com/?a=1&b=2。<script>')
    assert.match(result, /href="https:\/\/www\.example\.com"/)
    assert.match(result, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/)
    assert.ok(!result.includes('<script>'))
    assert.match(result, /&lt;script&gt;/)
  })
  await test('resource rewriting leaves relative web links and page anchors intact', () => {
    const node = (href) => ({ attrs: { href }, getAttribute(key) { return this.attrs[key] }, setAttribute(key, value) { this.attrs[key] = value } })
    const anchors = [node('#heading'), node('/help'), node('https://example.com'), node('https://chat-img.jwznb.com/a.png')]
    fixResourceUrls({ querySelectorAll(selector) { return selector === '[href]' ? anchors : [] } })
    assert.equal(anchors[0].attrs.href, '#heading'); assert.equal(anchors[1].attrs.href, '/help')
    assert.equal(anchors[2].attrs.target, '_blank')
    assert.equal(anchors[3].attrs.href, '/res/chat-img.jwznb.com/a.png')
  })
  await test('Tauri external URLs use the native command and reject unsafe protocols', async () => {
    const calls = []
    window.__TAURI__ = { core: { invoke: async (...args) => calls.push(args) } }
    try {
      await openExternalUrl('https://example.com/?a=1&b=2')
      assert.equal(calls[0][0], 'open_external_url')
      assert.equal(calls[0][1].url, 'https://example.com/?a=1&b=2')
      await assert.rejects(() => openExternalUrl('javascript:alert(1)'))
      assert.equal(calls.length, 1)
    } finally { delete window.__TAURI__ }
  })
  await test('preset palettes meet foreground, secondary text and filled-button contrast in both modes', () => {
    for (const p of PRESETS) for (const mode of ['dark', 'light']) {
      const colors = themePalette(p, mode)
      for (const bg of [colors.bg, colors.rail, colors.card, colors.card2]) {
        assert.ok(contrast(colors.fg, bg) >= 7, `${p.id}/${mode}: foreground`)
        assert.ok(contrast(colors.fg2, bg) >= 4.5, `${p.id}/${mode}: secondary`)
        assert.ok(contrast(colors.link, bg) >= 4.5, `${p.id}/${mode}: link`)
      }
      assert.ok(contrast(colors.onAccent, colors.accent) >= 4.5, `${p.id}/${mode}: button`)
    }
  })
  await test('switching light/dark mode updates preset backgrounds and survives reapplying preferences', () => {
    const originalDocument = globalThis.document
    const styles = new Map(), nodes = new Map()
    const style = { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) }
    document.documentElement.style = style
    document.getElementById = (id) => nodes.get(id)
    document.createElement = () => ({ style: {}, remove() { nodes.delete(this.id) } })
    document.head = document.body = { appendChild(node) { nodes.set(node.id, node) } }
    const h = harness()
    try {
      themePlugin.apply(h.ctx)
      h.ctx.ui.setTheme('light'); h.ctx.theme.setRadius(12)
      assert.equal(document.documentElement.dataset.theme, 'light')
      assert.equal(styles.get('--bg'), '#f5f3f9')
      assert.equal(styles.get('--acc'), '#6750a4')
      h.ctx.ui.setTheme('dark')
      assert.equal(styles.get('--bg'), '#141218')
      assert.equal(styles.get('--acc'), '#d0bcff')
    } finally { h.dispose(); globalThis.document = originalDocument }
  })
} finally { await rm(temp, { recursive: true, force: true }) }
