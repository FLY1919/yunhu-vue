/**
 * 资源 URL 处理
 * 云湖数据床（chat-img*.jwznb.com 等）要求请求头 Referer: http://myapp.jwznb.com，
 * 浏览器 <img>/<video> 无法自定义 Referer，因此统一改写为同源代理 /res/<host>/<path>。
 */
export const RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i

/** 代理前缀，可由 window.YUNHU_RES 覆盖 */
export const resPrefix = () => (typeof window !== 'undefined' && window.YUNHU_RES) || '/res'

export function isResHost(host) { return RES_HOST_RE.test(host) }

const isNative = () => typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()

/** https://chat-img.jwznb.com/a.jpg  ->  /res/chat-img.jwznb.com/a.jpg */
export function resUrl(u) {
  // ⚠️ Capacitor 原生（安卓内置）：不写 /res 代理，直接返回原始 https 地址。
  // 配合 capacitor.config.ts 的 server.hostname='myapp.jwznb.com'，
  // WebView 的页面 origin 就是云湖白名单域名，图片请求 Referer 天然通过防盗链。
  if (isNative()) {
    if (!u || typeof u !== 'string') return u
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/res/')) return u
    // 自定义协议深链原样返回（同非 native 分支）
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return u
    // 相对 key 补图片桶域名
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) {
      return `https://chat-img.jwznb.com/${u.replace(/^\/+/, '')}`
    }
    return u
  }
  if (!u || typeof u !== 'string') return u
  if (u.startsWith('data:') || u.startsWith('blob:')) return u
  if (u.startsWith('/res/')) return u
  // 自定义协议深链（yunhu://chat-add、mailto:、tel: 等）原样返回：
  // 否则会被当成「相对 key」补上 /res 图片桶前缀，深链变 404 死链（群卡片点不动第二层根因）
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return u

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
 * 媒体资源地址：按类型补正确桶域名（裸 key 场景）。
 * ⚠️ 视频/音频的 key 在 video1/audio1 桶，图片在 img 桶 —— 一律补 img 桶会导致播放 404。
 */
export function mediaUrl(u: string, kind: 'image' | 'video' | 'audio' | 'file' = 'image') {
  if (!u || typeof u !== 'string') return u
  if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/res/')) return resUrl(u)
  const host = kind === 'video' ? 'chat-video1.jwznb.com'
    : kind === 'audio' ? 'chat-audio1.jwznb.com'
      : kind === 'file' ? 'chat-file.jwznb.com'
        : 'chat-img.jwznb.com'
  return resUrl(`https://${host}/${u.replace(/^\/+/, '')}`)
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
      if (attr === 'href') {
        // 普通网址/页内锚点不能当作图片 key 改写；仅代理明确的资源域名。
        let link: URL
        try { link = new URL(v) } catch { continue }
        if (!/^https?:$/.test(link.protocol)) continue
        if (!isResHost(link.host)) {
          el.setAttribute('target', '_blank')
          el.setAttribute('rel', 'noopener noreferrer')
          continue
        }
      }
      const nv = resUrl(v)
      if (nv !== v) el.setAttribute(attr, nv)
    }
  }
  for (const el of root.querySelectorAll('source[srcset], img[srcset]')) {
    el.removeAttribute('srcset')
  }
}
