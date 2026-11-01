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
    quoteId: pb.str(d, 11) || (/^[a-zA-Z0-9_-]{8,64}$/.test(pb.str(d, 9)) ? pb.str(d, 9) : ''),   // 当前协议为字段 11；兼容旧推送的字段 9，但不把 Cmd 子消息误当引用 ID
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
    let stableTimer = null   // 连接稳定计时：存活够久才把 retry 归零
    let slowTimer = null     // 达到重连上限后的静默慢速重试
    let retry = 0
    let manualClose = false
    let cappedNoted = false   // 「已达上限」提示只标注一次，避免慢速重试循环里 error 无限 append

    // 「连上即断」循环是「一直重连中」的真根因：onopen 无条件把 retry 归零，
    // 服务端因 token 失效/被踢而秒断时，retry 永远累加不到上限 → status 永远停在 retry。
    // 对策：连接需**稳定存活** STABLE_MS 才算真正连上、才归零 retry；秒断则 retry 继续累加，
    // 到上限转 closed（消息走轮询兜底），之后每 SLOW_RETRY_MS 静默重试，成功才转 online。
    const STABLE_MS = 10000
    const SLOW_RETRY_MS = 30000

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
      // 每代 socket 用闭包自引用：重连时旧 socket 的 onclose 会**异步**晚到，
      // 若不校验身份，它会把新连接的引用清空并误入黄色重连循环（reconnect 竞态根因）
      const my = socket
      my.binaryType = 'arraybuffer'

      my.onopen = () => {
        if (socket !== my) return
        state.status = 'online'
        clearTimeout(slowTimer); slowTimer = null
        log('已连接，发送登录包')
        sendJson({
          seq: seq(), cmd: 'login',
          data: { userId: auth.state.user?.id, token: api.token, platform: 'Web', deviceId: auth.deviceId || deviceId() },
        })
        clearInterval(hbTimer)
        hbTimer = setInterval(() => sendJson({ seq: seq(), cmd: 'heartbeat', data: {} }), hbMs)
        // 稳定计时：存活够久才认为「真的连上了」，把重连计数归零；
        // 若在此期间被秒断，onclose 会清掉这个计时器，retry 得以继续累加
        clearTimeout(stableTimer)
        stableTimer = setTimeout(() => { if (socket === my) { retry = 0; cappedNoted = false; state.error = '' } }, STABLE_MS)
      }

      my.onmessage = ev => {
        if (socket !== my) return
        state.lastAt = Date.now()
        if (typeof ev.data === 'string') return onText(ev.data)
        return onBinary(new Uint8Array(ev.data))
      }

      my.onclose = () => {
        if (socket !== my) return          // 旧代 socket 的迟到回调，忽略
        state.status = 'closed'
        clearInterval(hbTimer)
        clearTimeout(stableTimer)          // 秒断：取消「稳定归零」，retry 继续累加
        socket = null
        log('连接关闭')
        if (!manualClose) scheduleRetry()
      }

      my.onerror = () => { if (socket === my) { state.error = 'websocket error'; log('连接错误') } }
    }

    function scheduleRetry(err?: any) {
      retry = retry + 1
      if (err) state.error = err.message || String(err)
      // 快速重连达到上限：转 closed（消息走轮询兜底，不再刷屏「重连中」），
      // 但后台仍每 SLOW_RETRY_MS 静默重试一次——网络恢复/token 刷新后能自动回到 online，
      // 而不是永久停在「已断开」需要用户手动点。
      if (retry >= 6) {
        state.status = 'closed'
        // 只标注一次：慢速重试每 30s 失败都会再进这里，无条件 append 会让 error 无限增长
        if (!cappedNoted) {
          state.error = (state.error || '') + '（快速重连已达上限，消息走轮询兜底；后台仍在尝试，也可点状态点手动重连）'
          cappedNoted = true
        }
        log('重连达上限，转轮询兜底 + 慢速重试')
        clearTimeout(slowTimer)
        slowTimer = setTimeout(connect, SLOW_RETRY_MS)
        return
      }
      state.status = 'retry'
      const delay = Math.min(1500 * retry, 15000)
      log(`${delay}ms 后重连（第 ${retry} 次）`)
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, delay)
    }

    function close() {
      manualClose = true
      cappedNoted = false
      clearInterval(hbTimer)
      clearTimeout(retryTimer)
      clearTimeout(slowTimer)
      clearTimeout(stableTimer)
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
      reconnect: () => { close(); retry = 0; connect() },   // 手动重连：重置计数，重新快速重连
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
