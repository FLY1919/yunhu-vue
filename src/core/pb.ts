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
  if (!(u8 instanceof Uint8Array)) throw new Error('Protobuf：需要字节数据')
  let i = 0; const out = {}
  const fail = () => { throw new Error('Protobuf：响应格式错误或数据不完整') }
  const rv = () => {
    let s = 0n
    for (let n = 0; n < 10; n++) {
      if (i >= u8.length) return fail()
      const b = u8[i++]
      if (n === 9 && b > 1) return fail()
      s |= BigInt(b & 127) << BigInt(n * 7)
      if (!(b & 128)) return s
    }
    return fail()
  }
  const readTag = () => {
    const t = rv(), f = Number(t >> 3n), w = Number(t & 7n)
    if (f < 1 || f > 0x1fffffff || w > 5) return fail()
    return { f, w }
  }
  const take = (len) => {
    if (!Number.isSafeInteger(len) || len < 0 || len > u8.length - i) return fail()
    const value = u8.slice(i, i + len); i += len
    return value
  }
  // Deprecated groups are allowed, but must terminate with the matching field.
  // Never loop past EOF: a string misread as a message used to freeze the UI here.
  const skip = (w, field, depth = 0) => {
    if (w === 0) { rv(); return }
    if (w === 2) { take(Number(rv())); return }
    if (w === 5) { take(4); return }
    if (w === 1) { take(8); return }
    if (w === 3) {
      if (depth >= 64) return fail()
      while (i < u8.length) {
        const next = readTag()
        if (next.w === 4) { if (next.f !== field) return fail(); return }
        skip(next.w, next.f, depth + 1)
      }
    }
    return fail()
  }
  while (i < u8.length) {
    const { f, w } = readTag()
    let v
    if (w === 0) v = Number(rv())
    else if (w === 2) v = take(Number(rv()))
    else if (w === 5) v = take(4)
    else if (w === 1) v = take(8)
    else { skip(w, f); continue }
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
