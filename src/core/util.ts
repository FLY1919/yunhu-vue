/** 通用小工具 */

const fileSizeUnits = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatFileSize(bytes: number | string) {
  if (typeof bytes !== 'number' && (typeof bytes !== 'string' || !bytes.trim())) return ''
  let size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return ''
  let unit = 0
  while (size >= 1024 && unit < fileSizeUnits.length - 1) {
    size /= 1024
    unit++
  }
  const display = unit ? Math.floor(size * 100) / 100 : Math.floor(size)
  return `${display} ${fileSizeUnits[unit]}`
}

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

/** 完整时间：YYYY年MM月DD日 HH:MM:SS（点击时间时展开用） */
export function fmtFullTime(ts) {
  if (!ts) return ''
  const d = new Date(ts > 1e12 ? ts : ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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
