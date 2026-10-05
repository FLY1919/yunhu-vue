/**
 * A2UI v0.9 渲染器
 * ------------------------------------------------------------------
 * 云湖把 A2UI 消息(content_type=14)放在 MsgContent.text 里，形如：
 *
 * ```json
 * {"version":"v0.9","createSurface":{"surfaceId":"xxx","catalogId":"…basic_catalog.json"}}
 * ```
 * ```json
 * {"version":"v0.9","updateComponents":{"surfaceId":"xxx","components":[
 *    {"id":"root","component":"Column","children":["player"]},
 *    {"id":"player","component":"AudioPlayer","url":"…","description":"…"}
 * ]}}
 * ```
 *
 * 要点：
 *   · 消息类型：createSurface / updateComponents / updateDataModel / beginRendering / deleteSurface
 *   · 组件是「扁平」的：{ id, component: "Column", ...props }（不是 {Column:{…}}）
 *   · 属性值可以是字面量，也可以是数据绑定 { path: "/a/b" }
 *   · 有些机器人会直接把 HTML 塞进 type=14，需要兜底
 */

export interface A2uiComponent {
  id: string
  component: string
  [key: string]: any
}
export interface A2uiSurface {
  id: string
  root: string | null
  components: Map<string, A2uiComponent>
  data: Record<string, any>
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g

/** 从文本里抠出所有「花括号配对」的片段（用于处理没有围栏、还带前后说明的 JSON） */
function balancedJsonBlocks(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          out.push(text.slice(i, j + 1))
          i = j
          break
        }
      }
    }
  }
  return out
}


/** 从消息文本里提取 A2UI 消息数组（兼容纯 JSON 行） */
export function extractA2uiMessages(text: string): any[] {
  const out: any[] = []
  if (!text) return out
  const push = (raw: string) => {
    const whole = String(raw || '').trim()
    if (!whole) return
    /*
     * ⚠️ 这里是「A2UI 卡片没渲染出组件/按钮」的真凶：
     *   原来是**逐行** parse，而机器人发过来的 JSON 大多是多行美化过的，
     *   于是每一行都不是合法 JSON → 一条都解不出来 → 整块退化成纯文本。
     * 正确做法：先整体当一个 JSON 解，失败再退回逐行（兼容真正一行一条的）。
     */
    try {
      const j0 = JSON.parse(whole)
      if (Array.isArray(j0)) out.push(...j0)
      else out.push(j0)
      return
    } catch { /* 整体不是单个 JSON，继续尝试逐行 */ }
    for (const line of whole.split('\n')) {
      const t = line.trim()
      if (!t || (t[0] !== '{' && t[0] !== '[')) continue
      try {
        const j = JSON.parse(t)
        if (Array.isArray(j)) out.push(...j)
        else out.push(j)
      } catch { /* 这一行不是 JSON，跳过 */ }
    }
    // 最后再试：文本里「夹着」一段多行 JSON（既没有围栏、又带前后说明文字）
    //   靠花括号配对把候选块抠出来逐个试。
    for (const block of balancedJsonBlocks(whole)) {
      try {
        const j = JSON.parse(block)
        if (Array.isArray(j)) out.push(...j)
        else out.push(j)
      } catch { /* 抠出来的不是合法 JSON，跳过 */ }
    }
  }
  let m: RegExpExecArray | null
  let matched = false
  FENCE_RE.lastIndex = 0
  while ((m = FENCE_RE.exec(text))) { matched = true; push(m[1]) }
  if (!matched) push(text)
  // 只要带 version 或已知消息类型才算 A2UI
  return out.filter(j => j && typeof j === 'object' && (
    j.createSurface || j.updateComponents || j.updateDataModel ||
    j.beginRendering || j.deleteSurface || j.version
  ))
}

/** 解析成 surfaces */
export function parseA2ui(input: any): A2uiSurface[] | null {
  if (!input) return null
  let messages: any[] = []
  if (typeof input === 'string') messages = extractA2uiMessages(input)
  else if (Array.isArray(input)) messages = input
  else messages = [input]
  if (!messages.length) return null

  const surfaces = new Map<string, A2uiSurface>()
  const get = (id: string) => {
    if (!surfaces.has(id)) surfaces.set(id, { id, root: null, components: new Map(), data: {} })
    return surfaces.get(id)!
  }

  for (const msg of messages) {
    /* ⚠️ 这里原来是 if / else-if 链：真实 A2UI 消息**同时**带 createSurface 和 updateComponents，
       于是 updateComponents 被跳过 → 该 surface 组件数为 0 → 整体判定不是 A2UI → 退化成纯文本，
       表现就是「卡片里没有组件、没有按钮」。必须各判各的。 */
    if (msg.createSurface) {
      const sid = typeof msg.createSurface === 'string' ? msg.createSurface : msg.createSurface?.surfaceId
      if (sid) get(sid)
    }
    if (msg.updateComponents) {
      const { surfaceId, components = [] } = msg.updateComponents
      const s = get(surfaceId)
      for (const c of components) {
        if (!c || !c.id) continue
        s.components.set(c.id, c)
        // 组件挂载顺序里第一个通常就是 root
        if (!s.root) s.root = c.id === 'root' ? 'root' : s.root
      }
      if (!s.root) s.root = 'root'
    }
    if (msg.updateDataModel) {
      const { surfaceId, contents } = msg.updateDataModel
      const s = get(surfaceId)
      applyData(s.data, contents)
    } else if (msg.beginRendering) {
      const s = get(msg.beginRendering.surfaceId)
      s.root = msg.beginRendering.root || s.root
    } else if (msg.deleteSurface) {
      surfaces.delete(msg.deleteSurface.surfaceId)
    }
  }

  const out = [...surfaces.values()].filter(s => s.components.size)
  if (!out.length) return null
  for (const s of out) if (!s.root || !s.components.has(s.root)) s.root = s.components.has('root') ? 'root' : [...s.components.keys()][0]
  return out
}

function applyData(target: Record<string, any>, contents: any) {
  if (!contents) return
  const walk = (arr: any[], base: Record<string, any>) => {
    if (!Array.isArray(arr)) return
    for (const item of arr) {
      if (!item || item.key === undefined) continue
      if (item.valueMap) { base[item.key] = {}; walk(item.valueMap, base[item.key]) }
      else if (item.valueString !== undefined) base[item.key] = item.valueString
      else if (item.valueNumber !== undefined) base[item.key] = item.valueNumber
      else if (item.valueBoolean !== undefined) base[item.key] = item.valueBoolean
      else base[item.key] = item.value ?? ''
    }
  }
  if (Array.isArray(contents)) walk(contents, target)
  else if (typeof contents === 'object') Object.assign(target, contents)
}

/** 解析属性值：字面量 / {path} / {literalString…} */
export function resolveValue(v: any, data: Record<string, any>): any {
  if (v === null || v === undefined) return undefined
  if (typeof v !== 'object') return v
  if (Array.isArray(v)) return v
  if ('literalString' in v) return v.literalString
  if ('literalNumber' in v) return v.literalNumber
  if ('literalBoolean' in v) return v.literalBoolean
  if ('literalArray' in v) return v.literalArray
  if ('path' in v) return getPath(data, v.path)
  if ('value' in v) return v.value
  return undefined
}

export function getPath(data: Record<string, any>, path: string): any {
  if (!path) return undefined
  const parts = String(path).split('/').filter(Boolean)
  let cur: any = data
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

/** 看起来像 HTML 片段（有些机器人直接往 type=14 塞 HTML） */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(\w+)(\s|>)/.test(String(text || ''))
}

/**
 * 把 A2UI 内容还原成「可展示」的东西：
 *   { kind: 'a2ui', surfaces } | { kind: 'html', html } | { kind: 'text', text } | null
 */
export function analyzeA2ui(raw: any):
  | { kind: 'a2ui'; surfaces: A2uiSurface[]; rest: string }
  | { kind: 'html'; html: string }
  | { kind: 'text'; text: string }
  | null {
  if (raw === null || raw === undefined || raw === '') return null
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const surfaces = parseA2ui(text)
  if (surfaces) {
    // 去掉承载 A2UI 的部分：
    //   1) 有 json 围栏的，整块删掉
    //   2) 整段本身就是一条 JSON（没有围栏）的，也别把原文再渲染一遍
    const wholeIsJson = (() => {
      try { const j = JSON.parse(text.trim()); return j && typeof j === 'object' } catch { return false }
    })()
    let rest = wholeIsJson ? '' : text
      .replace(/```(?:json)?\s*[\s\S]*?```/g, (block) => (extractA2uiMessages(block).length ? '' : block))
    if (!wholeIsJson) {
      // 再把「无围栏」的 A2UI JSON 块也从正文里抠掉，避免卡片后面还跟着一坨原文
      for (const blk of balancedJsonBlocks(rest)) {
        if (extractA2uiMessages(blk).length) rest = rest.replace(blk, '')
      }
    }
    rest = rest.trim()
    return { kind: 'a2ui', surfaces, rest }
  }
  if (looksLikeHtml(text)) return { kind: 'html', html: text }
  // 注意：很多机器人把「普通 markdown 文本」也当 type=14 发，这里必须按 markdown 渲染，
  // 否则用户看到的就是一坨没渲染的原文
  return { kind: 'text', text }
}
