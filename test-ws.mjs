/**
 * WebSocket 冒烟测试：登录 → 连接 wss → 收 push_message
 * 用法： YH_EMAIL=… YH_PASS=… node test-ws.mjs
 */
import { createContext } from './src/core/context'
import { apiPlugin } from './src/plugins/api'
import * as pb from './src/core/pb'
import { decodePush, decodeStream } from './src/plugins/ws'

const ctx = createContext()
ctx.plugin(apiPlugin, { base: 'https://chat-go.jwzhd.com' })
const api = ctx.api

const token = await api.login(process.env.YH_EMAIL, process.env.YH_PASS, 'node-ws', 'web')
api.setToken(token)
const me = await api.self()
console.log('登录:', me.name, me.id)

const routes = await api.distribution()
console.log('路由:', routes)

const url = routes.websocketUrl || 'wss://chat-ws-go.jwzhd.com/ws'
const ws = new WebSocket(url)
ws.binaryType = 'arraybuffer'
let received = 0

ws.onopen = () => {
  console.log('✓ 已连接', url)
  ws.send(JSON.stringify({
    seq: Date.now().toString(), cmd: 'login',
    data: { userId: me.id, token, platform: 'Web', deviceId: 'node-ws' },
  }))
  setInterval(() => ws.send(JSON.stringify({ seq: Date.now().toString(), cmd: 'heartbeat', data: {} })), 20000)
}

ws.onmessage = ev => {
  if (typeof ev.data === 'string') return console.log('文本帧:', ev.data.slice(0, 160))
  const wrap = pb.decode(new Uint8Array(ev.data))
  const info = pb.msg(wrap, 1)
  const cmd = pb.str(info, 2)
  const any = pb.raw(wrap, 2) ? pb.decode(pb.raw(wrap, 2)) : {}
  const value = pb.raw(any, 2)
  if (cmd === 'heartbeat_ack') return
  received++
  if (cmd === 'push_message' && value) {
    const m = decodePush(value)
    console.log(`✓ push_message  [${m.chatType}] ${m.sender}: ${m.content.text || '(非文本 type=' + m.type + ')'}`.slice(0, 160))
  } else if (cmd === 'stream_message' && value) {
    console.log('✓ stream_message', decodeStream(value))
  } else {
    console.log('· 其它帧 cmd=' + cmd, value ? value.length + 'B' : '')
  }
}
ws.onerror = e => console.log('✗ 错误', e.message || e)

// 30 秒后统计
setTimeout(() => {
  console.log(`\n共收到 ${received} 条推送`)
  ws.close()
  process.exit(0)
}, 30000)
