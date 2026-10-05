/** 通用小工具 */

export function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts > 1e12 ? ts : ts * 1000)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return hm
  const y = new Date(now.getTime() - 864e5)
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export function fallbackAvatar(name = '?') {
  const ch = (name || '?').trim().charAt(0) || '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
    <rect width="80" height="80" rx="16" fill="#2a2f3a"/>
    <text x="40" y="52" font-size="34" fill="#9aa3b2" text-anchor="middle"
      font-family="sans-serif">${ch.replace(/[<>&]/g, '')}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const CHAT_TYPE_LABEL = { 1: '私聊', 2: '群聊', 3: '机器人' }
