import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRecallCache, hasRecallBody } from '../src/core/recall-cache.ts'
import { showMessage, showRetainedRecall } from '../src/core/recall-display.ts'

const channel = (id = 'room', type = 2) => ({ id, type })
const original = (id, text = '保留的原文') => ({ id, ts: Date.now(), type: 1, sender: 'A', content: { text }, elements: [{ type: 'text', attrs: { content: text }, children: [] }] })
const tombstone = id => ({ id, recalled: true, content: { text: '', image_url: '', _raw: { 1: [] } }, elements: [{ type: 'text', attrs: { content: '' }, children: [] }] })
const turn = () => new Promise(resolve => setImmediate(resolve))
function setup(initial = {}) {
  let saved = initial
  let enabled = true, owner = 'me'
  const storage = { load: async () => saved, save: async (_name, value) => { saved = structuredClone(value) } }
  const cache = createRecallCache(storage, () => owner, () => enabled)
  return { cache, saved: () => saved, enable: value => { enabled = value }, owner: value => { owner = value } }
}

test('empty protobuf shells and empty parsed elements are not message bodies', () => {
  assert.equal(hasRecallBody(tombstone('x')), false)
  assert.equal(hasRecallBody({ content: { image_url: 'key.png', _raw: {} } }), true)
  assert.equal(hasRecallBody({ elements: [{ type: 'video', attrs: { src: 'movie.mp4' }, children: [] }] }), true)
  assert.equal(hasRecallBody({ content: { quote_msg_text: 'only a quote', file_name: 'no-url' } }), false)
})

test('only a real retained body gets a retained label and an unmatched recall is hidden', () => {
  const blank = { ...tombstone('empty'), retainedRecall: true }
  const saved = { ...original('saved'), recalled: true, retainedRecall: true, cachedAt: Date.now() }
  assert.equal(showRetainedRecall(blank, true), false)
  assert.equal(showMessage(blank, true), false)
  assert.equal(showRetainedRecall(saved, true), true)
  assert.equal(showMessage(saved, true), true)
  assert.equal(showMessage({ ...saved, cachedAt: Date.now() - 7 * 86400000 - 1 }, true), false)
  assert.equal(showMessage(blank, false), true)
  assert.equal(showMessage(original('normal'), true), true)
})

test('a recall only restores a recorded original from the exact account and channel', async () => {
  const h = setup(); await h.cache.ready()
  h.cache.merge(channel(), original('old'), false)
  assert.equal(h.cache.merge(channel(), tombstone('old')).retainedRecall, false)
  h.cache.merge(channel(), original('new'), true)
  assert.equal(h.cache.merge(channel('another'), tombstone('new')).retainedRecall, false)
  assert.equal(h.cache.merge(channel('room', 1), tombstone('new')).retainedRecall, false)
  const restored = h.cache.merge(channel(), tombstone('new'))
  assert.equal(restored.retainedRecall, true)
  assert.equal(restored.content.text, '保留的原文')
  assert.equal(restored.elements[0].attrs.content, '保留的原文')
  h.owner('other')
  assert.equal(h.cache.merge(channel(), tombstone('new')).retainedRecall, false)
  h.owner('me'); h.cache.dispose(); await turn()
  assert.equal(h.saved().messages['me:2:room:new'].recalled, true)
})

test('metadata-only recall cannot create a fake cache hit, even on repeated polling', async () => {
  const h = setup(); await h.cache.ready()
  for (let i = 0; i < 3; i++) assert.equal(h.cache.merge(channel(), tombstone('missing'), true).retainedRecall, false)
  h.cache.dispose(); await turn()
  assert.deepEqual(h.saved().messages, {})
})

test('media references and protobuf bigint metadata can be retained without serialization errors', async () => {
  const h = setup(); await h.cache.ready()
  h.cache.merge(channel(), { id: 'video', ts: Date.now(), type: 10, content: { video_url: 'v.mp4', _raw: { 20: [7n] } }, elements: [] }, true)
  const restored = h.cache.merge(channel(), tombstone('video'))
  assert.equal(restored.retainedRecall, true)
  assert.equal(restored.content.video_url, 'v.mp4')
  h.cache.dispose(); await turn()
  assert.equal(h.saved().messages['me:2:room:video'].content._raw, undefined)
})

test('expired or invalid persisted records are never displayed as local originals', async () => {
  const old = { ...original('old'), cachedAt: Date.now() - 7 * 86400000 - 1, recalled: true }
  const blank = { ...tombstone('blank'), cachedAt: Date.now(), recalled: true }
  const h = setup({ messages: { 'me:2:room:old': old, 'me:2:room:blank': blank } })
  await h.cache.ready()
  assert.equal(h.cache.merge(channel(), tombstone('old')).retainedRecall, false)
  assert.equal(h.cache.merge(channel(), tombstone('blank')).retainedRecall, false)
  assert.deepEqual(h.cache.recalled(channel(), 0), [])
  h.cache.dispose(); await turn()
})

test('stored count is capped at 2000 and older records are evicted', async () => {
  const h = setup(); await h.cache.ready()
  const realNow = Date.now; let now = realNow()
  try {
    Date.now = () => now++
    for (let i = 0; i < 2001; i++) h.cache.merge(channel(), original(String(i)), true)
    assert.equal(h.cache.merge(channel(), tombstone('0')).retainedRecall, false)
    assert.equal(h.cache.merge(channel(), tombstone('2000')).retainedRecall, true)
    h.cache.dispose(); await turn()
    assert.equal(Object.keys(h.saved().messages).length, 2000)
  } finally { Date.now = realNow }
})

test('clearing the cache prevents later recall from restoring prior content', async () => {
  const h = setup(); await h.cache.ready()
  h.cache.merge(channel(), original('one'), true)
  await h.cache.clear()
  assert.equal(h.cache.merge(channel(), tombstone('one')).retainedRecall, false)
  assert.deepEqual(h.saved().messages, {})
  h.cache.dispose(); await turn()
})

test('logout/reset cannot resurrect a pending asynchronous save', async () => {
  let resolveLoad, writes = 0, owner = 'me'
  const cache = createRecallCache({ load: () => new Promise(resolve => { resolveLoad = resolve }), save: async () => { writes++ } }, () => owner, () => true)
  cache.merge(channel(), original('pending'), true)
  cache.dispose()
  cache.reset(); owner = ''
  resolveLoad({}); await turn()
  assert.equal(writes, 0)
})

test('a delayed storage load preserves an earlier recalled record against a replay', async () => {
  let resolveLoad
  const old = { ...original('one', '已保存'), cachedAt: Date.now() - 100, recalled: true }
  const cache = createRecallCache({ load: () => new Promise(resolve => { resolveLoad = resolve }), save: async () => {} }, () => 'me', () => true)
  const ready = cache.ready()
  cache.merge(channel(), original('one', '重放消息'), true)
  resolveLoad({ messages: { 'me:2:room:one': old } }); await ready
  const result = cache.merge(channel(), original('one', '服务器旧数据'))
  assert.equal(result.retainedRecall, true)
  assert.equal(result.content.text, '已保存')
  cache.dispose(); await turn()
})
