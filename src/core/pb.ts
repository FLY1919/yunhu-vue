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
  /**
   * 跳过某个字段（含递归跳过 group）。
   * ⚠️ 之前只支持 wire type 0/1/2/5，遇到 3（start group）/4（end group）就抛
   *    'unsupported wire type 4' —— 云湖某些响应里有已废弃的 group 类型字段，
   *    客户端用不到这些字段，正确做法是**跳过**而不是崩溃。
   */
  const skip = (w) => {
    if (w === 0) { rv(); return }
    if (w === 2) { const len = Number(rv()); i += len; return }
    if (w === 5) { i += 4; return }
    if (w === 1) { i += 8; return }
    if (w === 3) {
      // start group：递归跳到匹配的 end group（字段号在 tag 里，这里只按 w 判断）
      for (;;) {
        const t2 = rv(); const w2 = Number(t2 & 7n)
        if (w2 === 4) return  // 遇到 end group，group 结束
        skip(w2)
      }
    }
    // w === 4（end group）或其它非法值：无 payload，直接返回
  }
  while (i < u8.length) {
    const t = rv(); const f = Number(t >> 3n); const w = Number(t & 7n)
    let v
    if (w === 0) v = Number(rv())
    else if (w === 2) { const len = Number(rv()); v = u8.slice(i, i + len); i += len }
    else if (w === 5) { v = u8.slice(i, i + 4); i += 4 }
    else if (w === 1) { v = u8.slice(i, i + 8); i += 8 }
    else { skip(w); continue }  // wire type 3/4 或其它未知：跳过，不崩
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
