/**
 * 标准 Satori 协议端点（让别的语言的 SDK / 别的 Koishi 实例也能连这个客户端）
 *
 *   GET  /satori/v1/guild.list
 *   GET  /satori/v1/channel.list
 *   GET  /satori/v1/message.list?channel_id=xxx&next=
 *   POST /satori/v1/message.create   { channel_id, content }
 *   GET  /satori/v1/user.get?id=xxx
 *   GET  /satori/v1/login.get
 *
 * 认证：Authorization: Bearer <云湖 token>
 * 说明：消息收发走云湖 protobuf；这里只做 Satori JSON 协议 <-> 云湖 protobuf 的翻译。
 * 未实现：WebSocket 事件推送（/satori/v1/ws）、message.update/delete、反应等。
 */
import https from 'node:https'

/* ---------------- protobuf（读 + 写） ---------------- */

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
const pbStr = (d: Record<number, any[]>, f: number) => {
  const v = d[f]?.[0]
  return v && Buffer.isBuffer(v) ? v.toString('utf8') : v !== undefined ? String(v) : ''
}
const pbNum = (d: Record<number, any[]>, f: number) => Number(d[f]?.[0] ?? 0)
const pbList = (d: Record<number, any[]>, f: number) => d[f] || []

function pvint(x: number): Buffer {
  const o: number[] = []
  while (true) { const b = x & 0x7f; x >>>= 7; if (x) o.push(b | 0x80); else { o.push(b); break } }
  return Buffer.from(o)
}
const pbFieldStr = (f: number, s: string) => {
  const e = Buffer.from(s, 'utf8')
  return Buffer.concat([pvint((f << 3) | 2), pvint(e.length), e])
}
const pbFieldNum = (f: number, n: number) => Buffer.concat([pvint((f << 3) | 0), pvint(n)])

/* ---------------- 上游 ---------------- */

function apiReq(method: string, path: string, token: string, body?: Buffer, ctype = 'application/octet-stream') {
  return new Promise<{ status: number; buf: Buffer }>((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0)
    const req = https.request({
      hostname: 'chat-go.jwzhd.com', port: 443, method, path,
      headers: {
        token,
        ...(payload.length ? { 'Content-Type': ctype, 'Content-Length': payload.length } : {}),
        origin: 'https://www.yunhu.chat', referer: 'https://www.yunhu.chat/',
      },
    }, (r) => {
      const c: Buffer[] = []
      r.on('data', (x) => c.push(x))
      r.on('end', () => resolve({ status: r.statusCode || 500, buf: Buffer.concat(c) }))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('upstream timeout')))
    req.end(payload)
  })
}

async function groupsOf(token: string) {
  const r = await apiReq('POST', '/v1/friend/address-book-list', token, Buffer.alloc(0))
  const out: Array<{ id: string; name: string; type: number }> = []
  for (const sb of pbList(pbDecode(r.buf), 2)) {
    const sec = pbDecode(sb)
    const t = pbNum(sec, 3)
    for (const gb of pbList(sec, 2)) {
      const g = pbDecode(gb)
      const id = pbStr(g, 1)
      if (id) out.push({ id, name: pbStr(g, 8) || pbStr(g, 2) || id, type: t })
    }
  }
  return out
}

async function messagesOf(token: string, chatId: string, size = 30) {
  const body = Buffer.concat([pbFieldNum(2, size), pbFieldStr(5, chatId), pbFieldNum(4, 2)])
  const r = await apiReq('POST', '/v1/msg/list-message', token, body)
  const out: any[] = []
  for (const mb of pbList(pbDecode(r.buf), 2)) {
    const m = pbDecode(mb)
    const s = m[2] ? pbDecode(m[2][0]) : {}
    out.push({
      id: pbStr(m, 1),
      chatId,
      senderId: pbStr(s, 1),
      sender: pbStr(s, 3) || pbStr(s, 1),
      avatar: pbStr(s, 4),
      type: pbNum(m, 3),
      content: (() => {
        const b = m[5]?.[0]
        if (!b) return ''
        const c = pbDecode(b)
        return pbStr(c, 1) || Buffer.from(b).toString('utf8')
      })(),
      ts: pbNum(m, 7) || pbNum(m, 8),
    })
  }
  return out.reverse()
}

/* ---------------- Satori JSON ---------------- */

const json = (res: any, code: number, data: any) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

export async function handleSatori(req: any, res: any, pathname: string, search: string): Promise<boolean> {
  if (!pathname.startsWith('/satori/')) return false
  const url = new URL(pathname + (search || ''), 'http://x')
  const p = url.pathname.replace(/^\/satori/, '')

  const auth = String(req.headers.authorization || '')
  const token = auth.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || ''
  if (!token) return json(res, 401, { code: 401, message: '需要 Authorization: Bearer <token>' }), true

  try {
    if (p === '/v1/login.get') {
      // ⚠️ /v1/user/get-user-data：① 必须是 **POST**（GET 会 404）② 返回 **JSON**（不是 protobuf）
      const r = await apiReq('POST', '/v1/user/get-user-data', token, Buffer.from('{}'), 'application/json')
      let uid = ''
      let intro = ''
      try {
        const j = JSON.parse(r.buf.toString('utf8') || '{}')
        const d = j?.data?.data || {}
        uid = String(d.userId || '')
        intro = String(d.introduction || '')
      } catch { /* 忽略 */ }
      // 再用 userId 取昵称/头像（这个是 protobuf：GetUserResponse.Data{ id=1, name=2, avatar_url=4 }）
      let name = '', avatar = ''
      if (uid) {
        try {
          const r2 = await apiReq('POST', '/v1/user/get-user', token, pbFieldStr(2, uid))
          const d2 = pbDecode(r2.buf)
          const u = d2[2] ? pbDecode(d2[2][0]) : {}
          name = pbStr(u, 2)
          avatar = pbStr(u, 4)
        } catch { /* 忽略 */ }
      }
      return json(res, 200, {
        code: 0,
        login: { user: { id: uid, name, avatar, nick: name } },
        user: { id: uid, name, avatar },
        introduction: intro,
      }), true
    }

    if (p === '/v1/guild.list') {
      const all = await groupsOf(token)
      const list = all.filter((g) => g.type === 2).map((g) => ({ id: g.id, name: g.name, avatar: '' }))
      return json(res, 200, { code: 0, data: list, guilds: list }), true
    }

    if (p === '/v1/channel.list') {
      const all = await groupsOf(token)
      const list = all.map((g) => ({ id: g.id, name: g.name, type: g.type === 2 ? 0 : 1, parent_id: g.id }))
      return json(res, 200, { code: 0, data: list, channels: list }), true
    }

    if (p === '/v1/message.list') {
      const channelId = url.searchParams.get('channel_id') || ''
      if (!channelId) return json(res, 400, { code: 400, message: '缺少 channel_id' }), true
      const msgs = await messagesOf(token, channelId)
      const data = msgs.map((m) => ({
        id: m.id, content: m.content || '',
        channel: { id: m.chatId, type: 0 },
        guild: { id: m.chatId },
        user: { id: m.senderId, name: m.sender, avatar: m.avatar },
        created_at: m.ts,
      }))
      return json(res, 200, { code: 0, data, messages: data }), true
    }

    if (p === '/v1/message.create' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const channelId = String(body.channel_id || '')
      const text = typeof body.content === 'string' ? body.content : String(body.content ?? '')
      if (!channelId || !text) return json(res, 400, { code: 400, message: '缺少 channel_id / content' }), true

      const mid = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
      const contentBuf = pbFieldStr(1, text)
      const msgBuf = Buffer.concat([
        pbFieldStr(2, mid), pbFieldStr(3, channelId), pbFieldNum(4, 2),
        pbFieldStr(5, contentBuf.toString('binary')), pbFieldNum(6, 1),
      ])
      const r = await apiReq('POST', '/v1/msg/send-message', token, msgBuf)
      const ok = r.buf.includes(Buffer.from('success')) || r.status === 200
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500, data: ok ? [{ id: mid }] : null }), true
    }

    /* 编辑消息：Satori 的 message.update { channel_id, message_id, content } */
    if (p === '/v1/message.update' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const channelId = String(body.channel_id || '')
      const msgId = String(body.message_id || '')
      const text = typeof body.content === 'string' ? body.content : String(body.content ?? '')
      if (!channelId || !msgId || !text) return json(res, 400, { code: 400, message: '缺少 channel_id / message_id / content' }), true
      // 云湖的「编辑」和「发送」共用 SendMsgRequest，msg_id 填被编辑那条
      const contentBuf = pbFieldStr(1, text)
      const msgBuf = Buffer.concat([
        pbFieldStr(2, msgId), pbFieldStr(3, channelId), pbFieldNum(4, 2),
        pbFieldStr(5, contentBuf.toString('binary')), pbFieldNum(6, 1),
      ])
      const r = await apiReq('POST', '/v1/msg/edit-message', token, msgBuf)
      const ok = r.status === 200
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500, data: ok ? [{ id: msgId }] : null }), true
    }

    /* 撤回消息：Satori 的 message.delete { channel_id, message_id } */
    if (p === '/v1/message.delete' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const channelId = String(body.channel_id || '')
      const msgId = String(body.message_id || '')
      if (!channelId || !msgId) return json(res, 400, { code: 400, message: '缺少 channel_id / message_id' }), true
      const msgBuf = Buffer.concat([pbFieldStr(2, msgId), pbFieldStr(3, channelId), pbFieldNum(4, 2)])
      const r = await apiReq('POST', '/v1/msg/recall-msg', token, msgBuf)
      const ok = r.status === 200
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500 }), true
    }

    if (p === '/v1/user.get') {
      const id = url.searchParams.get('id') || ''
      if (!id) return json(res, 400, { code: 400, message: '缺少 id' }), true
      const r = await apiReq('POST', '/v1/user/get-user', token, pbFieldStr(2, id))
      const d = pbDecode(r.buf)
      const u = d[2] ? pbDecode(d[2][0]) : {}
      // GetUserResponse.Data{ id=1, name=2, name_id=3, avatar_url=4, medal=6, register_time=7, online_day=11 }
      return json(res, 200, {
        code: 0,
        data: {
          id: pbStr(u, 1) || id,
          name: pbStr(u, 2),
          avatar: pbStr(u, 4),
          register_time: pbStr(u, 7),
          online_day: pbNum(u, 11),
        },
      }), true
    }

    return json(res, 404, { code: 404, message: '未知端点 ' + p + '（WebSocket 事件推送未实现）' }), true
  } catch (e: any) {
    return json(res, 500, { code: 500, message: String(e.message || e) }), true
  }
}
