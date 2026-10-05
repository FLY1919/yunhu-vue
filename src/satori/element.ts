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
  sticker: (src: string, itemId = 0, packId = 0): Element => h('sticker', { src, itemId, packId }),
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
    case ContentType.sticker: out.push(h.sticker(content.image_url || content.image || '', content.sticker_item_id, content.sticker_pack_id)); break
    case ContentType.file: out.push(h.file(content.file_url, content.file_name, content.file_size)); break
    case ContentType.video: out.push(h.video(content.video_url || content.video, content.video_time)); break
    case ContentType.audio: out.push(h.audio(content.audio_url, content.audio_time)); break
    case ContentType.call: out.push(h.call(content.call_status_text || '')); break
    case ContentType.tip: out.push(h.tip(content.tip || content.text || '')); break
    case ContentType.form: out.push(h.form(content.form)); break
    case ContentType.post: out.push(h.post(content.post_title, content.post_content, content.post_id)); break
    case ContentType.a2ui: out.push(h.a2ui(content.text ?? content.form ?? '')); break
    default: out.push(h('unknown', { contentType, content }))
  }
  const el = out[0]
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
      case 'img': return el.attrs.src || ''
      case 'audio': case 'video': return el.attrs.src || ''
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

/** 元素树 -> 云湖 { contentType, content } */
export function render(elements: Element[] = []): { contentType: number; content: Attrs } {
  const els = elements.filter(Boolean)
  const only = els.length === 1 ? els[0] : null

  // 单元素直通（保留平台原生消息类型）
  if (only) {
    switch (only.type) {
      case 'img': return { contentType: ContentType.image, content: { image_url: only.attrs.src } }
      case 'sticker': return {
        contentType: ContentType.sticker,
        content: { image: only.attrs.src, sticker_item_id: only.attrs.itemId, sticker_pack_id: only.attrs.packId },
      }
      case 'file': return { contentType: ContentType.file, content: { file_url: only.attrs.src, file_name: only.attrs.name, file_size: only.attrs.size } }
      case 'audio': return { contentType: ContentType.audio, content: { audio_url: only.attrs.src, audio_time: only.attrs.time } }
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
