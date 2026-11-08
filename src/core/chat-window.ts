import { watch } from 'vue'
import type { Context } from './context'

export type DetachedConversation = { id: string; type: number; name: string; avatar?: string }
type ChatWindowContext = Context & { lock?: { isLocked: boolean } }
type HostedWindow = { bus: BroadcastChannel; conversation: DetachedConversation; focused: boolean }
const windows = new Map<string, HostedWindow>()
const pending = new Set<string>()
const native = () => (window as any).__TAURI__
const channelName = (sessionId: string) => 'yh-chat-window-' + sessionId
const keyOf = (c: { id: string; type: number }) => c.type + ':' + c.id
export const supportsChatWindows = () => !!native()?.core?.invoke && typeof BroadcastChannel === 'function'
export const detachedConversationFocused = (channel: DetachedConversation) => {
  for (const entry of windows.values()) if (entry.focused && keyOf(entry.conversation) === keyOf(channel)) return true
  return false
}

function forget(sessionId: string) {
  windows.get(sessionId)?.bus.close()
  windows.delete(sessionId)
}
function shutDownWindows() {
  for (const [id, entry] of windows) {
    entry.bus.postMessage({ kind: 'close' })
    forget(id)
  }
}

export function installChatWindowHost(ctx: Context) {
  if (!supportsChatWindows()) return
  // A reload or account change invalidates every bridge from the previous session.
  void native().core.invoke('close_chat_windows').catch(() => {})
  void native().event?.listen('chat-window-closed', ({ payload }: any) => forget(payload)).catch(() => {})
  ctx.on('auth/logout', () => {
    shutDownWindows()
    void native().core.invoke('close_chat_windows').catch(() => {})
  })
  ctx.on('ws/message', (event: any) => {
    const msg = event.msg, type = Number(msg.chatType) || 2
    const self = ctx.auth.state.user?.id
    const id = type === 1 && String(msg.chatId) === String(self)
      ? (String(msg.senderId) !== String(self) ? msg.senderId : msg.recvId) : msg.chatId
    for (const entry of windows.values()) {
      if (entry.conversation.id === String(id) && entry.conversation.type === type) entry.bus.postMessage({ kind: 'ws', event })
    }
  })
  ctx.on('ws/draft', (data: any) => {
    for (const entry of windows.values()) if (entry.conversation.id === String(data.chatId)) entry.bus.postMessage({ kind: 'draft', data })
  })
  watch(() => !!ctx.ws?.online, online => {
    for (const entry of windows.values()) entry.bus.postMessage({ kind: 'ws-state', online })
  })
  window.addEventListener('pagehide', shutDownWindows, { once: true })
}

export async function openChatWindow(ctx: ChatWindowContext, conversation: DetachedConversation) {
  const id = String(conversation.id), type = Number(conversation.type)
  if (!supportsChatWindows() || ctx.auth.state.status !== 'ready' || ctx.lock?.isLocked) return
  const key = keyOf({ id, type })
  if (pending.has(key)) return
  pending.add(key)
  const sessionId = crypto.randomUUID()
  const bus = new BroadcastChannel(channelName(sessionId))
  const account = String(ctx.auth.state.user?.id)
  const entry: HostedWindow = { bus, conversation: { id, type, name: String(conversation.name || id), avatar: conversation.avatar }, focused: false }
  windows.set(sessionId, entry)
  bus.onmessage = ({ data }) => {
    if (data?.kind === 'closed') { forget(sessionId); return }
    const user = ctx.auth.state.user
    if (ctx.auth.state.status !== 'ready' || String(user?.id) !== account || ctx.lock?.isLocked) {
      bus.postMessage({ kind: 'close' }); forget(sessionId); return
    }
    if (data?.kind === 'hello') bus.postMessage({ kind: 'session', conversation: entry.conversation,
      user: { id: user.id, name: user.name, avatar: user.avatar }, token: ctx.api.token, online: !!ctx.ws?.online })
    if (data?.kind === 'focus') {
      entry.focused = data.active === true
      if (entry.focused) ctx.ui?.dismissMessages?.(k => k === 'chat:' + key)
    }
    if (data?.kind === 'send-draft' && typeof data.text === 'string') ctx.ws?.sendDraft(id, data.text.slice(0, 200000))
    if ((data?.kind === 'open-post' || data?.kind === 'open-board') && Number.isSafeInteger(data.id) && data.id > 0) {
      const title = String(data.title || '').slice(0, 300)
      if (data.kind === 'open-board') void ctx.community?.openSharedBoard(data.id, title)
      else void ctx.community?.openSharedPost({ id: data.id, title })
      void native().window?.getAllWindows?.().then((items: any[]) => items.find(win => win.label === 'main')?.setFocus()).catch(() => {})
    }
  }
  try {
    const created = await native().core.invoke('open_chat_window', { chatType: type, chatId: id, title: entry.conversation.name, sessionId })
    if (!created) forget(sessionId)
  } catch (error) {
    forget(sessionId)
    ctx.ui?.toast('无法打开独立会话：' + String(error), 'error')
  } finally { pending.delete(key) }
}

export function connectChatWindow(sessionId: string) {
  return new BroadcastChannel(channelName(sessionId))
}
export function closeCurrentChatWindow() {
  return native().core.invoke('close_current_chat_window') as Promise<void>
}
