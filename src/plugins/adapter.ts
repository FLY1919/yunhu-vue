/**
 * adapter 插件 —— 云湖适配器（把云湖协议转成 Satori 风格）
 * ------------------------------------------------------------------
 * · 提供 ctx.bots：统一的机器人对象，插件用 bot.sendMessage(channel, content) 发消息
 * · 把收到的云湖推送转成 Session，并广播统一事件：
 *     ctx.on('message-created', session => …)
 *     ctx.on('message-updated' | 'message-recalled' | 'notice', session => …)
 * · 提供 ctx.satori：元素解析 / 渲染工具（parse / render / toText）
 */
import { reactive } from 'vue'
import type { Context } from '../core/context'
import { Bot, makeSession } from '../satori/session'
import type { Channel, Session, User } from '../satori/session'
import * as Satori from '../satori/element'
import type { Element } from '../satori/element'
import EventsPage from '../console/pages/EventsPage.vue'

export const adapterPlugin = {
  name: 'adapter',
  inject: ['api', 'auth'],
  provide: ['bots', 'satori'],

  apply(ctx: Context, config: any = {}) {
    const api = ctx.api
    const auth = ctx.auth
    const state = reactive({ bots: [] as string[], events: 0, lastAt: 0 })

    /** 最近事件流（控制台「事件」页展示） */
    const events = reactive<any[]>([])
    const pushEvent = (type: string, session?: Session | null, extra: any = {}) => {
      events.unshift({
        type, t: Date.now(),
        channel: session?.channel?.name || session?.channel?.id || '',
        user: session?.user?.name || session?.user?.id || '',
        content: session?.content?.slice(0, 120) || '',
        ...extra,
      })
      if (events.length > 200) events.pop()
      state.events++
      state.lastAt = Date.now()
    }

    /* ---------------- 机器人 ---------------- */
    let bot: Bot | null = null
    const bots: Bot[] = []

    function ensureBot(user: any) {
      if (!user?.id) return
      const self: User = { id: user.id, name: user.name, avatar: user.avatar, isVip: user.vip }
      bot = new Bot(
        user.id,
        self,
        async (channel: Channel, elements: Element[], options: any = {}) => {
          const { contentType, content } = Satori.render(elements)
          if (options.quoteText) content.quote_msg_text = options.quoteText
          return api.send(channel.id, channel.type, contentType, content, {
            quoteId: options.quoteId,
          })
        },
        async (channel: Channel, msgId: string) => { await api.recall(channel.id, channel.type, msgId) },
      )
      bots.length = 0
      bots.push(bot)
      state.bots = [bot.sid]
      ctx.logger?.info(`adapter 就绪：${bot.sid}`)
    }

    ctx.on('auth/login', (user: any) => ensureBot(user))
    ctx.on('auth/logout', () => { bots.length = 0; bot = null; state.bots = [] })
    if (auth.state.user) ensureBot(auth.state.user)

    /* ---------------- 收消息：云湖推送 -> Session ---------------- */
    function toSession(msg: any, chatType: number): Session | null {
      if (!bot) return null
      const channel: Channel = { id: msg.chatId, type: (chatType || 2) as 1 | 2 | 3, name: msg.name, avatar: msg.avatar }
      const user: User = { id: msg.senderId, name: msg.sender, avatar: msg.avatar }
      const elements = Satori.parse(msg.content || {}, msg.type)
      return makeSession(bot, channel, user, {
        id: msg.id,
        content: msg.content?.text ?? Satori.toText(elements),
        elements,
        timestamp: msg.ts || Date.now(),
        quoteId: msg.quoteId,
        recalled: !!msg.recallTs,
        edited: !!msg.editTs,
        raw: msg,
        tags: msg.tags,
      } as any)
    }

    ctx.on('ws/message', ({ cmd, msg }: any) => {
      const session = toSession(msg, msg.chatType)
      if (!session) return
      if (msg.recallTs) { pushEvent('message-recalled', session); ctx.emit('message-recalled', session); return }
      if (cmd === 'edit_message' || msg.editTs) { pushEvent('message-updated', session); ctx.emit('message-updated', session); return }
      pushEvent('message-created', session)
      ctx.emit('message-created', session)
    })

    ctx.on('ws/draft', (d: any) => pushEvent('draft', null, { channel: d.chatId, content: d.input }))
    ctx.on('ws/stream', (s: any) => pushEvent('stream', null, { channel: s.chatId, content: s.delta }))

    /* ---------------- 对外服务 ---------------- */
    const satori = {
      ...Satori,
      /** 把一条原始云湖消息转成 Session（供历史消息/轮询使用） */
      session(msg: any, chatType = 2) { return toSession(msg, chatType) },
      /** 元素数组 -> { contentType, content } */
      render: Satori.render,
      parse: Satori.parse,
      toText: Satori.toText,
    }

    ctx.set('bots', bots)
    ctx.set('satori', satori)
    ctx.set('adapter', { state, events, bot: () => bot })

    ctx.effect(() => () => { bots.length = 0; state.bots = [] })

    /* ---------------- 控制台扩展：事件流页面 ---------------- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addListener('adapter/events', () => ({ events: events.slice(0, 100), count: state.events }))
      ctx.console.addEntry((cc: any) => {
        cc.page({ name: '事件', path: '/events', icon: 'activity', order: 300, component: EventsPage })
      })
    })
  },
}
