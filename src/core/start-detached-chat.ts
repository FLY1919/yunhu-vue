import { createApp } from 'vue'
import { ctx, bootstrap } from '../app'
import DetachedChatWindow from '../components/DetachedChatWindow.vue'
import { closeCurrentChatWindow, connectChatWindow, type DetachedConversation } from './chat-window'

type ChatWindowSession = {
  conversation: DetachedConversation
  user: { id: string; name: string; avatar?: string }
  token: string
  online: boolean
}
export async function startDetachedChat(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !(window as any).__TAURI__?.core?.invoke) {
    throw new Error('无效的独立会话地址')
  }
  const bus = connectChatWindow(sessionId)
  const root = document.getElementById('app')!
  root.textContent = '正在连接会话…'
  let shuttingDown = false
  let online = false
  const close = () => {
    shuttingDown = true
    bus.close()
    void closeCurrentChatWindow().catch(() => window.close())
  }
  const focus = () => {
    if (!shuttingDown) bus.postMessage({ kind: 'focus', active: !document.hidden && document.hasFocus() })
  }
  window.addEventListener('focus', focus)
  window.addEventListener('blur', focus)
  document.addEventListener('visibilitychange', focus)
  window.addEventListener('pagehide', () => {
    if (!shuttingDown) bus.postMessage({ kind: 'focus', active: false })
    shuttingDown = true
    bus.close()
  }, { once: true })
  const session = await new Promise<ChatWindowSession>((resolve, reject) => {
    const hello = () => bus.postMessage({ kind: 'hello' })
    const interval = setInterval(hello, 300)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      bus.close()
      reject(new Error('主窗口未响应，请关闭后从会话列表重新打开'))
    }, 8000)
    bus.onmessage = ({ data }) => {
      if (data?.kind === 'close') { clearTimeout(timeout); clearInterval(interval); close(); return }
      if (data?.kind !== 'session' || !data.token || !data.user?.id || !data.conversation?.id) return
      clearTimeout(timeout); clearInterval(interval); resolve(data)
    }
    hello()
  })
  online = session.online === true
  bus.onmessage = ({ data }) => {
    if (data?.kind === 'close') { close(); return }
    if (ctx.auth?.state.status !== 'ready') return
    if (data?.kind === 'ws') ctx.emit('ws/message', data.event)
    if (data?.kind === 'draft') ctx.emit('ws/draft', data.data)
    if (data?.kind === 'ws-state') {
      online = data.online === true
      if (online) ctx.emit('ws/draft-ready')
    }
  }
  await bootstrap(session.conversation)
  if (shuttingDown) return
  const app = createApp(DetachedChatWindow)
  app.provide('ctx', ctx)
  app.provide('openDetachedArticle', (post: any) => bus.postMessage({ kind: 'open-post', id: post.id, title: post.title }))
  app.provide('openDetachedBoard', (id: number, title?: string) => bus.postMessage({ kind: 'open-board', id, title }))
  ctx.set('ws', {
    get online() { return online },
    sendDraft(_chatId: string, text: string) {
      if (shuttingDown || !online) return false
      bus.postMessage({ kind: 'send-draft', text })
      return true
    },
  } as any)
  ctx.api.setToken(session.token)
  ctx.storage.setAccount?.(String(session.user.id))
  ctx.auth.state.user = session.user
  ctx.auth.state.status = 'ready'
  ctx.emit('auth/login', session.user)
  ctx.console.goto('/')
  app.mount(root)
  void ctx.chat.open(session.conversation)
  if (online) ctx.emit('ws/draft-ready')
  focus()
}
