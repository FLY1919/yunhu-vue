import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatPlugin } from '../src/plugins/chat.ts'
import { showMessage } from '../src/core/recall-display.ts'

class LocalStorage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}
globalThis.localStorage = new LocalStorage()
globalThis.window = Object.assign(new EventTarget(), { innerHeight: 800 })
globalThis.document = Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible', hasFocus: () => true, documentElement: { dataset: {} } })
const turn = () => new Promise(resolve => setImmediate(resolve))
const room = id => ({ id, type: 2, name: id })
const msg = (id, text, ts = Date.now()) => ({ id, ts, senderId: 'other', sender: 'Other', type: 1, content: { text } })
const session = (channel, id, content = {}, kind = 1) => ({ id, channel, user: { id: 'other', name: 'Other' }, timestamp: Date.now(), raw: { type: kind, content }, elements: [] })
function harness({ messages = async () => [], recallLoad = async () => ({}) } = {}) {
  const listeners = new Map(), cleanups = []
  const ctx = {
    api: { messages, messagesBefore: async () => [], messagesAround: async () => [], conversations: async () => [], dismiss: async () => {}, recall: async () => {} },
    auth: { state: { status: 'guest', user: { id: 'me', name: 'Me' } } },
    storage: { load: async key => key === 'recall' ? recallLoad() : ({}), save: async () => {} },
    console: { state: { currentPage: '/' }, goto() {} },
    ui: { toast() {}, dismissMessages() {} }, logger: { info() {}, error() {} },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    emit(name, ...args) { for (const fn of listeners.get(name) || []) fn(...args) },
    set(key, value) { ctx[key] = value },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup },
    inject() {},
  }
  chatPlugin.apply(ctx)
  return { ctx, chat: ctx.chat, dispose() { for (const fn of cleanups.reverse()) fn(); listeners.clear() } }
}

test('real chat events restore received text and media while history and missing recalls stay hidden', async () => {
  globalThis.localStorage = new LocalStorage()
  const history = msg('old', '开启之前', Date.now() - 60000)
  let latest = [history]
  const h = harness({ messages: async () => latest })
  const c = room('a')
  try {
    h.chat.setAntiRecall(true)
    await h.chat.open(c)
    h.ctx.emit('message-recalled', { ...session(c, 'old'), recalled: true })
    assert.equal(h.chat.state.messages.find(x => x.id === 'old').retainedRecall, false)
    assert.equal(showMessage(h.chat.state.messages.find(x => x.id === 'old'), true), false)
    h.ctx.emit('message-created', session(c, 'text', { text: '真实原文' }))
    h.ctx.emit('message-recalled', { ...session(c, 'text'), recalled: true })
    const text = h.chat.state.messages.find(x => x.id === 'text')
    assert.equal(text.retainedRecall, true)
    assert.equal(text.content.text, '真实原文')
    assert.equal(text.elements[0].attrs.content, '真实原文')
    h.ctx.emit('message-created', session(c, 'image', { image_url: 'photo.png' }, 2))
    h.ctx.emit('message-recalled', { ...session(c, 'image', {}, 2), recalled: true })
    const image = h.chat.state.messages.find(x => x.id === 'image')
    assert.equal(image.retainedRecall, true)
    assert.equal(image.elements[0].attrs.src, 'photo.png')
    h.ctx.emit('message-recalled', { ...session(c, 'missing'), recalled: true })
    assert.equal(showMessage(h.chat.state.messages.find(x => x.id === 'missing'), true), false)
    latest = [history, { ...msg('text', '', Date.now()), recalled: true }]
    await h.chat.loadMessages(true)
    assert.equal(h.chat.state.messages.find(x => x.id === 'text').content.text, '真实原文')
    assert.equal(showMessage(h.chat.state.messages.find(x => x.id === 'old'), true), false)
    await h.chat.clearRecallCache()
    assert.equal(showMessage(h.chat.state.messages.find(x => x.id === 'text'), true), false)
    await h.chat.open(room('b')); await h.chat.open(c)
    assert.equal(showMessage(h.chat.state.messages.find(x => x.id === 'text'), true), false)
  } finally { h.dispose() }
})

test('a recall received before the persisted cache loads is restored afterwards', async () => {
  globalThis.localStorage = new LocalStorage(); localStorage.setItem('yh.chat.antiRecall', 'true')
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const h = harness({ recallLoad: () => pending })
  const c = room('background')
  h.chat.state.current = room('another')
  try {
    h.ctx.emit('message-recalled', { ...session(c, 'saved'), recalled: true })
    finish({ messages: { 'me:2:background:saved': { ...msg('saved', '重启后的原文'), cachedAt: Date.now() } } })
    await turn(); await h.chat.open(c)
    const restored = h.chat.state.messages.find(x => x.id === 'saved')
    assert.equal(restored.retainedRecall, true)
    assert.equal(restored.content.text, '重启后的原文')
  } finally { h.dispose() }
})

test('own recall uses the same verified cache matching and clear behavior', async () => {
  globalThis.localStorage = new LocalStorage()
  const h = harness(); const c = room('a')
  try {
    h.chat.setAntiRecall(true); await h.chat.open(c)
    h.ctx.emit('message-created', session(c, 'own', { text: '我的消息' }))
    await h.chat.recall(['own'])
    const saved = h.chat.state.messages.find(x => x.id === 'own')
    assert.equal(saved.retainedRecall, true)
    assert.equal(saved.content.text, '我的消息')
  } finally { h.dispose() }
})
