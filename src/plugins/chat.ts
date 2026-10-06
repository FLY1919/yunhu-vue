/**
 * chat 插件
 * 提供 ctx.chat：会话列表 / 消息 / 发送 / 实时接收 / 选择态 / 引用态 / 菜单动作注册
 * 消息统一走 Satori 元素树，不再直接碰云湖的 content_type
 * 依赖：api、auth；可选使用 adapter 提供的 ctx.bots
 */
import { reactive, watch , toRaw } from 'vue'
import Schema from 'schemastery'
import type { Context, Disposer } from '../core/context'
import { parse, render, toText, h, ContentType } from '../satori/element'
import ChatPage from '../console/pages/ChatPage.vue'
import StatusUnread from '../console/components/StatusUnread.vue'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  order?: number
  danger?: boolean
  /** 返回 false 则不显示（payload 视菜单位置而定） */
  when?: (payload: any) => boolean
}
export interface ActionImpl {
  action: (payload: any) => any
  disabled?: (payload: any) => boolean
}

/** 消息摘要（用于会话列表预览） */
export function previewOf(m: any): string {
  if (m.recalled) return '[已撤回]'
  return (m.elements ? toText(m.elements) : (m.content?.text || '')).slice(0, 40)
}

export const name = 'chat'

export interface ChatCfg {
  pollMs: number
  pageSize: number
}

/** 配置构型：控制台据此生成表单 */
export const chatConfig: Schema<ChatCfg> = Schema.object({
  pollMs: Schema.number().default(4000).description('轮询间隔（毫秒），调大省流、调小更实时'),
  pageSize: Schema.number().default(30).description('每次拉取的消息条数'),
})

export const chatPlugin = {
  Config: chatConfig,
  name: 'chat',
  inject: ['api', 'auth'],
  provide: ['chat'],

  apply(ctx: Context, config: any = {}) {
    const api = ctx.api
    const auth = ctx.auth
    const pollMs = config.pollMs ?? 4000
    const maxMessages = config.maxMessages ?? 200

    const state = reactive({
      conversations: [] as any[],
      current: null as any,
      messages: [] as any[],
      loadingConvs: false,
      loadingMsgs: false,
      loadingMore: false,
      hasMore: true,
      searching: false,
      searchWord: '',
      searchResults: [] as any[],
      sending: false,
      keyword: '',
      /* ---- 多选态 ---- */
      selecting: false,
      selected: [] as string[],
      /* ---- 引用态 ---- */
      reply: null as null | { id: string; sender: string; preview: string },
      /* ---- 上下文菜单当前目标消息 id ---- */
      menuFor: null as string | null,
    })

    /* ---------------- 菜单 & 动作注册表 ----------------
     * 与 ctx.console.menu/action 同构：任何插件都能往消息菜单里塞条目，
     * 卸载时自动移除（绑定到调用方上下文）。
     */
    /**
     * ⚠️ Vue 响应式陷阱：composers/menus/slots/renderers 都是 reactive 容器，
     *    从里面读出来的元素是**代理对象**，和注册时传进来的原对象不是同一个引用，
     *    所以 `arr.includes(原对象)` 永远是 false —— 卸载时过滤不掉，残留一堆按钮。
     *    统一用 toRaw 比较（或者按 id 比较）。
     */
    const same = (a: any, b: any) => toRaw(a) === toRaw(b)

    const menus = reactive<Record<string, MenuItem[]>>({})
    const actions = new Map<string, ActionImpl>()

    /* ---------------- 气泡渲染器注册表 ----------------
     * 「消息气泡插件化」：每种消息类型/元素类型的渲染函数都能由插件注册，
     *   ctx.chat.renderer('video', { match: (m) => m.type === 10, render: ... })
     * UI 渲染气泡时先查这里，没人认领才走内置兜底。
     */
    const renderers = reactive<any[]>([])
    const chatRenderer = {
      /** config: { id, order?, match(ctx): boolean, render: 组件, props?(ctx) } */
      renderer(config: any, owner: any = ctx): Disposer {
        const entry = { order: 100, ...config }
        renderers.push(entry)
        renderers.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        return owner.effect(() => () => {
          const i = renderers.findIndex((x) => same(x, entry))
          if (i >= 0) renderers.splice(i, 1)
        })
      },
      /** 找到第一个认领这条消息的渲染器 */
      rendererFor(payload: any) {
        for (const r of renderers) {
          try { if (r.match(payload)) return r } catch { /* 忽略 */ }
        }
        return null
      },
      renderersOf() { return renderers },
    }

    /* ---------------- 会话分组（本地）注册表 ----------------
     * 分组完全存本地 localStorage，云湖没有这个接口。
     */
    const LS_GROUPS = 'yunhu.conv.groups'
    const LS_ASSIGN = 'yunhu.conv.assign'
    const convGroups = reactive({
      groups: JSON.parse(localStorage.getItem(LS_GROUPS) || '[]') as Array<{ id: string; name: string }>,
      assign: JSON.parse(localStorage.getItem(LS_ASSIGN) || '{}') as Record<string, string>,   // convId -> groupId
      collapsed: JSON.parse(localStorage.getItem('yunhu.conv.collapsed') || '[]') as string[],
      editing: false,
    })
    function saveGroups() {
      localStorage.setItem(LS_GROUPS, JSON.stringify(convGroups.groups))
      localStorage.setItem(LS_ASSIGN, JSON.stringify(convGroups.assign))
      localStorage.setItem('yunhu.conv.collapsed', JSON.stringify(convGroups.collapsed))
    }
    const groupApi = {
      groups: convGroups,
      addGroup(name: string) {
        const n = name.trim(); if (!n) return
        if (convGroups.groups.some((g) => g.name === n)) return
        convGroups.groups.push({ id: 'g' + Date.now().toString(36), name: n })
        saveGroups()
      },
      removeGroup(id: string) {
        convGroups.groups = convGroups.groups.filter((g) => g.id !== id)
        for (const [c, g] of Object.entries(convGroups.assign)) if (g === id) delete convGroups.assign[c]
        saveGroups()
      },
      /** 把会话放进分组（groupId 为空 = 移出分组） */
      assignTo(convId: string, groupId: string) {
        if (groupId) convGroups.assign[convId] = groupId
        else delete convGroups.assign[convId]
        saveGroups()
      },
      groupOf(convId: string) { return convGroups.assign[convId] || '' },
      toggleCollapse(id: string) {
        const i = convGroups.collapsed.indexOf(id)
        if (i >= 0) convGroups.collapsed.splice(i, 1)
        else convGroups.collapsed.push(id)
        saveGroups()
      },
      isCollapsed(id: string) { return convGroups.collapsed.includes(id) },
      /** 侧栏渲染用：分组 + 未分组 */
      sections(list: any[]) {
        const byGroup: Record<string, any[]> = {}
        const rest: any[] = []
        for (const c of list) {
          const g = convGroups.assign[c.id]
          if (g && convGroups.groups.some((x) => x.id === g)) (byGroup[g] = byGroup[g] || []).push(c)
          else rest.push(c)
        }
        return {
          groups: convGroups.groups.map((g) => ({ ...g, items: byGroup[g.id] || [] })),
          ungrouped: rest,
        }
      },
    }

    /* ---------------- 输入区按钮注册表 ----------------
     * 理念「万物皆插件」：连输入框上方那排按钮都不是写死的，
     * 任何插件都可以 chat.composer('composer', [...]) 往里塞按钮，
     * 卸载插件按钮就消失。UI 只负责把这一行渲染出来（可横向滑动）。
     */
    const composers = reactive<Record<string, any[]>>({})
    const composerBar = {
      /** group 目前用 'composer'；items: { id, label, icon?, order?, onSelect(api), when?() } */
      composer(group: string, items: any[], owner: any = ctx): Disposer {
        if (!composers[group]) composers[group] = []
        for (const it of items) {
          const i = composers[group].findIndex((x: any) => x.id === it.id)
          if (i >= 0) composers[group][i] = it
          else composers[group].push(it)
        }
        composers[group] = [...composers[group]].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        // ⚠️ 必须用**调用方的 ctx** 注册 effect：用 chat 自己的 ctx 的话，
        //    卸载那个插件时这些按钮不会被回滚（之前就是这样漏的）
        const ids = new Set(items.map((i: any) => i.id))
        return owner.effect(() => () => {
          composers[group] = (composers[group] || []).filter((x: any) => !ids.has(x.id))
        })
      },
      /** 按条件移除按钮（插件重新注册一批按钮时用来清旧的） */
      composerRemove(group: string, pred: (item: any) => boolean): void {
        if (!composers[group]) return
        composers[group] = composers[group].filter((x: any) => !pred(x))
      },
      composerOf(group: string) {
        return (composers[group] || []).filter((i: any) => !i.when || i.when())
      },
    }

    /* ---------------- 插槽（对标 Koishi 的 ctx.slot / <k-slot>） ----------------
     * 任何插件都能往聊天页的固定位置注入自己的组件：
     *   ctx.chat.slot({ type: 'chat-header-extra', component: MyBtn, order: 100 })
     * UI 只在对应位置放一个 <ChatSlot name="chat-header-extra" />，
     * 具体渲染什么完全由插件决定 —— 页面因此是可被其他插件改造的。
     * 目前提供的插槽位：
     *   chat-header-extra  聊天标题栏右侧
     *   chat-sidebar-top   会话列表顶部
     *   chat-sidebar-bottom会话列表底部
     *   chat-before-composer 输入区上方
     *   global             整个聊天页
     */
    const slots = reactive<Record<string, any[]>>({})
    const chatSlot = {
      slot(config: { type: string; component: any; props?: any; order?: number; disabled?: () => boolean }, owner: any = ctx): Disposer {
        const entry = { order: 100, ...config }
        if (!slots[entry.type]) slots[entry.type] = []
        slots[entry.type] = [...slots[entry.type], entry].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        return owner.effect(() => () => {
          slots[entry.type] = (slots[entry.type] || []).filter((x: any) => !same(x, entry))
        })
      },
      slotsOf(type: string) { return (slots[type] || []).filter((s: any) => !s.disabled || !s.disabled()) },
    }

    const chatMenu = {
      /** 注册菜单条目：group 例如 'message' | 'selection'
       *  按 id 覆盖式登记 —— 插件重载时不会堆出重复按钮 */
      menu(group: string, items: MenuItem[], owner: any = ctx): Disposer {
        if (!menus[group]) menus[group] = []
        for (const it of items) {
          const i = menus[group].findIndex(x => x.id === it.id)
          if (i >= 0) menus[group][i] = it
          else menus[group].push(it)
        }
        menus[group] = [...menus[group]].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        const ids = new Set(items.map((i) => i.id))
        return owner.effect(() => () => {
          menus[group] = (menus[group] || []).filter((x) => !ids.has(x.id))
        })
      },
      /** 实现一个动作 */
      action(id: string, impl: ActionImpl, owner: any = ctx): Disposer {
        actions.set(id, impl)
        return owner.effect(() => () => { if (actions.get(id) === impl) actions.delete(id) })
      },
      /** 取某个菜单下当前可见的条目（再按 id 去重一次，兜底） */
      menuOf(group: string, payload?: any): MenuItem[] {
        const seen = new Set<string>()
        return (menus[group] || [])
          .filter(i => !i.when || i.when(payload))
          .filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      },
      async run(id: string, payload?: any) {
        const impl = actions.get(id)
        if (!impl) return ctx.emit('ui/toast', { text: `未实现的动作：${id}`, type: 'warn' })
        if (impl.disabled?.(payload)) return
        return impl.action(payload)
      },
    }

    const filtered = () => {
      const k = state.keyword.trim().toLowerCase()
      if (!k) return state.conversations
      return state.conversations.filter(c =>
        (c.name || '').toLowerCase().includes(k) || c.id.includes(k) || (c.preview || '').toLowerCase().includes(k))
    }

    /** 给消息补上统一元素树 */
    const withElements = (m: any) => ({ ...m, elements: m.elements?.length ? m.elements : parse(m.content || {}, m.type) })

    async function loadConversations(silent = false) {
      if (state.loadingConvs) return
      state.loadingConvs = true
      try {
        const list = await api.conversations()
        list.sort((a: any, b: any) => b.ts - a.ts)
        state.conversations = list
      } catch (e: any) {
        if (!silent) ctx.emit('ui/toast', { text: '会话列表加载失败：' + e.message, type: 'error' })
      } finally { state.loadingConvs = false }
    }

    async function loadMessages(silent = false) {
      const cur = state.current
      if (!cur) return
      state.loadingMsgs = !silent
      try {
        const list = (await api.messages(cur.id, cur.type, 30)).map(withElements)
        const mine = auth.state.user?.id
        for (const m of list) if (m.right === undefined) m.right = m.senderId === mine
        const changed = list.length !== state.messages.length ||
          list[list.length - 1]?.id !== state.messages[state.messages.length - 1]?.id
        state.messages = list
        if (!silent || changed) ctx.emit('chat/scroll-bottom')
      } catch (e: any) {
        if (!silent) ctx.emit('ui/toast', { text: '消息加载失败：' + e.message, type: 'error' })
      } finally { state.loadingMsgs = false }
    }

    async function open(chat: any) {
      state.current = chat
      state.messages = []
      state.hasMore = true
      state.searchResults = []
      state.searchWord = ''
      clearReply()
      clearSelection()
      await loadMessages()
      api.dismiss(chat.id).catch(() => {})
      const hit = state.conversations.find((c: any) => c.id === chat.id)
      if (hit) { hit.unread = 0; hit.at = false }
      ctx.emit('chat/open', chat)
    }

    /** 上滑加载更多历史 */
    async function loadMore() {
      const cur = state.current
      if (!cur || state.loadingMore || !state.hasMore) return
      const oldest = state.messages[0]
      if (!oldest) return
      state.loadingMore = true
      try {
        const older = (await api.messagesBefore(cur.id, cur.type, oldest.id, 30)).map(withElements)
        const mine = auth.state.user?.id
        for (const m of older) if (m.right === undefined) m.right = m.senderId === mine
        const ids = new Set(state.messages.map((m: any) => m.id))
        state.messages = [...older.filter((m: any) => !ids.has(m.id)), ...state.messages]
        state.hasMore = older.length >= 30
      } catch (e: any) {
        ctx.emit('ui/toast', { text: '加载历史失败：' + e.message, type: 'error' })
      } finally { state.loadingMore = false }
    }

    /** 聊天记录搜索 */
    async function search(word: string) {
      const cur = state.current
      if (!cur) return []
      if (!word.trim()) { state.searchResults = []; return [] }
      state.searching = true
      try {
        state.searchWord = word
        state.searchResults = await api.searchChat({ word, chatId: cur.id, chatType: cur.type, size: 30 })
        return state.searchResults
      } catch (e: any) {
        ctx.emit('ui/toast', { text: '搜索失败：' + e.message, type: 'error' })
        return []
      } finally { state.searching = false }
    }

    /* ---------------- 选择态 ---------------- */
    function isSelected(id: string) { return state.selected.includes(id) }
    function toggleSelect(id: string) {
      const i = state.selected.indexOf(id)
      if (i >= 0) state.selected.splice(i, 1)
      else state.selected.push(id)
      if (!state.selected.length) state.selecting = false
      ctx.emit('chat/selection', state.selected.slice())
    }
    function startSelecting(id?: string) {
      state.selecting = true
      if (id) toggleSelect(id)
      ctx.emit('chat/selection', state.selected.slice())
    }
    function selectAll() {
      state.selecting = true
      state.selected = state.messages.map((m: any) => m.id)
      ctx.emit('chat/selection', state.selected.slice())
    }
    function clearSelection() {
      state.selecting = false
      state.selected = []
      ctx.emit('chat/selection', [])
    }

    /* ---------------- 引用态 ---------------- */
    function setReply(msg: any) {
      state.reply = { id: msg.id, sender: msg.sender, preview: previewOf(msg) }
      ctx.emit('chat/reply', state.reply)
    }
    function clearReply() {
      state.reply = null
      ctx.emit('chat/reply', null)
    }

    /* ---------------- 消息操作 ---------------- */
    /** 撤回：只允许撤回自己的消息（服务端也会校验） */
    async function recall(ids: string[]) {
      const cur = state.current
      if (!cur || !ids.length) return
      await api.recall(cur.id, cur.type, ids)
      for (const id of ids) {
        const m = state.messages.find((x: any) => x.id === id)
        if (m) m.recalled = true
      }
      clearSelection()
      ctx.emit('ui/toast', { text: `已撤回 ${ids.length} 条消息`, type: 'success' })
    }

    /** 转发到一批会话 */
    async function forward(ids: string[], targets: Array<{ id: string; type: number; name?: string }>) {
      const cur = state.current
      if (!cur || !ids.length || !targets.length) return
      for (const id of ids) {
        await api.forward(id, cur.type, targets.map(t => ({ id: t.id, type: t.type })))
      }
      clearSelection()
      ctx.emit('ui/toast', {
        text: `已转发 ${ids.length} 条到 ${targets.map(t => t.name || t.id).join('、')}`,
        type: 'success',
      })
    }

    /** 发送：走统一机器人接口，元素树由适配器转成云湖协议 */
    async function send(text: string, contentType: number = ContentType.text) {
      const cur = state.current
      const me = auth.state.user
      if (!cur || !String(text ?? '').trim()) return
      const quoteId = state.reply?.id
      state.sending = true
      try {
        const elements = contentType === ContentType.markdown ? [h.markdown(text)]
          : contentType === ContentType.html ? [h.html(text)]
            : [h.text(text)]
        const quoted = quoteId ? state.messages.find((m: any) => m.id === quoteId) : null
        const quoteText = quoted ? `${quoted.sender}: ${previewOf(quoted)}` : ''
        const bot = (ctx as any).bots?.[0]
        let id: string
        if (bot) id = await bot.sendMessage({ id: cur.id, type: cur.type }, elements, cur.type, { quoteId, quoteText })
        else {
          const { contentType: ct, content } = render(elements)
          if (quoteText) content.quote_msg_text = quoteText
          id = await api.send(cur.id, cur.type, ct, content, { quoteId })
        }
        clearReply()

        // 服务端不回推自己发的消息：乐观上屏 + 稍后对账
        state.messages.push({
          id, senderId: me?.id, sender: me?.name || '我', avatar: me?.avatar,
          type: contentType, content: { text }, elements, ts: Date.now(), right: true, pending: true,
          quoteId,
        })
        ctx.emit('chat/scroll-bottom')
        setTimeout(() => { if (state.current?.id === cur.id) loadMessages(true) }, 1200)
      } catch (e: any) {
        ctx.logger?.error('发送失败:', e.message)
        ctx.emit('ui/toast', { text: '发送失败：' + e.message, type: 'error' })
        throw e
      } finally { state.sending = false }
    }

    /**
     * 编辑消息：只允许编辑自己的文本类消息。
     * 编辑后本地也标记 edited，界面上会显示「已编辑」。
     */
    async function edit(msgId: string, text: string) {
      const cur = state.current
      if (!cur || !text.trim()) return
      const m = state.messages.find((x: any) => x.id === msgId)
      const ct = m?.type === 3 ? 3 : m?.type === 8 ? 8 : 1
      await api.editMessage(cur.id, cur.type, msgId, ct, { text: text.trim() })
      if (m) { m.content = { ...(m.content || {}), text: text.trim() }; m.edited = true; m.elements = null }
      ctx.emit('ui/toast', { text: '已修改并同步', type: 'success' })
    }

    /** 发送任意元素（图片/文件/视频等） */
    async function sendMedia(elements: any[]) {
      const cur = state.current
      if (!cur || !elements?.length) return
      const bot = (ctx as any).bots?.[0]
      if (bot) await bot.sendMessage({ id: cur.id, type: cur.type }, elements)
      else {
        const { contentType, content } = render(elements)
        await api.send(cur.id, cur.type, contentType, content)
      }
      setTimeout(() => { if (state.current?.id === cur.id) loadMessages(true) }, 1200)
    }

    /** 统一会话事件写入本地状态 */
    function applySession(session: any, kind = 'created') {
      const msg = session.raw || {}
      const mine = session.user.id === auth.state.user?.id
      const m = {
        id: session.id,
        chatId: session.channel.id,
        senderId: session.user.id,
        sender: session.user.name,
        avatar: session.user.avatar,
        tags: session.tags || [],
        type: msg.type,
        content: msg.content || {},
        elements: session.elements,
        ts: session.timestamp,
        right: mine,
        recalled: !!session.recalled,
        edited: kind === 'updated' || !!session.edited,
      }
      const isCurrent = state.current && session.channel.id === state.current.id
      if (isCurrent) {
        const i = state.messages.findIndex((x: any) => x.id === m.id)
        if (i >= 0) state.messages[i] = { ...state.messages[i], ...m }
        else {
          state.messages.push(m)
          if (state.messages.length > maxMessages) state.messages.splice(0, state.messages.length - maxMessages)
          ctx.emit('chat/scroll-bottom')
        }
      }
      const conv = state.conversations.find((c: any) => c.id === session.channel.id)
      if (conv) {
        conv.preview = previewOf(m)
        conv.ts = session.timestamp
        if (!isCurrent && kind === 'created') conv.unread = (conv.unread || 0) + 1
        const idx = state.conversations.indexOf(conv)
        if (idx > 0) { state.conversations.splice(idx, 1); state.conversations.unshift(conv) }
      } else if (kind === 'created') {
        loadConversations(true)
      }
      if (!isCurrent && !mine && kind === 'created') ctx.emit('chat/incoming', m)
    }

    const chat = {
      state, filtered, loadConversations, loadMessages, loadMore, search, open, send, sendMedia, edit, previewOf,
      /* 选择态 */
      isSelected, toggleSelect, startSelecting, selectAll, clearSelection,
      get selectedMessages() { return state.messages.filter((m: any) => state.selected.includes(m.id)) },
      /* 引用态 */
      setReply, clearReply,
      /* 操作 */
      recall, forward,
      /* 菜单/动作 */
      ...chatMenu,
      /* 输入区按钮 */
      ...composerBar,
      /* 插槽 */
      ...chatSlot,
      /* 气泡渲染器（消息气泡插件化） */
      ...chatRenderer,
      /* 会话分组（本地） */
      ...groupApi,
      close: () => { state.current = null; state.messages = [] },
    }

    /* ---- 订阅统一事件（Satori 风格） ---- */
    ctx.on('message-created', (s: any) => applySession(s, 'created'))
    ctx.on('message-updated', (s: any) => applySession(s, 'updated'))
    ctx.on('message-recalled', (s: any) => applySession(s, 'recalled'))

    /* ---- 轮询兜底 ---- */
    ctx.effect(() => {
      let timer: any = null, tick = 0
      const stop = () => { if (timer) { clearInterval(timer); timer = null } }
      const unwatch = watch(() => auth.state.status, (s: string) => {
        stop()
        if (s !== 'ready') { state.conversations = []; state.current = null; state.messages = []; return }
        loadConversations(true)
        timer = setInterval(() => {
          if (document.hidden) return
          tick++
          if ((ctx as any).ws?.online && tick % 5 !== 0) return
          loadConversations(true)
          if (state.current) loadMessages(true)
        }, pollMs)
      }, { immediate: true })
      return () => { unwatch(); stop() }
    })

    /* 输入区按钮由插件贡献 —— 这批是 chat 插件自带的 */
    chat.composer('composer', [
      { id: 'type.text', kind: 'type', value: 1, label: '文本', order: 10 },
      { id: 'type.md', kind: 'type', value: 3, label: 'Markdown', order: 11 },
      { id: 'type.html', kind: 'type', value: 8, label: 'HTML', order: 12 },
      { id: 'att.image', kind: 'image', label: '图片', order: 30 },
      { id: 'att.file', kind: 'file', label: '文件', order: 31 },
    ])

    ctx.set('chat', chat)

    /* ---- 控制台扩展 ---- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addListener('chat/summary', () => ({
        conversations: state.conversations.length,
        unread: state.conversations.reduce((n: number, c: any) => n + (c.unread || 0), 0),
        current: state.current?.name || null,
      }))
      ctx.console.addEntry((cc: any) => {
        cc.page({ name: '聊天', path: '/', icon: 'chat', order: 10, component: ChatPage })
        cc.slot({ type: 'status-left', component: StatusUnread, order: 10 })
      })
    })
  },
}
