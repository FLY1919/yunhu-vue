/**
 * 迷你 Protobuf 编解码（云湖 v1 接口用）
 * 只实现客户端用得到的部分：varint / length-delimited / 64bit(double) / 32bit(float)
 * 所有编码函数统一返回 Uint8Array，build() 负责拼接。
 */
const TE = new TextEncoder()
const TD = new TextDecoder()

/* ---------------- 编码 ---------------- */
export function varint(n) {
  n = BigInt(n)
  if (n < 0n) n += 1n << 64n
  const out = []
  while (n > 127n) { out.push(Number(n & 127n) | 128); n >>= 7n }
  out.push(Number(n))
  return new Uint8Array(out)
}
export const tag = (f, w) => varint((BigInt(f) << 3n) | BigInt(w))

export function concat(parts) {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export const fNum = (f, n) => concat([tag(f, 0), varint(n)])
export const fStr = (f, s) => { const e = TE.encode(s ?? ''); return concat([tag(f, 2), varint(e.length), e]) }
export const fBytes = (f, u8) => concat([tag(f, 2), varint(u8.length), u8])
export const build = (...parts) => concat(parts.flat().filter(Boolean))

/* ---------------- 解码 ---------------- */
export function decode(u8) {
  let i = 0; const out = {}
  const rv = () => {
    let s = 0n, sh = 0n
    for (;;) { const b = u8[i++]; s |= BigInt(b & 127) << sh; if (!(b & 128)) break; sh += 7n }
    return s
  }
  while (i < u8.length) {
    const t = rv(); const f = Number(t >> 3n); const w = Number(t & 7n)
    let v
    if (w === 0) v = Number(rv())
    else if (w === 2) { const len = Number(rv()); v = u8.slice(i, i + len); i += len }
    else if (w === 5) { v = u8.slice(i, i + 4); i += 4 }
    else if (w === 1) { v = u8.slice(i, i + 8); i += 8 }
    else throw new Error('unsupported wire type ' + w)
    ;(out[f] = out[f] || []).push(v)
  }
  return out
}

export const rawLast = (d, f) => (d[f] ? d[f][d[f].length - 1] : undefined)
export const raw  = (d, f) => (d[f] ? d[f][0] : undefined)
export const str  = (d, f) => {
  const v = raw(d, f)
  if (v === undefined || v === null) return ''
  // 防御：字段号猜错时可能取到数字/字节，别让 TextDecoder 直接抛异常
  if (typeof v === 'number') return String(v)
  try { return TD.decode(v) } catch { return '' }
}
export const num  = (d, f) => { const v = raw(d, f); return v === undefined ? 0 : Number(v) }
export const bool = (d, f) => !!raw(d, f)
export const msg  = (d, f) => { const v = raw(d, f); return v ? decode(v) : {} }
export const list = (d, f) => d[f] || []
export const each = (d, f) => list(d, f).map(decode)

/* ---------------- 枚举 ---------------- */
export const ChatType = { user: 1, group: 2, bot: 3 }
export const ContentType = { text: 1, image: 2, markdown: 3, file: 4, form: 5, sticker: 7, html: 8, tip: 9, audio: 11, call: 13 }
