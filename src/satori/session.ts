/**
 * Satori 风格会话 / 机器人抽象
 * 插件只认 Session 和 Bot，不关心底下是云湖还是别的平台。
 */
import type { Element, Attrs } from './element'
import { normalizeMessage, toText } from './element'

export type ChatTypeValue = 1 | 2 | 3 // user | group | bot

export interface Channel {
  id: string
  type: ChatTypeValue
  name?: string
  avatar?: string
}

export interface User {
  id: string
  name?: string
  avatar?: string
  isVip?: boolean
}

export interface Message {
  id: string
  content: string
  elements: Element[]
  timestamp: number
  quoteId?: string
  recalled?: boolean
  edited?: boolean
  raw?: any
  /** 发送者的群头衔（云湖 Sender.tag） */
  tags?: Array<{ id?: number; text: string; color?: string }>
}

export interface Session extends Message {
  platform: 'yunhu'
  selfId: string
  user: User
  channel: Channel
  bot: Bot
  isDirect: boolean
  guildId?: string
  /** 统一回复入口 */
  send(content: string | Element[]): Promise<void>
}

/** 机器人（统一发送接口） */
export class Bot {
  platform = 'yunhu' as const
  constructor(
    public id: string,
    public user: User,
    private sendImpl: (channel: Channel, elements: Element[], options?: Attrs) => Promise<string>,
    private recallImpl?: (channel: Channel, msgId: string) => Promise<void>,
  ) {}

  get sid(): string { return `${this.platform}:${this.id}` }

  /** 发送消息；channel 可以是 {id,type} 或直接的 id（默认群聊） */
  async sendMessage(channel: string | Channel, content: string | Element[], type: ChatTypeValue = 2, options: Attrs = {}): Promise<string> {
    const ch: Channel = typeof channel === 'string' ? { id: channel, type } : channel
    return this.sendImpl(ch, normalizeMessage(content), options)
  }

  async recall(channel: string | Channel, msgId: string, type: ChatTypeValue = 2): Promise<void> {
    const ch: Channel = typeof channel === 'string' ? { id: channel, type } : channel
    if (this.recallImpl) await this.recallImpl(ch, msgId)
  }

  toSession(channel: Channel, user: User, message: Message): Session {
    return makeSession(this, channel, user, message)
  }
}

export function makeSession(bot: Bot, channel: Channel, user: User, message: Message): Session {
  return {
    platform: 'yunhu',
    selfId: bot.id,
    user,
    channel,
    bot,
    isDirect: channel.type === 3 || channel.type === 1,
    guildId: channel.type === 2 ? channel.id : undefined,
    id: message.id,
    content: message.content ?? toText(message.elements),
    elements: message.elements,
    timestamp: message.timestamp,
    quoteId: message.quoteId,
    recalled: message.recalled,
    edited: message.edited,
    raw: message.raw,
    tags: (message as any).tags,
    send: async (content: string | Element[]) => { await bot.sendMessage(channel, content) },
  }
}
