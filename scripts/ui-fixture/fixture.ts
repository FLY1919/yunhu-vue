// 只使用虚拟账号和本地数据，挂载真实组件及聊天服务。
import { createApp, reactive, markRaw } from 'vue'
import Console from '../../src/console/Console.vue'
import ChatPage from '../../src/console/pages/ChatPage.vue'
import AccountConfigPage from '../../src/console/pages/AccountConfigPage.vue'
import ContactsPage from '../../src/console/pages/ContactsPage.vue'
import { stickersConfig } from '../../src/plugins/stickers'
import { chatPlugin } from '../../src/plugins/chat'
import { lockPlugin } from '../../src/plugins/lock'
import { uiPlugin } from '../../src/plugins/ui'
import { userBotPlugin } from '../../src/plugins/userbot'
import { apiPlugin } from '../../src/plugins/api'
import { socialPlugin } from '../../src/plugins/social'
import { installAiPanelHost } from '../../src/core/ai-panel'
import FloatingAiPanel from '../../src/components/FloatingAiPanel.vue'
import { sanitizeHtml } from '../../src/core/render'
import '../../src/styles.css'
import '../../src/styles-m3.css'

const listeners = new Map<string, Set<any>>(), cleanups: any[] = []
const ts = Date.now()
const conversations = [
  { id: 'normal', type: 2, name: '云湖群', preview: '普通未读', unread: 2, ts },
  { id: 'pin', type: 2, name: '云湖置顶', preview: '置顶已读', unread: 0, ts: ts - 10 },
  { id: 'other', type: 2, name: '其他会话', preview: '云湖相关摘要', unread: 0, ts: ts + 10 },
  { id: 'pin-unread', type: 2, name: '另一个置顶', preview: '置顶未读', unread: 1, ts: ts - 20 },
]
const messages = [
  { id: 'target', chatId: 'normal', chatType: 2, type: 8, ts, senderId: 'test-user', sender: '虚拟用户',
    content: { text: '<div id="forced-color" style="color:#050505!important;background:#422466;padding:12px;border-radius:8px;opacity:.1"><span style="color:black">主题文字</span> <a id="theme-link" href="https://example.com" style="color:purple!important">主题链接</a></div>' },
    tags: [{ id: 'tag-blue', text: '开发者', color: '#2196f322' }, { id: 'tag-yellow', text: '群成员', color: '#ffff00' }, { id: 'wrong-group', groupId: 'different-group', text: '其他群的标签', color: '#2196f3' }] },
  { id: 'reply', chatId: 'normal', chatType: 2, type: 1, ts: ts + 1, senderId: 'test-user', sender: '虚拟用户',
    quoteId: 'target', content: { text: '引用消息', quote_msg_id: 'target', quote_msg_text: '虚拟用户: 主题文字' } },
]
const picture = document.createElement('canvas'); picture.width = 120; picture.height = 80
const pixels = picture.getContext('2d')!; pixels.fillStyle = '#ed4f64'; pixels.fillRect(0, 0, 120, 80); pixels.fillStyle = '#2763d3'; pixels.fillRect(60, 0, 60, 80)
messages.push({ id: 'sticker-test', chatId: 'normal', chatType: 2, type: 7, ts: ts + 2, senderId: 'test-user', sender: '虚拟用户', content: {}, elements: [{ type: 'sticker', attrs: { src: picture.toDataURL(), packId: 5, itemId: 9 } }] } as any)
const ctx: any = {
  api: { base: '/offline', token: '', conversations: async () => conversations.map(c => ({ ...c })),
    messages: async () => messages.map(m => ({ ...m })), messagesBefore: async () => [], messagesAround: async () => messages,
    dismiss: async () => {}, homeSearch: async () => ({ users: Array.from({ length: 10 }, (_, i) => ({ id: 'u' + i, name: '我的云湖群' + i })), groups: [{ id: 'exact', name: '云湖群' }] }),
    self: async () => ({ id: 'me', name: '离线测试', coin: 100 }), getUser: async () => ({}), getMyProfile: async () => ({}), userClients: async () => [], coinRecords: async () => [] },
  auth: { state: reactive({ status: 'guest', user: { id: 'me', name: '离线测试', coin: 100 }, savedAccounts: [{ id: 'me', name: '离线测试' }, { id: 'spare', name: '备用账号', email: 'spare@example.test' }] }), logout() {}, loadAccounts: async () => {}, switchAccount: async () => { throw new Error('离线凭据无效') }, login: async () => { throw new Error('离线登录失败') }, loginWithToken: async () => { throw new Error('离线凭据无效') } },
  storage: { load: async () => ({}), save: async () => {} },
  ws: { state: reactive({ status: 'idle' }), reconnect() {} },
  group: { state: reactive({ dockOpen: false, panelOpen: false, board: null, allBoards: [], members: [], bots: [], tags: [] }), tagsOf: () => [], openProfile() {} },
  cfg: { state: reactive({ data: { plugins: {} }, dirty: false }), load: async () => {}, toYaml: () => 'plugins: {}' },
  app: { version: '1.0.8', schemas: () => [{ key: 'chat', schema: chatPlugin.Config }, { key: 'stickers', schema: stickersConfig }] },
  social: { state: reactive({ book: { users: ['MAX', '角野敬行', 'Future Tasks', '哈哈', '小林', '云湖朋友'].map((name, i) => ({ id: String(6428130 + i), name, remark: i === 2 ? '工作提醒' : name })), groups: [{ id: 'normal', name: '云湖群', level: 100 }], bots: [{ id: 'bot-1', name: '提醒助手' }] }, requests: [], loading: false }), loadBook: async () => {}, loadRequests: async () => {}, apply: async () => {}, createGroup: async () => 'created', chatTypeOf: (tab: string) => tab === 'groups' ? 2 : tab === 'bots' ? 3 : 1 },
  stickers: { packRequests: [] as any[], openPackOf(data: any) { this.packRequests.push(data) } },
  console: { state: reactive({ currentPage: '/', slots: [], menus: {} }),
    pages: [
      { path: '/', name: '消息', icon: 'chat', component: markRaw(ChatPage) },
      { path: '/account', name: '账号与配置', icon: 'settings', component: markRaw(AccountConfigPage) },
      { path: '/config', name: '账号与配置', icon: 'settings', component: markRaw(AccountConfigPage) },
      { path: '/contacts', name: '通讯录', icon: 'contacts', component: markRaw(ContactsPage) },
    ], goto(path: string) { this.state.currentPage = path } },
  logger: { error: console.error, info() {} },
  on(name: string, fn: any) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); return () => listeners.get(name)?.delete(fn) },
  emit(name: string, ...args: any[]) { for (const fn of listeners.get(name) || []) fn(...args) },
  set(key: string, value: any) { ctx[key] = value }, effect(fn: any) { const off = fn(); if (off) cleanups.push(off) }, inject() {},
}
uiPlugin.apply(ctx)
ctx.auth.state.user.avatar = '/scripts/ui-fixture/animated.gif'
if (new URLSearchParams(location.search).has('security')) { ctx.get = (k: string) => ctx[k]; lockPlugin.apply(ctx) }
chatPlugin.apply(ctx)
ctx.chat.state.conversations = conversations.map(c => ({ ...c }))
ctx.chat.togglePin('pin'); ctx.chat.togglePin('pin-unread')
ctx.chat.toggleMute('pin-unread')
if (new URLSearchParams(location.search).has('groupcreate')) {
  const wire: any = { set(k: string, value: any) { this[k] = value } }
  apiPlugin.apply(wire, { base: '/qa-api' })
  ctx.api.createGroup = wire.api.createGroup
  ctx.api.addressBook = () => new Promise(() => {}) // Deliberately stalled refresh, independent of creation.
  ctx.api.friendRequests = async () => []
  ctx.get = (k: string) => ctx[k]
  ctx.setTimeout = () => () => {}
  ctx.console.addEntry = () => {}
  socialPlugin.apply(ctx)
}
if (new URLSearchParams(location.search).has('userbot') && !new URLSearchParams(location.search).has('ai-panel')) {
  ctx.console.pages = reactive(ctx.console.pages)
  ctx.console.addEntry = (register: any) => register({ page: (page: any) => ctx.console.pages.push(markRaw(page)), slot: (slot: any) => ctx.console.state.slots.push(markRaw(slot)) })
  ctx.bots = [{ id: 'me', sendMessage: async () => 'sent' }]
  userBotPlugin.apply(ctx)
  installAiPanelHost(ctx)
}
document.documentElement.dataset.platform = 'web'
const panelSession = new URLSearchParams(location.search).get('ai-panel')
const app = panelSession ? createApp(FloatingAiPanel, { sessionId: panelSession }) : createApp(Console); app.provide('ctx', ctx); app.mount('#app')
;(window as any).__qa = { ctx, sanitizeHtml, messages }
window.addEventListener('beforeunload', () => { app.unmount(); for (const cleanup of cleanups.reverse()) cleanup() })
