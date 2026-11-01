import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { createHash } from 'node:crypto'

const realFetch = globalThis.fetch
const root = resolve(import.meta.dirname, '..'), temp = await mkdtemp(join(root, 'node_modules', '.userbot-test-'))
const bundle = join(temp, 'userbot.mjs')
await build({ stdin: { contents: `export * from './src/plugins/userbot.ts'; export * from './src/userbot/providers.ts'; export * from './src/userbot/memory.ts'; export * from './src/userbot/reply-format.ts'; export * from './src/userbot/persona-presets.ts'; export * from './src/userbot/actions.ts'; export { render as renderElements } from './src/satori/element.ts'; export { handleAiBridge, handleAiProof } from './ai-bridge.ts'; export { storagePlugin } from './src/plugins/storage.ts'; export { authPlugin } from './src/plugins/auth.ts'`, resolveDir: root },
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'stub-vue', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }] })
const mod = await import(pathToFileURL(bundle))
after(async () => rm(temp, { recursive: true, force: true }))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async fn => { for (let i = 0; i < 250; i++) { if (fn()) return; await sleep(8) } throw new Error('condition timed out') }

await test('the three API formats use distinct payloads and parse actual usage or labeled estimates', () => {
  const service = mod.newService(); Object.assign(service, { model: 'test-model', useTemperature: false, useMaxTokens: true, maxTokens: 123 })
  const turns = [{ role: 'user', content: 'Hi' }]
  const chat = mod.requestPayload(service, 'System', turns)
  assert.equal(chat.messages[0].role, 'system'); assert.equal(chat.max_tokens, 123); assert.equal('temperature' in chat, false)
  service.format = 'responses'; const responses = mod.requestPayload(service, 'System', turns)
  assert.equal(responses.instructions, 'System'); assert.deepEqual(responses.input, turns); assert.equal(responses.max_output_tokens, 123); assert.equal('messages' in responses, false)
  service.format = 'anthropic'; service.useMaxTokens = false; const anthropic = mod.requestPayload(service, 'System', turns)
  assert.equal(anthropic.system, 'System'); assert.deepEqual(anthropic.messages, turns); assert.equal(anthropic.max_tokens, 123)
  assert.equal(mod.parseResponse('anthropic', { content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 4, output_tokens: 3 } }, 's', turns).usage.total, 7)
  assert.equal(mod.parseResponse('responses', { output: [{ content: [{ type: 'output_text', text: 'Answer' }] }] }, 's', turns).usage.estimated, true)
  assert.equal(mod.endpoint('https://example.test/v1/', 'chat/completions'), 'https://example.test/v1/chat/completions')
  assert.throws(() => mod.endpoint('https://user:password@example.test/v1', 'models'))
  const bounded = mod.boundedTurns([{ role: 'user', content: '中'.repeat(10000) }], 20, 500)
  assert.ok(mod.estimate(bounded[0].content) + 6 <= 500)
})
await test('prompt preview and memory are isolated by channel and persona; mention uses user IDs', () => {
  const cfg = mod.newConfig(), setting = mod.newConversation(), a = mod.newPersona(), b = mod.newPersona()
  a.name = 'A'; b.name = 'B'; cfg.memories[mod.memoryKey('1:friend', a.id)] = 'friend-only'; setting.memoryEnabled = true
  assert.match(mod.composePrompt(cfg, setting, a, '1:friend'), /friend-only/)
  assert.doesNotMatch(mod.composePrompt(cfg, setting, b, '1:friend'), /friend-only/)
  assert.doesNotMatch(mod.composePrompt(cfg, setting, a, '2:group'), /friend-only/)
  setting.trigger = 'mention'; assert.equal(mod.matchesTrigger(setting, { content: '@name', raw: { content: { mentioned_id: ['me'] } } }, 'me'), true)
  assert.equal(mod.matchesTrigger(setting, { content: '@me', raw: { content: { mentioned_id: ['someone'] } } }, 'me'), false)
})
function fixture() {
  const listeners = new Map(), cleanups = [], saved = [], sent = [], pending = []
  const service = mod.newService(); Object.assign(service, { id: 'srv', model: 'model' })
  const bot = mod.newBot(); Object.assign(bot, { id: 'bot', enabled: true, canRead: true, canSend: true, allowed: ['1:friend'] })
  const config = mod.newConfig(); config.services.push(service); config.bots.push(bot); config.defaultServiceId = 'srv'
  config.conversations['1:friend'] = { ...mod.newConversation(), botId: 'bot', mode: 'auto', trigger: 'always', cooldown: 0, mergeSeconds: .005 }
  const auth = { state: { user: { id: 'me', name: 'Me' } } }
  const ctx = { auth, api: { messages: async () => [] }, chat: { state: { current: null, messages: [] }, loadMessages: async () => {} },
    storage: { load: async () => ({ config }), save: async (k, v) => saved.push([k, v]) }, console: { addEntry: () => {}, goto: () => {} }, ui: { toast() {} },
    bots: [{ id: 'me', sendMessage: async (ch, content) => { sent.push({ ch, content }); return 'sent' } }],
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn) },
    emit(name, ...args) { for (const fn of listeners.get(name) || []) fn(...args) }, set(name, value) { ctx[name] = value }, effect(fn) { cleanups.push(fn()) } }
  globalThis.window = { __TAURI__: { core: { invoke: async (name) => name === 'secure_read' ? JSON.stringify({ me: { srv: 'fake-secret' } }) : 'bridge-capability' } } }
  globalThis.fetch = (url, opts) => {
    if (url !== '/bot-ai/request') throw new Error('unexpected fetch')
    return new Promise((resolve, reject) => {
      const call = { opts, resolve: (text = 'reply') => resolve(new Response(JSON.stringify({ status: 200, data: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 2 } } }), { status: 200, headers: { 'content-type': 'application/json' } })), fail: () => resolve(new Response(JSON.stringify({ status: 500, data: { error: { message: 'provider error' } } }), { status: 200, headers: { 'content-type': 'application/json' } })) }
      pending.push(call); opts.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    })
  }
  mod.userBotPlugin.apply(ctx)
  return { ctx, config, auth, saved, sent, pending, dispose() { for (const f of cleanups) f?.() } }
}
const msg = (id, text, type = 1, channel = 'friend') => ({ id, content: text, user: { id: 'other', name: 'Other' }, channel: { id: channel, type }, raw: { type: 1, content: {} }, timestamp: Date.now() })
await test('auto mode combines incoming messages, deduplicates, and sends once to the authorized channel', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.emit('message-created', msg('m1', 'one')); await waitFor(() => h.pending.length === 1)
    h.ctx.emit('message-created', msg('m2', 'two')); await waitFor(() => h.pending.length === 2)
    const payload = JSON.parse(h.pending[1].opts.body).payload
    assert.ok(payload.messages.some(x => x.content === 'one')); assert.ok(payload.messages.some(x => x.content === 'two'))
    h.pending[1].resolve('answer'); await waitFor(() => h.sent.length === 1)
    assert.deepEqual(h.sent[0].ch, { id: 'friend', type: 1 }); assert.deepEqual(mod.renderElements(h.sent[0].content), { contentType: 1, content: { text: 'answer' } })
    h.ctx.emit('message-created', msg('m2', 'two')); await sleep(30); assert.equal(h.sent.length, 1); assert.equal(h.pending.length, 2)
    assert.equal(h.ctx.userbot.state.usageDays[Object.keys(h.ctx.userbot.state.usageDays)[0]].total, 12)
    assert.doesNotMatch(JSON.stringify(h.ctx.userbot.state.logs), /fake-secret|one|two|answer/)
  } finally { h.dispose() }
})
await test('unauthorized chats, disabled send permission and own messages never trigger a request', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.emit('message-created', msg('x', 'bad', 2, 'group'))
    h.ctx.userbot.state.config.bots[0].canSend = false
    h.ctx.emit('message-created', msg('y', 'bad'))
    h.ctx.emit('message-created', { ...msg('z', 'own'), user: { id: 'me' } })
    await sleep(50); assert.equal(h.pending.length, 0); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('account switch or changing rules aborts an in-flight generation before sending', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.emit('message-created', msg('x', 'hello')); await waitFor(() => h.pending.length === 1)
    h.ctx.emit('auth/logout'); h.auth.state.user = { id: 'other-account' }
    h.pending[0].resolve('late'); await sleep(30); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
  const j = fixture(); try {
    await waitFor(() => j.ctx.userbot.state.ready)
    j.ctx.emit('message-created', msg('a', 'hello')); await waitFor(() => j.pending.length === 1)
    j.ctx.userbot.state.config.conversations['1:friend'].mode = 'off'; j.pending[0].resolve('late')
    await sleep(30); assert.equal(j.sent.length, 0)
  } finally { j.dispose() }
})
await test('a fallback provider receives context only after the user explicitly enables it', async () => {
  for (const enabled of [false, true]) {
    const h = fixture(); try {
      await waitFor(() => h.ctx.userbot.state.ready)
      const backup = { ...mod.newService(), id: 'backup', model: 'backup-model', baseUrl: 'https://backup.example/v1' }
      h.ctx.userbot.state.config.services.push(backup)
      Object.assign(h.ctx.userbot.state.config.conversations['1:friend'], { fallbackEnabled: enabled, fallbackServiceId: 'backup' })
      h.ctx.emit('message-created', msg('m', 'private context')); await waitFor(() => h.pending.length === 1)
      h.pending[0].fail()
      if (enabled) {
        await waitFor(() => h.pending.length === 2)
        const request = JSON.parse(h.pending[1].opts.body)
        assert.match(request.url, /^https:\/\/backup\.example/)
        assert.ok(request.payload.messages.some(m => m.content === 'private context'))
        h.pending[1].resolve('reply'); await waitFor(() => h.sent.length === 1)
      } else { await sleep(40); assert.equal(h.pending.length, 1); assert.equal(h.sent.length, 0) }
    } finally { h.dispose() }
  }
})
await test('draft mode stores an editable draft without sending', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.userbot.state.config.conversations['1:friend'].mode = 'draft'
    h.ctx.emit('message-created', msg('draft', 'question')); await waitFor(() => h.pending.length === 1)
    h.pending[0].resolve('suggestion'); await waitFor(() => h.ctx.userbot.state.drafts['1:friend'] === 'suggestion')
    assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('private messages trigger the mention rule without requiring nonexistent mention IDs', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.userbot.state.config.conversations['1:friend'].trigger = 'mention'
    h.ctx.emit('message-created', msg('direct', 'hello'))
    await waitFor(() => h.pending.length === 1)
    h.pending[0].resolve(); await waitFor(() => h.sent.length === 1)
    assert.equal(mod.matchesTrigger({ ...mod.newConversation(), trigger: 'mention' }, msg('group', 'hi', 2, 'group'), 'me'), false)
  } finally { h.dispose() }
})
await test('a websocket message with an empty body is hydrated before trigger evaluation', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.api.messages = async () => [{ id: 'partial', senderId: 'other', type: 1, ts: Date.now(), content: { text: 'restored body' } }]
    h.ctx.emit('message-created', msg('partial', ''))
    await waitFor(() => h.pending.length === 1)
    assert.ok(JSON.parse(h.pending[0].opts.body).payload.messages.some(x => x.content === 'restored body'))
    h.pending[0].resolve(); await waitFor(() => h.sent.length === 1)
  } finally { h.dispose() }
})
await test('polling catches missed messages once, skips startup history and works independently of mute', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    const now = Date.now()
    h.ctx.api.messages = async () => [
      { id: 'old', senderId: 'other', type: 1, ts: now - 60000, content: { text: 'old history' } },
      { id: 'fresh', senderId: 'other', type: 1, ts: now + 10, content: { text: 'missed websocket' } },
    ]
    t.mock.timers.tick(5000); await waitFor(() => h.pending.length === 1)
    const payload = JSON.parse(h.pending[0].opts.body).payload
    assert.ok(payload.messages.some(x => x.content === 'missed websocket'))
    h.pending[0].resolve(); await waitFor(() => h.sent.length === 1)
    t.mock.timers.tick(5000); h.ctx.emit('message-created', msg('fresh', 'missed websocket'))
    await sleep(35); assert.equal(h.pending.length, 1); assert.equal(h.sent.length, 1)
  } finally { h.dispose(); t.mock.timers.reset() }
})
function memoryHistory(h) {
  h.ctx.chat.state.current = { id: 'friend', type: 1 }
  h.ctx.chat.state.messages = Array.from({ length: 8 }, (_, i) => ({ id: 'history-' + i, senderId: i % 2 ? 'me' : 'other', type: 1, ts: Date.now() - (8 - i) * 1000, content: { text: String(i) + '记'.repeat(100) } }))
  Object.assign(h.ctx.userbot.state.config.conversations['1:friend'], { memoryEnabled: true, autoMemory: true, memoryThreshold: 60, memoryKeepRecent: 2, memoryMaxTokens: 128, tokenLimit: 1500, contextCount: 20 })
}
await test('context threshold summarizes older turns, retains recent originals, persists a cursor and completes its own reply', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready); memoryHistory(h)
    h.ctx.emit('message-created', msg('latest', 'new question'))
    await waitFor(() => h.pending.length === 1)
    assert.match(h.ctx.userbot.state.context['1:friend'].stage, /压缩/)
    assert.equal(h.ctx.userbot.state.busy['1:friend'], true)
    const summary = JSON.parse(h.pending[0].opts.body).payload
    assert.match(summary.messages[0].content, /聊天记忆整理器/)
    assert.ok(mod.contextCost(summary.messages[0].content, summary.messages.slice(1)) <= 1500)
    assert.equal(summary.max_tokens, 128)
    h.pending[0].resolve('对方喜欢简洁回答，下一步讨论待办。')
    await waitFor(() => h.pending.length === 2)
    const key = mod.memoryKey('1:friend', '')
    assert.match(h.ctx.userbot.state.config.memories[key], /简洁回答/)
    assert.ok(h.ctx.userbot.state.config.memoryCursors[key].id.startsWith('history-'))
    const reply = JSON.parse(h.pending[1].opts.body).payload
    assert.match(reply.messages[0].content, /简洁回答/)
    assert.ok(reply.messages.every(x => Object.keys(x).every(k => ['role', 'content'].includes(k))))
    assert.ok(reply.messages.some(x => x.content === 'new question'))
    assert.ok(!reply.messages.some(x => x.content.startsWith('0记')))
    assert.ok(mod.contextCost(reply.messages[0].content, reply.messages.slice(1)) <= 1500)
    h.pending[1].resolve('remembered answer'); await waitFor(() => h.sent.length === 1)
    assert.equal(h.ctx.userbot.state.context['1:friend'].stage, '已自动发送')
    assert.equal(h.ctx.userbot.state.usageDays[Object.keys(h.ctx.userbot.state.usageDays)[0]].total, 24)
    h.ctx.emit('message-created', msg('next', 'second question')); await waitFor(() => h.pending.length === 3)
    assert.doesNotMatch(JSON.parse(h.pending[2].opts.body).payload.messages[0].content, /聊天记忆整理器/)
    h.pending[2].resolve(); await waitFor(() => h.sent.length === 2)
  } finally { h.dispose() }
})
await test('failed summary preserves the previous memory and still generates a bounded reply', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready); memoryHistory(h)
    const key = mod.memoryKey('1:friend', ''); h.ctx.userbot.state.config.memories[key] = '手动保留的事实'
    h.ctx.emit('message-created', msg('latest', 'question')); await waitFor(() => h.pending.length === 1)
    h.pending[0].fail(); await waitFor(() => h.pending.length === 2)
    assert.equal(h.ctx.userbot.state.config.memories[key], '手动保留的事实')
    assert.equal(h.ctx.userbot.state.config.memoryCursors[key], undefined)
    assert.ok(h.ctx.userbot.state.logs.some(x => x.status === '记忆压缩失败'))
    h.pending[1].resolve(); await waitFor(() => h.sent.length === 1)
  } finally { h.dispose() }
})
await test('memory stays unchanged below threshold, when disabled, or when account changes during summarization', async () => {
  for (const enabled of [false, true]) {
    const h = fixture(); try {
      await waitFor(() => h.ctx.userbot.state.ready); memoryHistory(h)
      Object.assign(h.ctx.userbot.state.config.conversations['1:friend'], { autoMemory: enabled, memoryThreshold: 95, tokenLimit: enabled ? 10000 : 1500 })
      h.ctx.emit('message-created', msg('n', 'hi')); await waitFor(() => h.pending.length === 1)
      assert.doesNotMatch(JSON.parse(h.pending[0].opts.body).payload.messages[0].content, /聊天记忆整理器/)
      h.pending[0].resolve(); await waitFor(() => h.sent.length === 1)
      assert.deepEqual(h.ctx.userbot.state.config.memories, {})
    } finally { h.dispose() }
  }
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready); memoryHistory(h)
    h.ctx.emit('message-created', msg('x', 'hi')); await waitFor(() => h.pending.length === 1)
    h.ctx.emit('auth/logout'); h.auth.state.user = { id: 'new-owner' }
    h.pending[0].resolve('must not persist'); await sleep(30)
    assert.deepEqual(h.ctx.userbot.state.config.memories, {}); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('an incoming message during send does not cancel or replay the already sending batch', async () => {
  const h = fixture(); let completeSend
  try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.bots[0].sendMessage = async (ch, content) => { h.sent.push({ ch, content }); await new Promise(r => { completeSend = r }); return 'sent' }
    h.ctx.emit('message-created', msg('first', 'first question')); await waitFor(() => h.pending.length === 1)
    h.pending[0].resolve('first answer'); await waitFor(() => !!completeSend)
    h.ctx.emit('message-created', msg('second', 'second question'))
    assert.equal(h.pending[0].opts.signal.aborted, false)
    completeSend(); await waitFor(() => h.pending.length === 2)
    const payload = JSON.parse(h.pending[1].opts.body).payload
    assert.ok(payload.messages.some(x => x.content === 'second question'))
    assert.equal(payload.messages.some(x => x.content === 'first question'), false)
    h.pending[1].resolve('second answer'); await waitFor(() => h.sent.length === 2); completeSend()
  } finally { h.dispose() }
})
await test('AI format selection unwraps structured replies, honors user overrides and tolerates plain compatible providers', () => {
  assert.deepEqual(mod.parseReply(JSON.stringify({ format: 'markdown', content: '# 标题\n- 要点' })), { kind: 3, text: '# 标题\n- 要点' })
  assert.deepEqual(mod.parseReply('你好呀'), { kind: 1, text: '你好呀' })
  assert.throws(() => mod.parseReply('{"format":"markdown","content":"unfinished'), /格式不完整/)
  assert.equal(mod.parseReply('```js\nconst x = 1\n```').kind, 3)
  assert.equal(mod.parseReply(JSON.stringify({ format: 'text', content: '**保持文字**' })).kind, 1)
  assert.equal(mod.parseReply(JSON.stringify({ format: 'markdown', content: '# 标题' }), 'text').kind, 1)
  assert.equal(mod.parseReply('普通短句', 'markdown').kind, 3)
  assert.deepEqual(mod.parseReply('```json\n{"format":"text","content":"你好"}\n```'), { kind: 1, text: '你好' })
  assert.equal(mod.parseReply('{"unrelated":"JSON example"}').text, '{"unrelated":"JSON example"}')
})
await test('automatic AI replies use native Markdown or text messages rather than leaking their format envelope', async () => {
  for (const [preference, format, expected] of [['auto', 'markdown', 3], ['auto', 'text', 1], ['text', 'markdown', 1], ['markdown', 'text', 3]]) {
    const h = fixture(); try {
      await waitFor(() => h.ctx.userbot.state.ready)
      h.ctx.userbot.state.config.conversations['1:friend'].replyFormat = preference
      h.ctx.emit('message-created', msg('format', 'question')); await waitFor(() => h.pending.length === 1)
      h.pending[0].resolve(JSON.stringify({ format, content: '# Reply' })); await waitFor(() => h.sent.length === 1)
      const message = mod.renderElements(h.sent[0].content)
      assert.equal(message.contentType, expected); assert.equal(message.content.text, '# Reply')
    } finally { h.dispose() }
  }
})
await test('all six preset personas have editable independent fields and distinct styles', () => {
  assert.equal(mod.PERSONA_PRESETS.length, 6)
  assert.equal(new Set(mod.PERSONA_PRESETS.map(p => p.name)).size, 6)
  for (const p of mod.PERSONA_PRESETS) for (const field of ['name', 'description', 'background', 'personality', 'style', 'relationship', 'boundaries', 'examples', 'extra']) assert.ok(p[field]?.trim())
  const a = { ...mod.newPersona(), ...mod.PERSONA_PRESETS[0] }, b = { ...mod.newPersona(), ...mod.PERSONA_PRESETS[0] }
  a.name = '自定义'; assert.notEqual(a.id, b.id); assert.equal(b.name, '温柔搭子'); assert.equal(mod.PERSONA_PRESETS[0].name, '温柔搭子')
})
async function groupFixture({ owner = false, enabled = true, review = true } = {}) {
  const h = fixture(); await waitFor(() => h.ctx.userbot.state.ready)
  const bot = h.ctx.userbot.state.config.bots[0]
  bot.workMode = 'management'; bot.allowed.push('2:group'); bot.management = { ...mod.newActionPolicy(), enabled, requireConfirmation: review }
  h.ctx.userbot.state.config.conversations['2:group'] = { ...mod.newConversation(), botId: 'bot', mode: 'auto', trigger: 'always', cooldown: 0, mergeSeconds: 0, tokenLimit: 10000 }
  h.info = { id: 'group', name: '测试群', owner: owner ? 'me' : 'owner', admins: owner ? ['admin'] : ['me', 'admin'], introduction: '旧简介', limitedMsgType: '1,2' }
  h.members = [{ id: 'other', name: '张三', level: 0 }, { id: 'admin', name: '另一个管理', level: 2 }, { id: 'owner', name: '群主', level: 100 }]
  h.tags = [{ id: 7, groupId: 'group', tag: '旧标签', color: '#2196F3', desc: '' }]
  h.calls = []
  Object.assign(h.ctx.api, {
    groupInfo: async () => structuredClone(h.info),
    listMembers: async (gid, opts = {}) => ({ list: h.members.filter(m => !opts.keywords || m.id === opts.keywords), total: h.members.length }),
    listTags: async () => structuredClone(h.tags),
    getUser: async id => ({ id, name: '受邀用户' }),
    messagesAround: async () => [{ id: 'target-message', chatId: 'group', senderId: 'other', content: { text: '待撤回消息' } }],
  })
  for (const name of ['gagMember', 'kickMember', 'recall', 'inviteToGroup', 'createTag', 'editTag', 'relateTag', 'relateTagCancel', 'editGroup', 'setMsgTypeLimit']) {
    h.ctx.api[name] = async (...args) => { h.calls.push([name, ...args]) }
  }
  h.propose = async (actions, mid = 'managed') => {
    h.ctx.emit('message-created', msg(mid, '请按管理规则处理', 2, 'group'))
    await waitFor(() => h.pending.length > 0)
    h.pending.at(-1).resolve(JSON.stringify({ format: 'text', content: 'AI 尚未执行的建议', actions }))
  }
  return h
}
const muteAction = () => ({ type: 'mute', userId: 'other', seconds: 600, reason: '符合用户设置的测试规则' })
await test('new and migrated bots default to no management power with confirmation enabled', async () => {
  const b = mod.newBot(); assert.equal(b.management.enabled, false); assert.equal(b.management.requireConfirmation, true)
  const h = fixture(); try { await waitFor(() => h.ctx.userbot.state.ready); assert.equal(h.ctx.userbot.state.config.bots[0].management.requireConfirmation, true) } finally { h.dispose() }
  assert.equal(mod.groupRole({ createBy: 'me', owner: 'new-owner', admins: [] }, 'me'), null)
})
await test('AI group actions wait for a concrete approval and double approval executes only once', async () => {
  const h = await groupFixture(); try {
    await h.propose([muteAction()]); await waitFor(() => !!h.ctx.userbot.state.review)
    const r = h.ctx.userbot.state.review
    assert.equal(r.groupId, 'group'); assert.match(r.items[0].details.join(' '), /张三.*other/); assert.equal(h.calls.length, 0)
    h.ctx.userbot.resolveReview('stale-review-id', true); assert.equal(h.calls.length, 0)
    h.ctx.userbot.resolveReview(r.id, true); h.ctx.userbot.resolveReview(r.id, true)
    await waitFor(() => h.sent.length === 1)
    assert.deepEqual(h.calls, [['gagMember', 'group', 'other', 600]])
    assert.match(mod.renderElements(h.sent[0].content).content.text, /已执行/)
    assert.doesNotMatch(mod.renderElements(h.sent[0].content).content.text, /AI 尚未执行/)
  } finally { h.dispose() }
})
await test('cancelling, timing out, changing rules or logging out never executes a pending action', async t => {
  for (const mode of ['cancel', 'timeout', 'rules', 'logout']) {
    const h = await groupFixture()
    if (mode === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      if (mode === 'timeout') {
        // Drive the zero-delay generation merge while other awaits run on real intervals.
        h.ctx.emit('message-created', msg('timed', 'question', 2, 'group')); t.mock.timers.tick(1)
        for (let i = 0; i < 80 && !h.pending.length; i++) await new Promise(r => setImmediate(r))
        h.pending[0].resolve(JSON.stringify({ format: 'text', content: '', actions: [muteAction()] }))
        for (let i = 0; i < 80 && !h.ctx.userbot.state.review; i++) await new Promise(r => setImmediate(r))
        assert.ok(h.ctx.userbot.state.review); t.mock.timers.tick(300001)
      } else {
        await h.propose([muteAction()]); await waitFor(() => !!h.ctx.userbot.state.review)
        if (mode === 'cancel') h.ctx.userbot.resolveReview(h.ctx.userbot.state.review.id, false)
        if (mode === 'rules') h.ctx.userbot.state.config.bots[0].management.requireConfirmation = false
        if (mode === 'logout') { h.ctx.emit('auth/logout'); h.auth.state.user = { id: 'new-account' } }
      }
      if (mode === 'timeout') { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)) }
      else await sleep(25)
      assert.equal(h.calls.length, 0); assert.equal(h.sent.length, 0); assert.equal(h.ctx.userbot.state.review, null)
    } finally { h.dispose(); if (mode === 'timeout') t.mock.timers.reset() }
  }
})
await test('disabling review permits only checked action types, never grants missing account privileges', async () => {
  const h = await groupFixture({ review: false }); try {
    await h.propose([muteAction()]); await waitFor(() => h.calls.length === 1)
    assert.equal(h.ctx.userbot.state.review, null)
  } finally { h.dispose() }
  for (const blocked of ['bot', 'account', 'action']) {
    const h = await groupFixture({ review: false }); try {
      if (blocked === 'bot') h.ctx.userbot.state.config.bots[0].management.enabled = false
      if (blocked === 'account') h.info.admins = []
      if (blocked === 'action') h.ctx.userbot.state.config.bots[0].management.allowed = ['kick']
      await h.propose([muteAction()]); await sleep(30)
      assert.equal(h.calls.length, 0); assert.equal(h.sent.length, 0)
    } finally { h.dispose() }
  }
})
await test('permission downgrade or a changed target after review prevents execution', async () => {
  for (const change of ['role', 'target', 'settings']) {
    const h = await groupFixture(); try {
      await h.propose([change === 'settings' ? { type: 'group_update', name: '新名称', reason: 'test' } : muteAction()]); await waitFor(() => !!h.ctx.userbot.state.review)
      if (change === 'role') h.info.admins = []
      else if (change === 'target') h.members[0].level = 2
      else h.info.name = '已被其他人修改'
      h.ctx.userbot.resolveReview(h.ctx.userbot.state.review.id, true)
      await waitFor(() => h.sent.length === 1)
      assert.equal(h.calls.length, 0); assert.match(mod.renderElements(h.sent[0].content).content.text, /未能完成或确认/)
    } finally { h.dispose() }
  }
})
await test('admins cannot moderate the owner, themselves or another admin; owner-only settings stay protected', async () => {
  for (const action of [ { ...muteAction(), userId: 'owner' }, { ...muteAction(), userId: 'me' }, { type: 'kick', userId: 'admin', reason: 'test' }, { type: 'message_types', types: [1], reason: 'test' } ]) {
    const h = await groupFixture({ review: false }); try {
      await h.propose([action]); await sleep(30); assert.equal(h.calls.length, 0)
    } finally { h.dispose() }
  }
})
await test('all supported management actions dispatch to explicit native APIs in the captured group', async () => {
  const cases = [
    [muteAction(), ['gagMember', 'group', 'other', 600]],
    [{ type: 'kick', userId: 'other', reason: 'test' }, ['kickMember', 'group', 'other']],
    [{ type: 'recall', messageId: 'target-message', reason: 'test' }, ['recall', 'group', 2, 'target-message']],
    [{ type: 'invite', userId: 'friend', reason: 'test' }, ['inviteToGroup', 'group', ['friend']]],
    [{ type: 'tag_create', tag: '新标签', color: '#123456', desc: '说明', reason: 'test' }, ['createTag', 'group', '新标签', '#123456', '说明']],
    [{ type: 'tag_edit', tagId: 7, tag: '改名', color: '#123456', desc: '', reason: 'test' }, ['editTag', 'group', 7, { tag: '改名', color: '#123456', desc: '' }]],
    [{ type: 'tag_assign', tagId: 7, userId: 'other', remove: false, reason: 'test' }, ['relateTag', 'other', 7]],
    [{ type: 'tag_assign', tagId: 7, userId: 'other', remove: true, reason: 'test' }, ['relateTagCancel', 'other', 7]],
    [{ type: 'group_update', name: '新群名', introduction: '新简介', reason: 'test' }, ['editGroup', 'group', { name: '新群名', introduction: '新简介' }]],
    [{ type: 'message_types', types: [3, 1], reason: 'test' }, ['setMsgTypeLimit', 'group', '1,3']],
  ]
  for (const [action, expected] of cases) {
    const h = await groupFixture({ owner: true, review: false }); try {
      await h.propose([action]); await waitFor(() => h.calls.length === 1)
      assert.deepEqual(h.calls[0], expected)
    } finally { h.dispose() }
  }
})
await test('cross-group IDs, unknown fields, duplicate actions and unverified message/tag targets are rejected', async () => {
  assert.throws(() => mod.validateAction({ ...muteAction(), groupId: 'different' }), /跨群/)
  assert.throws(() => mod.validateAction({ ...muteAction(), seconds: 123 }), /时长/)
  assert.throws(() => mod.parseActionReply('{"format":"text","content":"","actions":[', 'auto', true), /格式不完整/)
  assert.throws(() => mod.parseActionReply(JSON.stringify({ format: 'text', content: '', actions: [muteAction(), muteAction()] }), 'auto', true), /重复/)
  const h = await groupFixture({ review: false }); try {
    h.tags[0].groupId = 'different'
    await h.propose([{ type: 'tag_edit', tagId: 7, tag: '改名', reason: 'test' }]); await sleep(35)
    assert.equal(h.calls.length, 0)
  } finally { h.dispose() }
  const privateChat = await groupFixture({ review: false }); try {
    privateChat.ctx.emit('message-created', msg('private-action', 'question'))
    await waitFor(() => privateChat.pending.length === 1)
    privateChat.pending[0].resolve(JSON.stringify({ format: 'text', content: '', actions: [muteAction()] }))
    await sleep(30); assert.equal(privateChat.calls.length, 0); assert.equal(privateChat.sent.length, 0)
  } finally { privateChat.dispose() }
  const j = await groupFixture({ review: false }); try {
    j.ctx.api.messagesAround = async () => [{ id: 'target-message', chatId: 'different', senderId: 'other' }]
    await j.propose([{ type: 'recall', messageId: 'target-message', reason: 'test' }]); await sleep(35)
    assert.equal(j.calls.length, 0)
  } finally { j.dispose() }
})
await test('a mutation failure is not retried and prevents later batch actions from executing', async () => {
  const h = await groupFixture({ review: false }); try {
    h.ctx.api.gagMember = async (...args) => { h.calls.push(['gagMember', ...args]); throw new Error('network timeout with unknown result') }
    await h.propose([muteAction(), { type: 'kick', userId: 'other', reason: 'test' }]); await waitFor(() => h.sent.length === 1)
    assert.equal(h.calls.length, 1); assert.match(mod.renderElements(h.sent[0].content).content.text, /剩余 1 项未执行/)
  } finally { h.dispose() }
})
await test('new messages arriving during a pending approval do not silently dismiss or duplicate that approval', async () => {
  const h = await groupFixture(); try {
    h.ctx.userbot.state.config.conversations['2:group'].mergeSeconds = .005
    await h.propose([muteAction()]); await waitFor(() => !!h.ctx.userbot.state.review)
    const id = h.ctx.userbot.state.review.id
    h.ctx.emit('message-created', msg('next-group-message', 'new message', 2, 'group')); await sleep(20)
    assert.equal(h.ctx.userbot.state.review.id, id)
    h.ctx.userbot.resolveReview(id, true); await waitFor(() => h.calls.length === 1)
    assert.equal(h.calls.length, 1)
  } finally { h.dispose() }
})
await test('group action permission is independent of permission to send automatic chat messages', async () => {
  const h = await groupFixture({ review: false }); try {
    h.ctx.userbot.state.config.bots[0].canSend = false
    await h.propose([muteAction()]); await waitFor(() => h.calls.length === 1)
    await sleep(15); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('approval requests from multiple groups queue without replacing each other', async () => {
  const h = await groupFixture(); try {
    h.ctx.userbot.state.config.bots[0].allowed.push('2:second')
    h.ctx.userbot.state.config.conversations['2:second'] = { ...h.ctx.userbot.state.config.conversations['2:group'] }
    h.ctx.api.groupInfo = async gid => ({ ...structuredClone(h.info), id: gid })
    h.ctx.emit('message-created', msg('group-one', 'question', 2, 'group'))
    h.ctx.emit('message-created', msg('group-two', 'question', 2, 'second'))
    await waitFor(() => h.pending.length === 2)
    for (const p of h.pending) p.resolve(JSON.stringify({ format: 'text', content: '', actions: [muteAction()] }))
    await waitFor(() => h.ctx.userbot.state.reviewCount === 2)
    const first = h.ctx.userbot.state.review; h.ctx.userbot.resolveReview(first.id, false)
    await waitFor(() => h.ctx.userbot.state.reviewCount === 1)
    const next = h.ctx.userbot.state.review
    assert.notEqual(next.groupId, first.groupId)
    h.ctx.userbot.resolveReview(next.id, true); await waitFor(() => h.calls.length === 1)
    assert.equal(h.calls[0][1], next.groupId)
  } finally { h.dispose() }
})
await test('Windows credential migration encrypts before deleting legacy data and preserves a concurrent newer login', async () => {
  const local = new Map(), files = { session: { token: 'old-token', user: { id: 'me' } }, accounts: {} }, vault = {}, calls = []
  globalThis.localStorage = { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) }
  globalThis.fetch = async (url, opts = {}) => {
    const name = String(url).split('/').at(-1); calls.push(`${opts.method || 'GET'}:${name}`)
    if (opts.method === 'DELETE') { files[name] = {}; return new Response('{}') }
    if (opts.method === 'PUT') throw new Error('credentials must never be written to ordinary storage')
    return new Response(JSON.stringify(files[name] || {}), { headers: { 'content-type': 'application/json' } })
  }
  globalThis.window = { __TAURI__: { core: { invoke: async (cmd, args) => {
    if (cmd === 'secure_read') return vault[args.name] ?? null
    if (cmd === 'secure_write') { vault[args.name] = args.data; calls.push('SECURE:' + args.name); return }
    if (cmd === 'secure_delete') delete vault[args.name]
  } } } }
  const ctx = { set(name, value) { this[name] = value } }; mod.storagePlugin.apply(ctx)
  assert.equal((await ctx.storage.load('session')).token, 'old-token')
  assert.ok(calls.indexOf('SECURE:session') < calls.indexOf('DELETE:session'))
  assert.equal(JSON.parse(vault.session).token, 'old-token'); assert.deepEqual(files.session, {})
  assert.equal(calls.some(x => x.startsWith('PUT:')), false)
  ctx.storage.setAccount('me')
  await ctx.storage.save('userbots', { memories: { private: 'isolated' } })
  assert.equal(JSON.parse(vault.userbots).__yh_accounts.me.memories.private, 'isolated')
  assert.equal(calls.some(x => x === 'PUT:userbots'), false)

  let resolveRead
  const pendingRead = new Promise(resolve => { resolveRead = resolve })
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === 'secure_read') return pendingRead
    if (cmd === 'secure_write') { vault[args.name] = args.data; return }
  }
  const other = { set(name, value) { this[name] = value } }; mod.storagePlugin.apply(other)
  const oldRead = other.storage.load('accounts')
  await other.storage.save('accounts', { items: [{ token: 'new-token' }] })
  resolveRead(JSON.stringify({ items: [{ token: 'stale-token' }] }))
  assert.equal((await oldRead).items[0].token, 'new-token')
  assert.equal(JSON.parse(vault.accounts).items[0].token, 'new-token')
})
await test('a vault read failure never turns into an empty account list or overwrites saved credentials', async () => {
  let writes = 0
  const ctx = { api: { self: async () => ({ id: 'me', name: 'Me' }) }, storage: {
    load: async name => { if (name === 'accounts') throw new Error('安全存储不可用'); return {} },
    save: async () => { writes++ }, setAccount() {} },
    on() {}, emit() {}, get(name) { return this[name] }, set(name, value) { this[name] = value }, inject() {} }
  globalThis.window = { __TAURI__: { core: { invoke() {} } } }
  globalThis.localStorage = { getItem: () => null, removeItem() {} }
  mod.authPlugin.apply(ctx)
  await assert.rejects(ctx.auth.loadAccounts(), /安全存储不可用/)
  await assert.rejects(ctx.auth.loginWithToken('new-token'), /安全存储不可用/)
  assert.equal(writes, 0)
})
await test('manual quick instructions and draft revisions apply once without sending or changing memory and prompts', async () => {
  const h = fixture()
  try {
    await waitFor(() => h.ctx.userbot.state.ready)
    h.ctx.userbot.state.config.conversations['1:friend'].mode = 'manual'
    const before = JSON.stringify(h.ctx.userbot.state.config)
    const first = h.ctx.userbot.runManual({ id: 'friend', type: 1 }, { instruction: '只回复两句话', previousDraft: '尚未发送的长草稿' })
    await waitFor(() => h.pending.length === 1)
    const payload = JSON.parse(h.pending[0].opts.body).payload
    assert.match(payload.messages[0].content, /本次快捷指令[\s\S]*只回复两句话/)
    assert.ok(payload.messages.some(x => x.role === 'assistant' && x.content.includes('尚未发送的长草稿')))
    h.pending[0].resolve('改好的草稿'); assert.equal(await first, '改好的草稿')
    assert.equal(h.sent.length, 0); assert.equal(JSON.stringify(h.ctx.userbot.state.config), before)
    const second = h.ctx.userbot.runManual({ id: 'friend', type: 1 })
    await waitFor(() => h.pending.length === 2)
    assert.doesNotMatch(JSON.parse(h.pending[1].opts.body).payload.messages.map(x => x.content).join('\n'), /只回复两句话|尚未发送的长草稿/)
    h.pending[1].resolve('普通草稿'); await second
    await assert.rejects(h.ctx.userbot.runManual({ id: 'friend', type: 1 }, { instruction: '长'.repeat(4001) }), /4000/)
  } finally { h.dispose() }
})
await test('floating reply generation cannot run group actions, including generation without a custom instruction', async () => {
  const h = fixture(); let scopes = 0
  try {
    await waitFor(() => h.ctx.userbot.state.ready)
    const cfg = h.ctx.userbot.state.config
    cfg.bots[0].allowed.push('2:group'); cfg.bots[0].management = { enabled: true, requireConfirmation: false, allowed: ['mute'] }
    cfg.conversations['2:group'] = { ...cfg.conversations['1:friend'], mode: 'manual' }
    h.ctx.api.groupInfo = async () => { scopes++; return { owner: 'me', admins: [] } }
    const pending = h.ctx.userbot.runManual({ id: 'group', type: 2 }, { instruction: '', replyOnly: true })
    const rejection = assert.rejects(pending, /未获得群管理权限/)
    await waitFor(() => h.pending.length === 1)
    h.pending[0].resolve(JSON.stringify({ format: 'text', content: '提议', actions: [{ type: 'mute', userId: 'other', seconds: 600, reason: 'test' }] }))
    await rejection; assert.equal(scopes, 0); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('bridge requires its per-process capability, sends correct headers, and redacts keys in provider errors', async () => {
  const oldFetch = realFetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response(JSON.stringify({ error: { message: 'bad fake-secret' } }), { status: 401 }) }
  const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://localhost'); if (u.pathname === '/proof') mod.handleAiProof(req, res, 'capability', u.searchParams.get('nonce') || ''); else void mod.handleAiBridge(req, res, 'capability') })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const address = `http://127.0.0.1:${server.address().port}`
    const body = JSON.stringify({ url: 'https://api.example/v1/messages', format: 'anthropic', method: 'POST', key: 'fake-secret', payload: { model: 'm' } })
    const nonce = 'a'.repeat(64)
    const proof = await oldFetch(address + '/proof?nonce=' + nonce)
    assert.equal(await proof.text(), createHash('sha256').update(nonce + 'capability').digest('hex'))
    const invalidProof = await oldFetch(address + '/proof?nonce=bad'); assert.equal(invalidProof.status, 403)
    const denied = await oldFetch(address, { method: 'POST', body }); assert.equal(denied.status, 403); assert.equal(calls.length, 0)
    const response = await oldFetch(address, { method: 'POST', body, headers: { 'x-yh-bot-capability': 'capability' } })
    const json = await response.json(); assert.equal(json.status, 401); assert.doesNotMatch(JSON.stringify(json), /fake-secret/)
    assert.equal(calls[0].options.headers['x-api-key'], 'fake-secret'); assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01'); assert.equal(calls[0].options.redirect, 'error')
  } finally { await new Promise(r => server.close(r)); globalThis.fetch = oldFetch }
})

await test('AI can be disabled globally or per conversation; fixed replies run without a service or provider request', async () => {
  for (const level of ['bot', 'conversation']) {
    const h = fixture(); try {
      await waitFor(() => h.ctx.userbot.state.ready)
      const cfg = h.ctx.userbot.state.config, setting = cfg.conversations['1:friend']
      if (level === 'bot') cfg.bots[0].useAI = false; else setting.useAI = false
      setting.automationText = '你好 {name}：{text}'; cfg.services = []
      h.ctx.emit('message-created', msg('no-ai-' + level, '测试'))
      await waitFor(() => h.sent.length === 1)
      assert.equal(h.pending.length, 0)
      assert.equal(mod.renderElements(h.sent[0].content).content.text, '你好 Other：测试')
      assert.match(h.ctx.userbot.statusFor({ id: 'friend', type: 1 }), /规则自动化/)
    } finally { h.dispose() }
  }
})
await test('rule moderation uses the review queue and execution checks without calling AI', async () => {
  const h = await groupFixture(); try {
    const cfg = h.ctx.userbot.state.config, setting = cfg.conversations['2:group']
    cfg.bots[0].useAI = false; cfg.services = []; setting.automationAction = 'mute'
    h.ctx.emit('message-created', msg('rule-mute', '违规示例', 2, 'group'))
    await waitFor(() => h.ctx.userbot.state.review)
    assert.equal(h.pending.length, 0); assert.equal(h.calls.length, 0)
    h.ctx.userbot.resolveReview(h.ctx.userbot.state.review.id, true)
    await waitFor(() => h.calls.length === 1)
    assert.deepEqual(h.calls[0], ['gagMember', 'group', 'other', 600])
  } finally { h.dispose() }
})
await test('conversation mode rejects management actions; management quick instructions can propose them', async () => {
  const h = await groupFixture(); try {
    h.ctx.userbot.setWorkMode({ id: 'group', type: 2 }, 'conversation')
    const blocked = h.ctx.userbot.runManual({ id: 'group', type: 2 }, { instruction: '禁言 other' })
    await waitFor(() => h.pending.length === 1)
    assert.doesNotMatch(JSON.parse(h.pending[0].opts.body).payload.messages[0].content, /群管理输出协议/)
    h.pending[0].resolve(JSON.stringify({ format: 'text', content: '', actions: [muteAction()] }))
    await assert.rejects(blocked, /未获得群管理权限/)
    assert.equal(h.calls.length, 0)
    h.ctx.userbot.setWorkMode({ id: 'group', type: 2 }, 'management')
    const approved = h.ctx.userbot.runManual({ id: 'group', type: 2 }, { instruction: '禁言 other 十分钟' })
    await waitFor(() => h.pending.length === 2)
    const system = JSON.parse(h.pending[1].opts.body).payload.messages[0].content
    assert.match(system, /管理模式/); assert.match(system, /群管理输出协议/); assert.match(system, /本次快捷指令/)
    h.pending[1].resolve(JSON.stringify({ format: 'text', content: '', actions: [muteAction()] }))
    await waitFor(() => h.ctx.userbot.state.review)
    h.ctx.userbot.resolveReview(h.ctx.userbot.state.review.id, true)
    await approved; assert.equal(h.calls.length, 1); assert.equal(h.sent.length, 0)
  } finally { h.dispose() }
})
await test('merged no-AI events each execute once in arrival order instead of discarding earlier matches', async () => {
  const h = fixture(); try {
    await waitFor(() => h.ctx.userbot.state.ready)
    const cfg=h.ctx.userbot.state.config; cfg.bots[0].useAI=false; cfg.conversations['1:friend'].automationText='{text}'
    for(let i=0;i<3;i++) h.ctx.emit('message-created',msg('rule-order-'+i,'内容'+i))
    await waitFor(()=>h.sent.length===3)
    assert.deepEqual(h.sent.map(x=>mod.renderElements(x.content).content.text),['内容0','内容1','内容2'])
    assert.equal(h.pending.length,0)
  } finally { h.dispose() }
})

await test('recall falls back to the scoped recent list when positioning omits an existing message', async () => {
  const h = await groupFixture({ review: false }); try {
    h.ctx.api.messagesAround = async () => [{ id: 'neighbour', senderId: 'other' }]
    h.ctx.api.messages = async (gid, type) => { assert.equal(gid, 'group'); assert.equal(type, 2); return [{ id: 'target-message', senderId: 'other', content: { text: 'still present' } }] }
    await h.propose([{ type: 'recall', messageId: 'target-message', reason: 'test' }]); await waitFor(() => h.calls.length === 1)
    assert.deepEqual(h.calls[0], ['recall', 'group', 2, 'target-message'])
  } finally { h.dispose() }
})
await test('recall passes the real sequence of an older loaded message, then rechecks after review', async () => {
  const h = await groupFixture(); try {
    h.ctx.chat.state.current = { id: 'group', type: 2 }
    h.ctx.chat.state.messages = [{ id: 'target-message', seq: 12345, senderId: 'other', content: { text: 'older' } }]
    const calls=[]
    h.ctx.api.messagesAround = async (gid, type, mid, count, seq) => { calls.push(seq); return seq === 12345 ? [{ id: mid, senderId: 'other', content: { text: 'older' } }] : [] }
    await h.propose([{ type: 'recall', messageId: 'target-message', reason: 'test' }]); await waitFor(() => !!h.ctx.userbot.state.review)
    h.ctx.userbot.resolveReview(h.ctx.userbot.state.review.id, true)
    await waitFor(() => h.calls.length === 1)
    assert.deepEqual(calls, [12345, 12345])
  } finally { h.dispose() }
})
await test('a missing lookup target is not labelled recalled and never executes from a local cache alone', async () => {
  const h = await groupFixture({ review: false }); try {
    h.ctx.api.messagesAround = async () => []; h.ctx.api.messages = async () => []
    h.ctx.chat.state.current = { id: 'group', type: 2 }; h.ctx.chat.state.messages = [{ id: 'target-message', seq: 7, senderId: 'other', content: { text: 'local only' } }]
    await h.propose([{ type: 'recall', messageId: 'target-message', reason: 'test' }]); await sleep(50)
    assert.equal(h.calls.length, 0)
    assert.ok(h.ctx.userbot.state.logs.some(l => JSON.stringify(l).includes('未能从本群消息接口定位')))
  } finally { h.dispose() }
})
