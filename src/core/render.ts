/**
 * 消息内容渲染工具：Markdown / HTML / 链接 / A2UI 解析
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { fixResourceUrls } from './res'

marked.setOptions({ gfm: true, breaks: true })

/** 只放行富文本常用标签，图片/链接统一走代理 */
const SANITIZE_OPTS = {
  ADD_ATTR: ['target', 'rel', 'data-a2ui-action', 'data-a2ui-id'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  // ⚠️ 默认白名单不认自定义协议：群卡片的 <a href="yunhu://chat-add?..."> 会被整条剥掉 href，
  //    渲染出来就是点不动的死链（用户报「点击依旧点不动」的真根因，实测 a.getAttribute('href')=null）。
  //    在默认正则基础上追加 yunhu: 分支；[^a-z] 分支保留（相对路径/data: 头像仍放行）。
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|sms|cid|xmpp|yunhu):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
}

export function renderMarkdown(md: string): string {
  const html = marked.parse(String(md ?? ''), { async: false }) as string
  return sanitizeHtml(html)
}

export function sanitizeHtml(html: string): string {
  const fragment = DOMPurify.sanitize(String(html ?? ''), {
    ...SANITIZE_OPTS, RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment
  // 作者指定的黑字、紫底、透明度会与客户端主题冲突。保留排版，颜色交给主题。
  // 在净化后的惰性 DOM 中处理，包含嵌套节点和 !important，不改写消息原文。
  for (const el of fragment.querySelectorAll<HTMLElement>('*')) {
    for (const attr of ['color', 'bgcolor', 'text', 'link', 'vlink', 'alink']) el.removeAttribute(attr)
    if (!el.style) continue
    for (const property of ['color', 'background', 'background-color', 'background-image',
      'opacity', 'filter', 'mix-blend-mode', 'text-shadow', '-webkit-text-fill-color',
      '-webkit-text-stroke', '-webkit-text-stroke-color', 'visibility']) {
      el.style.removeProperty(property)
    }
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
  }
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

/** 渲染完成后统一把资源链接改写到 /res 代理 */
export function postProcess(el: any) { fixResourceUrls(el) }

/** 纯文本里的 URL 变成可点链接（已转义，安全） */
export function linkify(text: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const raw = String(text ?? '')
  const matches = raw.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'，。！？、；：）】》]+/gi)
  let out = '', start = 0
  for (const match of matches) {
    const index = match.index!
    let url = match[0].replace(/[.,;!?]+$/, '')
    while (url.endsWith(')') && (url.match(/\)/g)?.length || 0) > (url.match(/\(/g)?.length || 0)) url = url.slice(0, -1)
    out += escape(raw.slice(start, index))
    const href = /^www\./i.test(url) ? 'https://' + url : url
    out += `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>`
    start = index + url.length
  }
  return out + escape(raw.slice(start))
}

/* =====================  A2UI  ===================== */

// A2UI 解析已迁移到 src/satori/a2ui.ts（真实 v0.9 扁平组件协议）


/**
 * 富文本渲染（看板 / 机器人输出用）
 * 一块内容里可能既有 markdown 又有 HTML，先按 HTML 净化，再把残留的 markdown 语法也渲染出来。
 */
export function renderRich(text: string): string {
  const raw = String(text ?? '')
  if (!raw.trim()) return ''
  const hasHtml = /<\/?[a-z][\s\S]*?>/i.test(raw)
  if (hasHtml) {
    // HTML 为主：净化后返回（里面的 markdown 语法一般不多）
    return sanitizeHtml(raw)
  }
  return renderMarkdown(raw)
}
