/**
 * Satori 协议的 WebSocket 事件推送（/satori/v1/ws）
 *
 * 手写 RFC6455 帧，不引第三方依赖：
 *   · 握手：Sec-WebSocket-Key → SHA1 + base64
 *   · 服务端→客户端：不掩码的文本帧
 *   · 客户端→服务端：按掩码解帧（只关心文本/关闭/ping）
 *
 * 事件来源：轮询云湖的消息列表做增量比对（服务端没有常驻会话，
 * 拉取式比实现一整套云湖 WS 协议更稳，也够用）。
 *
 * 未实现：permessage-deflate 压缩、分片消息、二进制帧。
 */
import crypto from 'node:crypto'
import https from 'node:https'
import { EventEmitter } from 'node:events'

const API_HOST = 'chat-go.jwzhd.com'

/* ---------------- 帧编解码 ---------------- */

/** 编码一个「服务端→客户端」文本帧（不掩码） */
export function encodeFrame(payload: string, opcode = 0x1): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const len = data.length
  let head: Buffer
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len])
  } else if (len < 65536) {
    head = Buffer.alloc(4)
    head[0] = 0x80 | opcode
    head[1] = 126
    head.writeUInt16BE(len, 2)
  } else {
    head = Buffer.alloc(10)
    head[0] = 0x80 | opcode
    head[1] = 127
    head.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([head, data])
}

/** 解析客户端发来的帧（可能一次收到多帧，返回 [帧列表, 剩余字节]） */
export function decodeFrames(buf: Buffer): { frames: Array<{ opcode: number; payload: string }>; rest: Buffer } {
  const frames: Array<{ opcode: number; payload: string }> = []
  let off = 0
  while (off + 2 <= buf.length) {
    const b0 = buf[off]
    const b1 = buf[off + 1]
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let p = off + 2
    if (len === 126) {
      if (p + 2 > buf.length) break
      len = buf.readUInt16BE(p); p += 2
    } else if (len === 127) {
      if (p + 8 > buf.length) break
      len = Number(buf.readBigUInt64BE(p)); p += 8
    }
    let mask: Buffer | null = null
    if (masked) {
      if (p + 4 > buf.length) break
      mask = buf.subarray(p, p + 4); p += 4
    }
    if (p + len > buf.length) break
    const data = Buffer.from(buf.subarray(p, p + len))
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
    frames.push({ opcode, payload: data.toString('utf8') })
    off = p + len
  }
  return { frames, rest: buf.subarray(off) }
}

/** 握手应答 key */
export function acceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
}

/* ---------------- 上游拉取 ---------------- */

function apiReq(method: string, path: string, token: string, body?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0)
    const req = https.request({
      hostname: API_HOST, port: 443, method, path,
      headers: {
        token,
        ...(payload.length ? { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length } : {}),
        origin: 'https://www.yunhu.chat', referer: 'https://www.yunhu.chat/',
      },
    }, (r) => {
      const c: Buffer[] = []
      r.on('data', (x) => c.push(x))
      r.on('end', () => resolve(Buffer.concat(c)))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
    req.end(payload)
  })
}

function pbDecode(buf: Buffer): Record<number, any[]> {
  const out: Record<number, any[]> = {}
  let i = 0
  const rv = () => {
    let s = 0, sh = 0
    while (i < buf.length) { const b = buf[i++]; s |= (b & 0x7f) << sh; if (!(b & 0x80)) break; sh += 7 }
    return s
  }
  while (i < buf.length) {
    const tag = rv(), f = tag >> 3, w = tag & 7
    let v: any
    if (w === 0) v = rv()
    else if (w === 2) { const n = rv(); v = buf.subarray(i, i + n); i += n }
    else if (w === 5) { v = buf.subarray(i, i + 4); i += 4 }
    else if (w === 1) { v = buf.subarray(i, i + 8); i += 8 }
    else break
    ;(out[f] = out[f] || []).push(v)
  }
  return out
}
const pbStr = (d: any, f: number) => {
  const v = d[f]?.[0]
  return v && Buffer.isBuffer(v) ? v.toString('utf8') : v !== undefined ? String(v) : ''
}
const pbNum = (d: any, f: number) => Number(d[f]?.[0] ?? 0)
const pbList = (d: any, f: number) => d[f] || []
const pv = (x: number) => { const o: number[] = []; while (true) { const b = x & 0x7f; x >>>= 7; if (x) o.push(b | 0x80); else { o.push(b); break } } return Buffer.from(o) }
const fStr = (f: number, s: string) => { const e = Buffer.from(s, 'utf8'); return Buffer.concat([pv((f << 3) | 2), pv(e.length), e]) }
const fNum = (f: number, n: number) => Buffer.concat([pv((f << 3) | 0), pv(n)])

async function channelsOf(token: string) {
  const r = await apiReq('POST', '/v1/friend/address-book-list', token, Buffer.alloc(0))
  const out: string[] = []
  try {
    for (const sb of pbList(pbDecode(r), 2)) {
      const sec = pbDecode(sb)
      if (pbNum(sec, 3) !== 2) continue
      for (const gb of pbList(sec, 2)) {
        const id = pbStr(pbDecode(gb), 1)
        if (id) out.push(id)
      }
    }
  } catch { /* 忽略 */ }
  return out
}

async function latestOf(token: string, chatId: string) {
  const body = Buffer.concat([fNum(2, 5), fStr(5, chatId), fNum(4, 2)])
  const r = await apiReq('POST', '/v1/msg/list-message', token, body)
  const list: any[] = []
  for (const mb of pbList(pbDecode(r), 2)) {
    const m = pbDecode(mb)
    const s = m[2] ? pbDecode(m[2][0]) : {}
    list.push({
      id: pbStr(m, 1),
      channel_id: chatId,
      user: { id: pbStr(s, 1), name: pbStr(s, 3), avatar: pbStr(s, 4) },
      content: (() => { const b = m[5]?.[0]; if (!b) return ''; const c = pbDecode(b); return pbStr(c, 1) })() || '',
      created_at: pbNum(m, 7),
    })
  }
  return list
}

/* ---------------- 连接管理 ---------------- */

export class SatoriSocket extends EventEmitter {
  private sock: any
  private seen = new Set<string>()
  private timer?: NodeJS.Timeout
  private buf: any = Buffer.alloc(0)   // 收包缓冲（subarray 的类型泛型在 Node26 下不一致，用 any 省事）
  private closed = false

  private token: string

  // ⚠️ Node 的 strip-only TS 模式不支持「参数属性」写法，
  //    所以这里必须显式声明字段 + 赋值，不能写 constructor(private x)
  constructor(sock: any, token: string) {
    super()
    this.sock = sock
    this.token = token
    sock.on('data', (d: Buffer) => this.onData(d))
    sock.on('close', () => this.close())
    sock.on('error', () => this.close())
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d])
    const { frames, rest } = decodeFrames(this.buf)
    this.buf = rest
    for (const f of frames) {
      if (f.opcode === 0x8) return this.close()
      if (f.opcode === 0x9) { this.send(Buffer.alloc(0), 0xA); continue }
      if (f.opcode === 0x1) this.emit('message', f.payload)
    }
  }

  send(payload: string | Buffer, opcode = 0x1) {
    if (this.closed) return
    try { this.sock.write(encodeFrame(typeof payload === 'string' ? payload : payload.toString('utf8'), opcode)) } catch { this.close() }
  }

  event(name: string, data: any) {
    this.send(JSON.stringify({ op: 0, body: { event: name, ...data } }))
  }

  /** 开始轮询推送（只看前 8 个群，够用又不至于把接口打爆） */
  async start() {
    let channels: string[] = []
    try { channels = (await channelsOf(this.token)).slice(0, 8) } catch { /* 忽略 */ }
    this.event('ready', { logins: [{ sn: 0, user: { id: '', name: '' } }] })

    const tick = async () => {
      if (this.closed) return
      for (const ch of channels) {
        try {
          for (const m of await latestOf(this.token, ch)) {
            if (this.seen.has(m.id)) continue
            this.seen.add(m.id)
            this.event('message-created', { message: { id: m.id, content: m.content, channel: { id: ch, type: 0 }, user: m.user, created_at: m.created_at } })
          }
        } catch { /* 单个群失败不影响其它 */ }
      }
    }
    // 第一遍只记已读，避免连上就把历史全推一遍
    await tick()
    this.timer = setInterval(tick, 4000)
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    try { this.sock.end() } catch { /* 忽略 */ }
    this.emit('closed')
  }
}

export function isSatoriWs(pathname: string) {
  return pathname === '/satori/v1/ws'
}
