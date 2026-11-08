/** A parsed empty element or a protobuf metadata shell is not a saved message body. */
export function hasRecallBody(message: any): boolean {
  const meaningful = (value: any): boolean => {
    if (typeof value === 'string') return value.length > 0
    if (Array.isArray(value)) return value.some(meaningful)
    if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => k !== '_raw' && meaningful(v))
    return typeof value === 'number' ? value !== 0 : value === true
  }
  const content = message?.content || {}
  if (['text', 'image_url', 'image', 'sticker_url', 'video_url', 'video', 'audio_url', 'audio',
    'file_url', 'form', 'post_id', 'post_title', 'post_content', 'tip', 'call_status_text']
    .some(key => meaningful(content[key]))) return true
  const elementBody = (el: any): boolean => {
    const attrs = el?.attrs || {}
    const fields: Record<string, string[]> = {
      text: ['content'], markdown: ['content'], html: ['content'], tip: ['content'], call: ['content'],
      img: ['src'], sticker: ['src', 'imageUrl'], video: ['src'], audio: ['src'], file: ['src'],
      a2ui: ['data'], form: ['data'], post: ['title', 'content', 'id'],
      at: ['id', 'name'], a: ['href'], button: ['text'],
    }
    return (fields[el?.type] || []).some(key => meaningful(attrs[key])) ||
      (Array.isArray(el?.children) && el.children.some(elementBody))
  }
  return Array.isArray(message?.elements) && message.elements.some(elementBody)
}

/** Only received originals are retained. Matching is scoped by account, channel and message ID. */
export function createRecallCache(storage: any, accountId: () => string, enabled: () => boolean) {
  const maxAge = 7 * 86400000
  const maxCount = 2000
  let data: Record<string, any> = {}
  let loaded: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  const prefix = (channel: any) => `${accountId()}:${channel.type}:${channel.id}:`
  const key = (channel: any, id: string) => prefix(channel) + id
  const valid = (m: any) => Number.isFinite(Number(m?.cachedAt)) && Number(m.cachedAt) > Date.now() - maxAge && hasRecallBody(m)
  function prune() {
    const entries = Object.entries(data).filter(([, m]) => valid(m))
      .sort((a, b) => Number(b[1].cachedAt) - Number(a[1].cachedAt)).slice(0, maxCount)
    data = Object.fromEntries(entries)
  }
  async function ready() {
    if (!loaded) {
      const version = generation
      loaded = Promise.resolve(storage.load('recall')).then(value => {
        if (version === generation) {
          const stored = value?.messages || {}
          const pending = data
          data = { ...stored, ...pending }
          // A replay received before storage finishes loading must not undo a prior recall.
          for (const [k, m] of Object.entries(stored) as Array<[string, any]>) {
            if (m?.recalled && valid(m)) data[k] = m
          }
          prune()
        }
      }).catch(() => {})
    }
    await loaded
  }
  function scheduleSave() {
    clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void flush() }, 500)
  }
  async function flush() {
    const version = generation
    await ready()
    if (version !== generation || !accountId()) return
    prune()
    await storage.save('recall', { messages: data }).catch(() => {})
  }
  function merge(channel: any, incoming: any, capture = false) {
    if (!enabled() || !accountId() || !channel?.id || !incoming?.id) return incoming
    const cacheKey = key(channel, String(incoming.id))
    let saved = data[cacheKey]
    if (saved && !valid(saved)) { delete data[cacheKey]; saved = undefined }
    if (incoming.recalled || saved?.recalled) {
      // A recall event is only evidence of deletion, never evidence of an original body.
      if (!saved) return { ...incoming, recalled: true, retainedRecall: false }
      if (!saved.recalled) { saved = data[cacheKey] = { ...saved, recalled: true }; scheduleSave() }
      return { ...incoming, ...saved, recalled: true, retainedRecall: true }
    }
    if (capture && hasRecallBody(incoming)) {
      const { id, senderId, sender, avatar, tags, type, content, elements, ts, right, quoteId, seq, edited } = incoming
      data[cacheKey] = JSON.parse(JSON.stringify({ id, senderId, sender, avatar, tags, type, content,
        elements, ts, right, quoteId, seq, edited, recalled: false, cachedAt: saved?.cachedAt || Date.now() },
        (k, value) => k === '_raw' ? undefined : typeof value === 'bigint' ? value.toString() : value))
      if (Object.keys(data).length > maxCount) prune()
      scheduleSave()
    }
    return { ...incoming, retainedRecall: false }
  }
  return {
    ready, merge,
    recalled(channel: any, since: number) {
      if (!enabled() || !accountId()) return []
      const channelPrefix = prefix(channel)
      return Object.entries(data).filter(([k, m]) => k.startsWith(channelPrefix) && m.recalled && m.ts >= since && valid(m))
        .map(([, m]) => ({ ...m, retainedRecall: true }))
    },
    async clear() {
      clearTimeout(timer); timer = undefined
      const version = generation
      await ready()
      if (version !== generation || !accountId()) return
      for (const k of Object.keys(data)) if (k.startsWith(accountId() + ':')) delete data[k]
      await flush()
    },
    reset() { generation++; clearTimeout(timer); timer = undefined; data = {}; loaded = undefined },
    dispose() { clearTimeout(timer); timer = undefined; if (accountId()) void flush() },
  }
}
