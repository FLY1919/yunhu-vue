/**
 * Satori 风格消息元素
 * ------------------------------------------------------------------
 * 一条消息 = Element[]（元素树），插件只跟元素打交道，
 * 具体平台（云湖）的 content_type / protobuf 细节由适配器负责转换。
 *
 *   h.text('hi')                    文本
 *   h.image('https://…')            图片
 *   h.at('123456', '昵称')          @某人
 *   h.a('https://…', [h.text('链接')]) 链接
 *   h.markdown('# 标题')            Markdown（云湖扩展）
 *   h.html('<b>x</b>')              HTML（云湖扩展）
 *   h.sticker(url, itemId, packId)  表情
 *   h.file(url, name, size)         文件
 *   h.audio(url, time) / h.video(url)
 *   h.a2ui(json)                    A2UI（云湖扩展）
 *   h.br()  h.quote(msgId)
 */

export interface Attrs { [key: string]: any }
export interface Element { type: string; attrs: Attrs; children: Element[] }
export type Child = Element | string | number | boolean | null | undefined

export const ELEMENT_TYPES = [
  // 通用（Satori 标准）
  'text', 'at', 'a', 'img', 'audio', 'video', 'file', 'br', 'p', 'b', 'i', 'u', 's',
  'code', 'pre', 'quote', 'button',
  // 云湖扩展
  'markdown', 'html', 'sticker', 'a2ui', 'form', 'post', 'tip', 'call', 'unknown',
] as const
export type ElementType = (typeof ELEMENT_TYPES)[number]

function normalizeChild(c: Child): Element {
  if (c === null || c === undefined || typeof c === 'boolean') return h.text('')
  if (typeof c === 'string' || typeof c === 'number') return h.text(String(c))
  return c
}

const _h = (type: string, attrs: Attrs = {}, children: Child[] = []): Element => ({
  type,
  attrs,
  children: children.map(normalizeChild),
})

export const h = Object.assign(_h, {
  text: (content: string | number): Element => h('text', { content: String(content ?? '') }),
  at: (id: string, name = ''): Element => h('at', { id, name }),
  a: (href: string, children: Child[] = []): Element => h('a', { href }, children),
  img: (src: string, attrs: Attrs = {}): Element => h('img', { src, ...attrs }),
  image: (src: string, attrs: Attrs = {}): Element => h('img', { src, ...attrs }),
  audio: (src: string, time = 0): Element => h('audio', { src, time }),
  video: (src: string, time = 0): Element => h('video', { src, time }),
  file: (src: string, name = '', size = 0): Element => h('file', { src, name, size }),
  br: (): Element => h('br'),
  b: (children: Child[] = []): Element => h('b', {}, children),
  code: (content: string, lang = ''): Element => h('code', { content, lang }),
  pre: (content: string, lang = ''): Element => h('pre', { content, lang }),
  markdown: (content: string): Element => h('markdown', { content }),
  html: (content: string): Element => h('html', { content }),
  sticker: (src: string, itemId = 0, packId = 0, expressionId = 0, width = 0, height = 0, imageUrl = ''): Element => h('sticker', { src, itemId, packId, expressionId, width, height, imageUrl }),
  a2ui: (data: any): Element => h('a2ui', { data }),
  form: (data: any): Element => h('form', { data }),
  post: (title: string, content = '', id = ''): Element => h('post', { title, content, id }),
  tip: (content: string): Element => h('tip', { content }),
  call: (content: string): Element => h('call', { content }),
})

/* =====================  与云湖的互转  ===================== */

/** 云湖 content_type 枚举 */
export const ContentType = {
  text: 1, image: 2, markdown: 3, file: 4, form: 5, post: 6,
  sticker: 7, html: 8, tip: 9, video: 10, audio: 11, call: 13, a2ui: 14,
} as const

/** 云湖消息 -> 元素树 */
export function parse(content: any = {}, contentType: number = ContentType.text, quote?: any): Element[] {
  const out: Element[] = []
  switch (contentType) {
    case ContentType.text: out.push(h.text(content.text ?? '')); break
    case ContentType.markdown: out.push(h.markdown(content.text ?? '')); break
    case ContentType.html: out.push(h.html(content.text ?? '')); break
    case ContentType.image: out.push(h.img(content.image_url || content.image || '', { width: content.width, height: content.height })); break
    // 表情：content.image 往往是相对 key，优先用带域名的 image_url
    case ContentType.sticker: out.push(h.sticker(content.image || content.image_url || '', content.sticker_item_id, content.sticker_pack_id, content.expression_id, content.width, content.height, content.image_url)); break
    case ContentType.file: out.push(h.file(content.file_url, content.file_name, content.file_size)); break
    case ContentType.video: out.push(h('video', { src: content.video_url || content.video, time: content.video_time, name: content.file_name, size: content.file_size, width: content.width, height: content.height })); break
    case ContentType.audio: out.push(h.audio(content.audio_url, content.audio_time)); break
    case ContentType.call: out.push(h.call(content.call_status_text || '')); break
    case ContentType.tip: out.push(h.tip(content.tip || content.text || '')); break
    case ContentType.form: out.push(h.form(content.form)); break
    case ContentType.post: out.push(h.post(content.post_title, content.post_content, content.post_id)); break
    case ContentType.a2ui: out.push(h.a2ui(content.text ?? content.form ?? '')); break
    default: out.push(h('unknown', { contentType, content }))
  }
  const el = out[0]
  // 云湖 buttons 是二维数组：每个子数组是一行，不能把数组转成 "[object Object]"。
  if (content.buttons) {
    let raw: any = content.buttons
    try {
      if (typeof raw === 'string') raw = JSON.parse(raw)
    } catch {
      raw = String(content.buttons).split('\n').filter(Boolean)
    }
    const values: any[] = Array.isArray(raw) ? raw : []
    const rows: any[][] = values.some(Array.isArray) ? values.map(row => Array.isArray(row) ? row : [row]) : [values]
    const str = (v: any) => typeof v === 'string' || typeof v === 'number' ? String(v) : ''
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (const item of rows[rowIndex]) {
        const b = item && typeof item === 'object' && !Array.isArray(item) ? item : { text: str(item) }
        const label = str(b.text) || str(b.label) || str(b.name)
        if (!label || label.includes('[object Object]')) continue
        const action = b.actionType ?? b.action_type
        out.push(h('button', {
          text: label, id: str(b.id ?? b.buttonId ?? b.button_id), value: str(b.value),
          url: str(b.url), actionType: action === undefined || action === null ? null : Number(action), rowIndex,
        }))
      }
    }
  }
  if (el && quote) el.attrs = { ...el.attrs, quote }
  return out
}

/** 元素树 -> 纯文本（用于预览、日志、检索） */
export function toText(elements: Element[] = []): string {
  return elements.map(el => {
    switch (el.type) {
      case 'text': return el.attrs.content ?? ''
      case 'markdown': case 'html': return el.attrs.content ?? ''
      case 'at': return `@${el.attrs.name || el.attrs.id}`
      case 'a': return toText(el.children) || el.attrs.href || ''
      case 'img': return '[图片]'
      case 'audio': return '[语音]'
      case 'video': return '[视频]'
      case 'file': return el.attrs.name || el.attrs.src || ''
      case 'sticker': return '[表情]'
      case 'br': return '\n'
      case 'tip': return el.attrs.content || ''
      case 'call': return el.attrs.content || ''
      case 'a2ui': return '[A2UI]'
      case 'post': return el.attrs.title || ''
      default: return toText(el.children)
    }
  }).join('')
}

/** url 类 content 字段（image_url/file_url/video_url/sticker 的 image_url）服务端会**自动补域名**：
 *  发完整 URL 会被二次拼接成 域名/https://域名/key 的坏地址（2026-10-25 复现实验证实：
 *  file 发全 URL → 回读双拼；发裸 key → 回读单层完整）。统一剥成裸 key 再发。 */
const bareKey = (u: string) => String(u || '').replace(/^https?:\/\/[^/]+\//, '')

/** 元素树 -> 云湖 { contentType, content } */
export function render(elements: Element[] = []): { contentType: number; content: Attrs } {
  const els = elements.filter(Boolean)
  const only = els.length === 1 ? els[0] : null

  // 单元素直通（保留平台原生消息类型）
  if (only) {
    switch (only.type) {
      case 'img': return { contentType: ContentType.image, content: { image_url: bareKey(only.attrs.src), ...(Number(only.attrs.width) > 0 && Number(only.attrs.height) > 0 ? { width: only.attrs.width, height: only.attrs.height } : {}) } }
      case 'sticker': return {
        contentType: ContentType.sticker,
        // 官方手机端真实消息对照（2026-10-24 dump）：f9 image=相对 key、f3 image_url=完整 URL、
        // f15=收藏 id、f25/26=item/pack id、f33/34=宽高。桌面显示用 attrs.src（相对 key 走 /res 代理）。
        content: { image: only.attrs.src, image_url: only.attrs.imageUrl || '', sticker_item_id: only.attrs.itemId, sticker_pack_id: only.attrs.packId, expression_id: only.attrs.expressionId ? String(only.attrs.expressionId) : '', width: only.attrs.width || 0, height: only.attrs.height || 0 },
      }
      case 'file': return { contentType: ContentType.file, content: { file_url: bareKey(only.attrs.src), file_name: only.attrs.name, file_size: only.attrs.size } }
      case 'audio': return { contentType: ContentType.audio, content: { audio_url: only.attrs.src, audio_time: only.attrs.time } }
      // ⚠️ video 分支曾缺失：视频元素落 default 被当文本发（content=裸 key 文件名），
      //    接收方只见文件名文本气泡（用户截图实锤）。video_url 发裸 key（服务端补域名，同族规则）。
      case 'video': return { contentType: ContentType.video, content: { video_url: bareKey(only.attrs.src), video_time: Math.max(1, Math.ceil(Number(only.attrs.time) || 1)), file_name: only.attrs.name, file_size: only.attrs.size, width: only.attrs.width, height: only.attrs.height } }
      case 'markdown': return { contentType: ContentType.markdown, content: { text: only.attrs.content } }
      case 'html': return { contentType: ContentType.html, content: { text: only.attrs.content } }
      case 'a2ui': return { contentType: ContentType.a2ui, content: { text: typeof only.attrs.data === 'string' ? only.attrs.data : JSON.stringify(only.attrs.data) } }
      case 'form': return { contentType: ContentType.form, content: { text: typeof only.attrs.data === 'string' ? only.attrs.data : JSON.stringify(only.attrs.data) } }
      case 'tip': return { contentType: ContentType.tip, content: { text: only.attrs.content } }
      case 'text': return { contentType: ContentType.text, content: { text: only.attrs.content } }
    }
  }

  // 多元素：有 html/markdown 元素时优先保留其体积语义
  const hasHtml = els.some(e => e.type === 'html')
  const hasMd = els.some(e => e.type === 'markdown')
  const text = els.map(el => {
    if (el.type === 'markdown' || el.type === 'html') return el.attrs.content ?? ''
    if (el.type === 'img') return el.attrs.src || ''
    if (el.type === 'a') return `${toText(el.children)}(${el.attrs.href})`
    return toText([el])
  }).join('')

  const mentioned = els.flatMap(e => e.type === 'at' ? [e.attrs.id] : e.children.flatMap(c => c.type === 'at' ? [c.attrs.id] : []))
  const content: Attrs = { text }
  if (mentioned.length) content.mentioned_id = mentioned

  if (hasHtml) return { contentType: ContentType.html, content }
  if (hasMd) return { contentType: ContentType.markdown, content }
  return { contentType: ContentType.text, content }
}

/** 便捷：把字符串或元素数组统一成元素数组 */
export function normalizeMessage(content: string | Element[]): Element[] {
  return typeof content === 'string' ? [h.text(content)] : content
}

/** 转义 HTML 后输出（用于把元素渲染成 HTML 片段） */
export function toHtml(elements: Element[] = []): string {
  const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return elements.map(el => {
    switch (el.type) {
      case 'text': return esc(el.attrs.content)
      case 'br': return '<br/>'
      case 'b': return `<b>${toHtml(el.children)}</b>`
      case 'at': return `<span class="at">@${esc(el.attrs.name || el.attrs.id)}</span>`
      case 'a': return `<a href="${esc(el.attrs.href)}" target="_blank" rel="noreferrer">${toHtml(el.children)}</a>`
      case 'img': return `<img src="${esc(el.attrs.src)}"/>`
      case 'markdown': case 'html': return el.attrs.content ?? ''
      default: return toHtml(el.children)
    }
  }).join('')
}
