/**
 * session / event 服务 —— 对标 Koishi 的 `ctx.session(...)` 与统一事件层
 *
 *   // ① 拿一个能直接发的会话对象（不传参 = 绑定当前会话 + 当前机器人）
 *   const s = ctx.session()
 *   await s.send('你好')          // s.reply(...) 也行
 *
 *   // ② 由一条原始云湖消息造 Session（插件处理推送时常用）
 *   const s2 = ctx.session({ id, chatId, chatType, senderId, ... })
 *
 *   // ③ 统一事件层（比裸 ctx.on 多一份历史 + 便捷查询）
 *   const off = ctx.event.on('message-created', (session) => { ... })
 *   ctx.event.emit('我的事件', { ... })
 *   ctx.event.history()          // 最近的事件流（控制台「事件」页用）
 *   ctx.event.last('message-created')
 *
 * 依赖：api / chat / bots / satori（都来自 adapter 与 chat 插件）
 */
import type { Context } from '../core/context'
import type { Session } from '../satori/session'

/** 会被自动记进事件历史的通道 */
const WATCH = [
  'message-created', 'message-updated', 'message-recalled',
  'auth/login', 'auth/logout', 'auth/ready',
  'chat/open', 'chat/incoming', 'chat/reply',
  'ws/raw',
]

export const sessionEventPlugin = {
  name: 'session',
  inject: ['chat', 'bots', 'satori'],
  provide: ['session', 'event'],

  apply(ctx: Context) {
    /* ---------------- ctx.session ---------------- */

    /**
     * 造一个 Session。
     *   ctx.session()                        → 当前会话 + 当前机器人（可直接 send/reply）
     *   ctx.session(convLike)                → 指定会话（{id,type,name}）
     *   ctx.session(rawMsg, { chatType })    → 由一条原始消息造
     */
    function session(input?: any, options: any = {}): Session | null {
      const bot: any = (ctx as any).bots?.[0]
      if (!bot) return null

      // 情况一：原始消息（有 chatId / senderId 字段）
      if (input && (input.chatId !== undefined || input.senderId !== undefined)) {
        const chatType = options.chatType ?? input.chatType ?? 2
        return (ctx as any).satori.session(input, chatType)
      }

      // 情况二/三：会话对象 或 不传（取当前会话）
      const cur = input?.id ? input : (ctx as any).chat?.state?.current
      if (!cur) return null
      const channel = { id: String(cur.id), type: (cur.type ?? 2) as 1 | 2 | 3, name: cur.name, avatar: cur.avatar }
      const me = (ctx as any).auth?.state?.user
      const user = me?.id ? { id: me.id, name: me.name, avatar: me.avatar } : { id: bot.id, name: '' }
      const s: Session = bot.toSession(channel, user, {
        id: options.id || '',
        content: '',
        elements: [],
        timestamp: Date.now(),
      })
      /**
       * ⚠️ 走 Bot 直接发的话，服务端收到了但**本地列表不会上屏**
       *    （chat.send 才有乐观上屏），使用者会以为自己没发出去。
       *    所以：目标是「当前会话」且内容是纯文本时，改走 chat.send。
       */
      const rawSend = s.send.bind(s)
      s.send = async (content: any) => {
        const cur = (ctx as any).chat?.state?.current
        const isCurrent = cur && String(cur.id) === String(channel.id)
        if (isCurrent && typeof content === 'string') {
          await (ctx as any).chat.send(content)
          return
        }
        await rawSend(content)
      }
      ;(s as any).reply = (content: any) => s.send(content)
      ;(s as any).rawSend = rawSend
      return s
    }

    /* ---------------- ctx.event ---------------- */

    const history: Array<{ type: string; t: number; payload: any; text?: string }> = []
    const MAX = 300

    const event = {
      /** 事件历史（默认 300 条） */
      get history() { return history },

      /** 记一条事件（外部也可手动记） */
      record(type: string, payload?: any) {
        let text = ''
        try {
          text = payload?.content ?? payload?.user?.name ?? ''
          if (typeof text !== 'string') text = JSON.stringify(text).slice(0, 80)
        } catch { text = '' }
        history.unshift({ type, t: Date.now(), payload, text })
        if (history.length > MAX) history.pop()
        return history.length
      },

      /**
       * 订阅事件。返回取消函数。
       *   const off = ctx.event.on('message-created', (session) => {})
       */
      on(type: string, cb: (payload: any) => void): () => void {
        return ctx.on(type as any, cb)
      },

      once(type: string, cb: (payload: any) => void): () => void {
        return ctx.once(type as any, cb)
      },

      /** 触发事件：既走 cordis 原生事件，也记进历史 */
      emit(type: string, payload?: any) {
        event.record(type, payload)
        ctx.emit(type as any, payload)
      },

      /** 取最近一条（可指定类型） */
      last(type?: string) {
        return type ? history.find((h) => h.type === type) : history[0]
      },

      /** 取某类型最近 n 条 */
      list(type?: string, n = 50) {
        const arr = type ? history.filter((h) => h.type === type) : history
        return arr.slice(0, n)
      },

      /** 某类型出现过多少次 */
      count(type: string) { return history.filter((h) => h.type === type).length },

      clear() { history.splice(0); },

      /** 各类事件的计数快照（方便做状态展示） */
      stats() {
        const m: Record<string, number> = {}
        for (const h of history) m[h.type] = (m[h.type] || 0) + 1
        return m
      },
    }

    // 自动把已知事件记进历史
    for (const name of WATCH) {
      ctx.on(name as any, (payload: any) => event.record(name, payload))
    }

    ctx.set('session', session)
    ctx.set('event', event)

    ctx.logger?.info('session / event 服务已就绪（ctx.session() / ctx.event.on|emit|history）')
  },
}
