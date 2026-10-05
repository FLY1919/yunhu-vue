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
}

export function renderMarkdown(md: string): string {
  const html = marked.parse(String(md ?? ''), { async: false }) as string
  return DOMPurify.sanitize(html, SANITIZE_OPTS as any) as unknown as string
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(String(html ?? ''), SANITIZE_OPTS as any) as unknown as string
}

/** 渲染完成后统一把资源链接改写到 /res 代理 */
export function postProcess(el: any) { fixResourceUrls(el) }

/** 纯文本里的 URL 变成可点链接（已转义，安全） */
export function linkify(text: string): string {
  const esc = String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return esc.replace(/(https?:\/\/[^\s<>"']+)/g, u => `<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`)
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
