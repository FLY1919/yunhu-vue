/**
 * 资源 URL 处理
 * 云湖数据床（chat-img*.jwznb.com 等）要求请求头 Referer: http://myapp.jwznb.com，
 * 浏览器 <img>/<video> 无法自定义 Referer，因此统一改写为同源代理 /res/<host>/<path>。
 */
export const RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i

/** 代理前缀，可由 window.YUNHU_RES 覆盖 */
export const resPrefix = () => (typeof window !== 'undefined' && window.YUNHU_RES) || '/res'

export function isResHost(host) { return RES_HOST_RE.test(host) }

/** https://chat-img.jwznb.com/a.jpg  ->  /res/chat-img.jwznb.com/a.jpg */
export function resUrl(u) {
  if (!u || typeof u !== 'string') return u
  if (u.startsWith('data:') || u.startsWith('blob:')) return u
  if (u.startsWith('/res/')) return u

  // 相对 key：云湖很多字段（content.image、expression_id 等）存的是**没有域名的 key**，
  // 例如 "1791136274952_5v959y.png"、"expression/abc.jpg"。必须补上图片桶域名再走代理，
  // 否则浏览器会按当前页面相对路径去请求 → 404 裂图。
  if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) {
    return `${resPrefix()}/chat-img.jwznb.com/${u.replace(/^\/+/, '')}`
  }
  // 有些上游数据会把地址双重拼接（https://host/https://host/xxx），先纠正
  const dup = u.match(/^https?:\/\/([^/]+)\/https?:\/\/([^/]+)(\/.*)?$/)
  if (dup) u = `https://${dup[2]}${dup[3] || ''}`

  let url
  try { url = new URL(u, typeof location !== 'undefined' ? location.origin : 'http://x') } catch { return u }
  if (!isResHost(url.host)) return u
  return `${resPrefix()}/${url.host}${url.pathname}${url.search}`
}

/**
 * 把一段已渲染 DOM 里所有资源链接改写到代理上
 * （markdown / html 消息里的 <img src> 也会被覆盖）
 */
export function fixResourceUrls(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return
  const attrs = ['src', 'href', 'poster', 'data-src']
  for (const attr of attrs) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const v = el.getAttribute(attr)
      const nv = resUrl(v)
      if (nv !== v) el.setAttribute(attr, nv)
    }
  }
  for (const el of root.querySelectorAll('source[srcset], img[srcset]')) {
    el.removeAttribute('srcset')
  }
}
