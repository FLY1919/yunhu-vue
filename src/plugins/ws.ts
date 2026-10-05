/**
 * ws 插件 —— 实时收发
 * 协议：wss://chat-ws-go.jwzhd.com/ws
 *   1) 先发 JSON {seq, cmd:'login', data:{userId, token, platform:'Web', deviceId}}
 *   2) 心跳 JSON {seq, cmd:'heartbeat', data:{}}
 *   3) 之后服务端推 protobuf： WsWrapper{ info:WsInfo{seq=1,cmd=2}, data:Any{type_url=1,value=2} }
 *      cmd: push_message / edit_message / stream_message / draft_input / heartbeat_ack / invite_apply ...
 * 依赖：api、auth（通过事件把消息交给 adapter 转成 Satori 会话）
 */
import { reactive, watch } from 'vue'
import type { Context } from '../core/context'
import * as pb from '../core/pb'
import { decodeContent, decodeSenderTags } from './api'

/** PushMessage / 编辑消息 */
export function decodePush(bytes) {
  const d = pb.decode(bytes)
  const s = pb.msg(d, 2)
  return {
    id: pb.str(d, 1),
    senderId: pb.str(s, 1),
    senderType: pb.num(s, 2),
    sender: pb.str(s, 3) || pb.str(s, 1),
    avatar: pb.str(s, 4),
    tags: decodeSenderTags(s),
    recvId: pb.str(d, 3),
    chatId: pb.str(d, 4),
    chatType: pb.num(d, 5),
    content: decodeContent(pb.raw(d, 6)),
    type: pb.num(d, 7),
    ts: pb.num(d, 8),
    recallTs: pb.num(d, 10),
    quoteId: pb.str(d, 11),
    seq: pb.num(d, 12),
    editTs: pb.num(d, 14),
  }
}

/** StreamMessage */
export function decodeStream(bytes) {
  const d = pb.decode(bytes)
  return { id: pb.str(d, 1), recvId: pb.str(d, 2), chatId: pb.str(d, 3), delta: pb.str(d, 4) }
}

const seq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`

export const wsPlugin = {
  name: 'ws',
  inject: ['api', 'auth'],
  provide: ['ws'],

  apply(ctx: Context, config: any = {}) {
    const api = ctx.api
    const auth = ctx.auth
    const hbMs = config.heartbeat ?? 25000
    const state = reactive({ status: 'idle', url: '', error: '', lastAt: 0 })

    let socket = null
    let hbTimer = null
    let retryTimer = null
    let retry = 0
    let manualClose = false

    function log(...a) { ctx.logger?.info('[ws]', ...a) }

    function sendJson(obj) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj))
    }

    async function url() {
      try {
        const r = await api.distribution()
        return r.websocketUrl || 'wss://chat-ws-go.jwzhd.com/ws'
      } catch { return 'wss://chat-ws-go.jwzhd.com/ws' }
    }

    async function connect() {
      if (socket) return
      manualClose = false
      state.status = 'connecting'
      state.url = await url()
      log('连接', state.url)
      try { socket = new WebSocket(state.url) } catch (e) { return scheduleRetry(e) }
      socket.binaryType = 'arraybuffer'

      socket.onopen = () => {
        state.status = 'online'
        retry = 0
        log('已连接，发送登录包')
        sendJson({
          seq: seq(), cmd: 'login',
          data: { userId: auth.state.user?.id, token: api.token, platform: 'Web', deviceId: deviceId() },
        })
        clearInterval(hbTimer)
        hbTimer = setInterval(() => sendJson({ seq: seq(), cmd: 'heartbeat', data: {} }), hbMs)
      }

      socket.onmessage = ev => {
        state.lastAt = Date.now()
        if (typeof ev.data === 'string') return onText(ev.data)
        return onBinary(new Uint8Array(ev.data))
      }

      socket.onclose = () => {
        state.status = 'closed'
        clearInterval(hbTimer)
        socket = null
        log('连接关闭')
        if (!manualClose) scheduleRetry()
      }

      socket.onerror = () => { state.error = 'websocket error'; log('连接错误') }
    }

    function scheduleRetry(err?: any) {
      retry = Math.min(retry + 1, 6)
      const delay = Math.min(1500 * retry, 15000)
      state.status = 'retry'
      if (err) state.error = err.message || String(err)
      log(`${delay}ms 后重连（第 ${retry} 次）`)
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, delay)
    }

    function close() {
      manualClose = true
      clearInterval(hbTimer)
      clearTimeout(retryTimer)
      if (socket) { try { socket.close() } catch { /* ignore */ } }
      socket = null
      state.status = 'idle'
    }

    function onText(text) {
      try {
        const j = JSON.parse(text)
        if (j.code && j.code !== 1 && j.msg) state.error = j.msg
        ctx.emit('ws/raw', j)
      } catch { log('文本帧:', text.slice(0, 200)) }
    }

    function onBinary(u8) {
      let wrap
      try { wrap = pb.decode(u8) } catch (e) { return log('解析失败', e.message) }
      const info = pb.msg(wrap, 1)
      const cmd = pb.str(info, 2)
      const anyBytes = pb.raw(wrap, 2)
      const any = anyBytes ? pb.decode(anyBytes) : {}
      const value = pb.raw(any, 2) // Any.value

      switch (cmd) {
        case 'push_message':
        case 'edit_message':
          if (value) ctx.emit('ws/message', { cmd, msg: decodePush(value) })
          break
        case 'stream_message':
          if (value) ctx.emit('ws/stream', decodeStream(value))
          break
        case 'draft_input': {
          if (!value) break
          const d = pb.decode(value)
          ctx.emit('ws/draft', { chatId: pb.str(d, 1), input: pb.str(d, 2) })
          break
        }
        case 'heartbeat_ack':
          break
        case 'invite_apply':
          ctx.emit('ui/toast', { text: '收到新的邀请', type: 'info' })
          break
        default:
          ctx.emit('ws/raw', { cmd, value: value ? [...value.slice(0, 64)] : null })
      }
    }

    ctx.effect(() => {
      const stop = watch(() => auth.state.status, s => {
        if (s === 'ready') connect()
        else close()
      }, { immediate: true })
      return () => { stop(); close() }
    })

    const ws = {
      state,
      connect,
      close,
      reconnect: () => { close(); connect() },
      get online() { return state.status === 'online' },
      send: sendJson,
    }

    ctx.set('ws', ws)
  },
}

function deviceId() {
  let d = localStorage.getItem('yh.device')
  if (!d) { d = 'web-' + Math.random().toString(36).slice(2); localStorage.setItem('yh.device', d) }
  return d
}
