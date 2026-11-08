/**
 * chat 插件
 * 提供 ctx.chat：会话列表 / 消息 / 发送 / 实时接收 / 选择态 / 引用态 / 菜单动作注册
 * 消息统一走 Satori 元素树，不再直接碰云湖的 content_type
 * 依赖：api、auth；可选使用 adapter 提供的 ctx.bots
 */
import { resourceMode } from '../core/resource-mode'
import { samePollMessage } from '../core/message-equality'
import { computed, reactive, watch, toRaw } from 'vue'
import Schema from 'schemastery'
import type { Context, Disposer } from '../core/context'
import { parse, render, h, ContentType } from '../satori/element'
import ChatPage from '../console/pages/ChatPage.vue'
import StatusUnread from '../console/components/StatusUnread.vue'
import { createComposerDrafts } from '../core/composer-drafts'
import { messagePreview, messageQuote } from '../core/message-preview'
import { rankSearchResults } from '../core/search'
import { detachedConversationFocused } from '../core/chat-window'
import { createRecallCache, hasRecallBody } from '../core/recall-cache'

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
  return messagePreview(m).slice(0, 40)
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
  inject: ['api', 'auth', 'storage', 'ui'],
  provide: ['chat'],

  apply(ctx: Context, config: any = {}) {
    const api = ctx.api
    const auth = ctx.auth
    const storage = (ctx as any).storage
    const detached = config.detachedConversation
    const pollMs = config.pollMs ?? 4000
    const messageLimit = () => config.maxMessages ?? (resourceMode.economy ? 80 : 200)
    const drafts = createComposerDrafts({owner:()=>auth.state.user?.id,send:(channel,text)=>{try{return !!ctx.ws?.sendDraft(channel.id,text)}catch{return false}}})
    ctx.on('ws/draft',data=>drafts.receive(String(data.chatId),String(data.input??'')))
    ctx.on('ws/draft-ready',()=>drafts.flush())
    let viewVersion = 0
    let viewAbort = new AbortController()
    let messageAbort: AbortController | undefined
    let locateAbort: AbortController | undefined
    function invalidateView() {
      viewVersion++
      viewAbort.abort()
      viewAbort = new AbortController()
      messageAbort?.abort()
      messageAbort = undefined
      cancelLocate()
      return viewVersion
    }
    let messageRequest = 0
    let messageFlightVersion = -1
    let searchRequest = 0
    let locateRequest = 0
    let disposed = false
    let accountVersion = 0
    let liveVersion = 0
    let windowMinimized = false
    let windowFocused = true
    const liveRevisions = new Map<string, number>()
    const conversationRevisions = new Map<string, number>()
    const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const inView = (cur: any, version: number) => !disposed && !!cur && toRaw(state.current) === toRaw(cur) && viewVersion === version
    function scheduleReconcile(cur: any) {
      const version = viewVersion
      const key = `${cur.type}:${cur.id}`
      clearTimeout(reconcileTimers.get(key))
      reconcileTimers.set(key, setTimeout(() => {
        reconcileTimers.delete(key)
        if (inView(cur, version)) loadMessages(true)
      }, 1200))
    }

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
      /* 搜索跳转到历史位置后置 true；顶栏显示「回到最新」入口，loadMessages/open 时清除 */
      jumpedAway: false,
      /* 搜索定位的目标消息 id：持续色块指示（引用式高亮框），open/回最新时清除 */
      locateId: null as string | null,
      locatingId: null as string | null,
      locatePages: 0,
      /* ---- 多选态 ---- */
      selecting: false,
      selected: [] as string[],
      /* ---- 引用态 ---- */
      reply: null as null | { id: string; sender: string; preview: string; image?: string },
      /* ---- 上下文菜单当前目标消息 id ---- */
      menuFor: null as string | null,
    })
    const messagesById = computed(() => new Map(state.messages.map(m => [m.id, m])))
    const findMessage = (id: string) => messagesById.value.get(id)

    // A selected conversation is only read while its chat page is actually visible in the foreground.
    const viewingConversation = () => !!state.current && !document.hidden && !windowMinimized && windowFocused && document.hasFocus?.() !== false
      && !(ctx as any).lock?.isLocked
      && (!ctx.console || ctx.console.state.currentPage === '/')
    // 仅前台且有焦点时静音当前会话；失焦后允许通知，锁定时在投递层统一禁用。
    const showingConversation = (channel: any) => detachedConversationFocused(channel) || (state.current?.id === channel.id && state.current?.type === channel.type
      && (!ctx.console || ctx.console.state.currentPage === '/') && !document.hidden && !windowMinimized && windowFocused && document.hasFocus?.() !== false && !(ctx as any).lock?.isLocked)
    function readCurrent() {
      if (!viewingConversation()) return
      const cur = state.current
      const hit = state.conversations.find(c => c.id === cur.id && c.type === cur.type)
      if (hit) { hit.unread = 0; hit.at = false }
      scheduleDismiss(cur.id)
    }
    ctx.on('app/unlock' as any, readCurrent)

    const preferences = reactive({ antiRecall: localStorage.getItem('yh.chat.antiRecall') === 'true' })
    const recallCache = createRecallCache(storage, () => auth.state.user?.id || '', () => preferences.antiRecall)
    // History loaded after enabling is not itself a newly received message.
    let recallCaptureSince = preferences.antiRecall ? Date.now() : Infinity
    function captureFromPoll(m: any) {
      const ts = Number(m?.ts)
      const millis = ts > 0 && ts < 1e12 ? ts * 1000 : ts
      return Number.isFinite(millis) && millis >= recallCaptureSince
    }
    const messageWindows = new Map<string, any[]>()
    const channelKey = (c: any) => `${c.type}:${c.id}`
    function rememberWindow() {
      if (!state.current) return
      const key = channelKey(state.current)
      messageWindows.delete(key)
      const cached = state.messages.slice(-messageLimit())
      if (cached.length) messageWindows.set(key, cached)
      const limit = resourceMode.economy ? 320 : 1200
      let count = [...messageWindows.values()].reduce((total, window) => total + window.length, 0)
      for (const [id, messages] of messageWindows) {
        if (count <= limit && messageWindows.size <= 30) break
        messageWindows.delete(id)
        count -= messages.length
      }
    }
    function hasBody(content: any) {
      return ['text', 'image_url', 'image', 'video_url', 'audio_url', 'file_url', 'form', 'post_id', 'post_content', 'tip', 'call_status_text']
        .some(k => content?.[k] !== undefined && content[k] !== null && String(content[k]).length > 0)
    }
    function mergeMessage(m: any, channel = state.current, previous?: any, capture = false) {
      const contentPresent = hasBody(m.content) || (m.elements?.length && !m.content)
      const next = previous ? { ...previous, ...m,
        ...(contentPresent ? {} : { content: previous.content, elements: previous.elements }),
        recalled: !!(m.recalled || previous.recalled),
        sender: m.sender || previous.sender, senderId: m.senderId || previous.senderId,
        avatar: m.avatar || previous.avatar, ts: m.ts || previous.ts,
        tags: m.tags?.length ? m.tags : previous.tags,
        quoteId: m.quoteId || previous.quoteId,
      } : m
      return recallCache.merge(channel, withElements(next), capture && !detached)
    }
    function setAntiRecall(value: boolean) {
      if (value && !preferences.antiRecall) recallCaptureSince = Date.now()
      preferences.antiRecall = value
      localStorage.setItem('yh.chat.antiRecall', String(value))
      if (value && auth.state.user?.id) void recallCache.ready()
    }
    async function clearRecallCache() {
      await recallCache.clear()
      for (const m of state.messages) m.retainedRecall = false
      for (const messages of messageWindows.values()) for (const m of messages) m.retainedRecall = false
    }
    ctx.on('auth/login', () => {
      recallCaptureSince = preferences.antiRecall ? Date.now() : Infinity
      if (preferences.antiRecall) void recallCache.ready()
    })
    if (preferences.antiRecall && auth.state.user?.id) void recallCache.ready()
    ctx.on('auth/logout', () => { recallCaptureSince = Infinity; recallCache.reset(); messageWindows.clear() })
    ctx.effect(() => () => recallCache.dispose())

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
    const groupKey = (key: string) => auth.state.user?.id ? key + ':' + auth.state.user.id : key
    function readGroup(key: string, fallback: any) {
      try {
        const owner = String(auth.state.user?.id || '')
        const legacyOwner = localStorage.getItem('yunhu.conv.legacyOwner')
        const raw = localStorage.getItem(groupKey(key)) ?? ((!owner || legacyOwner === owner) ? localStorage.getItem(key) : null)
        return raw ? JSON.parse(raw) : fallback
      } catch { return fallback }
    }
    function groupPreferences() {
      return {
        groups: readGroup(LS_GROUPS, []) as Array<{ id: string; name: string }>,
        assign: readGroup(LS_ASSIGN, {}) as Record<string, string>,
        collapsed: readGroup('yunhu.conv.collapsed', []) as string[],
        pinnedCollapsed: !!readGroup('yunhu.conv.pinnedCollapsed', false),
        pinned: readGroup('yunhu.conv.pinned', []) as string[],
        hidden: readGroup('yunhu.conv.hidden', []) as string[],
        muted: readGroup('yunhu.conv.muted', []) as string[],
        marked: readGroup('yunhu.conv.markunread', []) as string[],
      }
    }
    const convGroups = reactive({
      ...groupPreferences(),
      pinMode: localStorage.getItem('yunhu.conv.pinMode') === 'tabs' ? 'tabs' : 'top',
      editing: false,
    })
    function saveGroups() {
      const keys = { groups: LS_GROUPS, assign: LS_ASSIGN, collapsed: 'yunhu.conv.collapsed', pinnedCollapsed: 'yunhu.conv.pinnedCollapsed', pinned: 'yunhu.conv.pinned', hidden: 'yunhu.conv.hidden', muted: 'yunhu.conv.muted', marked: 'yunhu.conv.markunread' }
      for (const [key, storageKey] of Object.entries(keys)) localStorage.setItem(groupKey(storageKey), JSON.stringify(convGroups[key]))
    }
    ctx.on('auth/login', () => {
      if (!localStorage.getItem('yunhu.conv.legacyOwner')) localStorage.setItem('yunhu.conv.legacyOwner', String(auth.state.user?.id || ''))
      Object.assign(convGroups, groupPreferences(), { editing: false })
      saveGroups()
    })
    /** 标记未读（本地角标，打开会话时清除） */
    function markUnread(convId: string) {
      if (!convGroups.marked.includes(convId)) convGroups.marked.push(convId)
      saveGroups()
      const c = state.conversations.find((x: any) => x.id === convId)
      if (c) c.unread = Math.max(c.unread || 0, 1)
    }
    const pendingConversationSettings = new Map<string, Record<string, boolean>>()
    const conversationsById = computed(() => {
      const byId = new Map<string, any>()
      for (const conversation of state.conversations) if (!byId.has(conversation.id)) byId.set(conversation.id, conversation)
      return byId
    })
    const findConv = (id: string) => conversationsById.value.get(id)
    const isMuted = (id: string) => findConv(id)?.noDisturb ?? convGroups.muted.includes(id)
    const isPinned = (id: string) => findConv(id)?.pinned ?? convGroups.pinned.includes(id)
    async function updateConversationFlag(id: string, field: 'pinned' | 'noDisturb') {
      const c = findConv(id)
      if (pendingConversationSettings.has(id)) return
      const active = field === 'pinned' ? isPinned(id) : isMuted(id)
      const values = field === 'pinned' ? convGroups.pinned : convGroups.muted
      const original = values.slice()
      const index = values.indexOf(id)
      if (index >= 0) values.splice(index, 1)
      if (!active) values.push(id)
      if (c) c[field] = !active
      pendingConversationSettings.set(id, { [field]: !active })
      saveGroups()
      state.conversations = sortConvs(state.conversations)
      if (field === 'noDisturb' && !active) {
        cancelPendingNotification(id)
        ctx.ui?.dismissMessages((key: string) => key === `chat:${c?.type}:${id}`)
      }
      try {
        if (field === 'pinned' && c && api.setPinned) await api.setPinned(id, c.type, !active)
        if (field === 'noDisturb' && api.noNotify) await api.noNotify(id, !active)
      } catch (error: any) {
        const current = findConv(id)
        if (current) current[field] = active
        if (field === 'pinned') convGroups.pinned = original
        else convGroups.muted = original
        saveGroups()
        ctx.ui?.toast('会话设置失败：' + error.message, 'error')
      } finally { pendingConversationSettings.delete(id) }
    }
    const toggleMute = (id: string) => updateConversationFlag(id, 'noDisturb')
    // Local activity is an ordering signal only; never change the server message timestamp on open.
    const conversationActivity = reactive(new Map<string, number>())
    let activitySequence = 0
    let lastOpened = { key: '', sequence: 0 }
    function touchConversation(c: any) {
      const sequence = ++activitySequence
      conversationActivity.set(channelKey(c), sequence)
      return sequence
    }
    ctx.on('auth/logout', () => {
      conversationActivity.clear(); activitySequence = 0; lastOpened = { key: '', sequence: 0 }
    })
    /** Pins first; opening and genuinely new messages share the same recent-activity order. */
    function sortConvs(list: any[]) {
      const pinned = new Set(convGroups.pinned), marked = new Set(convGroups.marked)
      const priority = (c: any) => Number(c.pinned ?? pinned.has(c.id))
      return [...list].sort((a, b) => {
        const order = priority(b) - priority(a)
        if (order) return order
        const activity = (conversationActivity.get(channelKey(b)) || 0) - (conversationActivity.get(channelKey(a)) || 0)
        if (activity) return activity
        const unread = Number(b.unread > 0 || marked.has(b.id)) - Number(a.unread > 0 || marked.has(a.id))
        return unread || (b.ts || 0) - (a.ts || 0)
      })
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
      toggleMute, isMuted, markUnread,
      togglePin: (id: string) => updateConversationFlag(id, 'pinned'),
      isPinned,
      togglePinnedCollapse() { convGroups.pinnedCollapsed = !convGroups.pinnedCollapsed; saveGroups() },
      setPinMode(mode: string) {
        if (mode !== 'tabs' && mode !== 'top') return
        convGroups.pinMode = mode
        localStorage.setItem('yunhu.conv.pinMode', mode)
      },
      /** 删除会话（本地隐藏，不删云端聊天记录；云湖无删会话接口） */
      hideConv(convId: string) {
        if (!convGroups.hidden.includes(convId)) convGroups.hidden.push(convId)
        saveGroups()
        state.conversations = state.conversations.filter((c: any) => c.id !== convId)
        if (state.current?.id === convId) close()
      },
      restoreConv(convId: string) {
        convGroups.hidden = convGroups.hidden.filter((x: string) => x !== convId)
        saveGroups()
      },
      isHidden(convId: string) { return convGroups.hidden.includes(convId) },
      /** 侧栏渲染用：分组 + 未分组 */
      sections(list: any[], tab: 'unpinned' | 'pinned' = 'unpinned') {
        // 搜索按相关度呈现全部命中，不被分组、折叠或当前置顶 Tab 隐藏。
        if (state.keyword.trim()) return { groups: [], ungrouped: list, pinned: [], active: [] }
        const pinned: any[] = []
        const active: any[] = []
        const byGroup: Record<string, any[]> = {}
        const groupIds = new Set(convGroups.groups.map(group => group.id))
        const rest: any[] = []
        for (const c of list) {
          const pinnedConversation = isPinned(c.id)
          if (convGroups.pinMode === 'tabs') {
            if (pinnedConversation !== (tab === 'pinned')) continue
          } else if (pinnedConversation) {
            pinned.push(c)
            continue
          }
          if (!pinnedConversation && lastOpened.key && (channelKey(c) === lastOpened.key ||
            (conversationActivity.get(channelKey(c)) || 0) > lastOpened.sequence)) {
            active.push(c)
            continue
          }
          const g = convGroups.assign[c.id]
          if (g && groupIds.has(g)) (byGroup[g] = byGroup[g] || []).push(c)
          else rest.push(c)
        }
        return {
          groups: convGroups.groups.map((g) => ({ ...g, items: byGroup[g.id] || [] })),
          ungrouped: rest,
          pinned,
          active,
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
      // 阅读状态即时重排；搜索时在此基础上按相关度排序。
      return rankSearchResults(sortConvs(state.conversations), state.keyword, true)
    }

    /** 给消息补上统一元素树 */
    const withElements = (m: any) => ({ ...m, elements: m.elements?.length ? m.elements : parse(m.content || {}, m.type) })

    let conversationSnapshotReady = false
    const notificationFlights = new Set<string>()
    const notificationPollRetries = new Map<string, ReturnType<typeof setTimeout>>()
    const notificationPollEpochs = new Map<string, number>()
    type PendingNotification = { key: string; account: number; session: any; message: any; known: any; attempt: number; timer?: ReturnType<typeof setTimeout> }
    const pendingNotifications = new Map<string, PendingNotification>()
    const retryBase = Math.max(5, Number(config.notificationRetryMs) || 1500)
    function cancelPendingNotification(id: string, type?: number) {
      for (const [key, pending] of pendingNotifications) {
        if (String(pending.session.channel.id) === String(id) && (type === undefined || pending.session.channel.type === type)) {
          clearTimeout(pending.timer); pendingNotifications.delete(key)
        }
      }
      for (const kind of type === undefined ? [1, 2, 3] : [Number(type)]) {
        const key = `${accountVersion}:${kind}:${id}`
        clearTimeout(notificationPollRetries.get(key)); notificationPollRetries.delete(key)
        notificationPollEpochs.set(key, (notificationPollEpochs.get(key) || 0) + 1)
      }
      while (notificationPollEpochs.size > 1000) notificationPollEpochs.delete(notificationPollEpochs.keys().next().value)
    }
    async function pollNotification(channel: any, account: number, attempt = 0) {
      const key = `${account}:${channel.type}:${channel.id}`
      if (notificationFlights.has(key)) return
      clearTimeout(notificationPollRetries.get(key)); notificationPollRetries.delete(key)
      notificationFlights.add(key)
      const epoch = notificationPollEpochs.get(key) || 0
      try {
        const list = await api.messages(channel.id, channel.type, 1, { timeout: 5000 })
        if (disposed || account !== accountVersion || epoch !== (notificationPollEpochs.get(key) || 0) || isMuted(channel.id)) return
        const latest = list[list.length - 1]
        if (!latest?.id) throw new Error('最新消息尚未就绪')
        applySession({
          id: latest.id, channel, user: { id: latest.senderId, name: latest.sender, avatar: latest.avatar },
          timestamp: latest.ts, raw: latest, quoteId: latest.quoteId, elements: parse(latest.content || {}, latest.type),
        }, 'created', true)
      } catch {
        // 列表未读数已更新，即使后续计数不再变化也要重试，不能永久丢失这条通知。
        if (!disposed && account === accountVersion && epoch === (notificationPollEpochs.get(key) || 0) && !isMuted(channel.id) && attempt < 4) {
          notificationPollRetries.set(key, setTimeout(() => {
            notificationPollRetries.delete(key)
            void pollNotification(channel, account, attempt + 1)
          }, retryBase * 2 ** attempt))
        }
      }
      finally { notificationFlights.delete(key) }
    }
    async function loadConversations(silent = false) {
      if (state.loadingConvs) return
      const account = accountVersion
      state.loadingConvs = true
      try {
        const revision = liveVersion
        const list = await api.conversations(silent ? { timeout: 8000 } : undefined)
        if (disposed || account !== accountVersion) return
        for (const c of list) Object.assign(c, pendingConversationSettings.get(c.id) || {})
        const previous = new Map(state.conversations.map((c: any) => [`${c.type}:${c.id}`, c]))
        for (const c of list) {
          const key = `${c.type}:${c.id}`, old = previous.get(key)
          if (!old) continue
          c.pinned ??= old.pinned
          c.noDisturb ??= old.noDisturb
          if ((conversationRevisions.get(key) || 0) > revision) {
            c.unread = old.unread; c.at = old.at
            if (old.ts >= c.ts) { c.ts = old.ts; c.preview = old.preview }
          }
        }
        // 首次加载只建立基线，避免把启动前的历史未读当成新通知。
        const notify = !detached && conversationSnapshotReady ? list.filter((c: any) => {
          const old = previous.get(`${c.type}:${c.id}`)
          const unreadIncreased = c.unread > (old?.unread || 0)
          const newerUnread = old && c.unread > 0 && c.ts > old.ts
          return !(c.noDisturb ?? isMuted(c.id)) && !convGroups.hidden.includes(c.id) && (unreadIncreased || newerUnread)
        }) : []
        if (conversationSnapshotReady) {
          for (const c of list) {
            const old = previous.get(channelKey(c))
            if (old ? c.ts > old.ts || c.unread > (old.unread || 0) : c.unread > 0) touchConversation(c)
          }
        }
        conversationSnapshotReady = true
        // 本地隐藏（删除会话）过滤 + 置顶排序
        const hidden = new Set(convGroups.hidden), marked = new Set(convGroups.marked)
        const showing = viewingConversation()
        const current = state.current
        const shown = []
        for (const c of list) {
          if (hidden.has(c.id)) continue
          const isCurrent = current?.id === c.id && current.type === c.type
          if (showing && isCurrent) {
            const hadUnread = c.unread || c.at
            c.unread = 0; c.at = false
            if (hadUnread) scheduleDismiss(c.id)
          }
          if (!isCurrent && marked.has(c.id)) c.unread = Math.max(c.unread || 0, 1)
          const old = previous.get(channelKey(c))
          if (old) {
            for (const field of ['stickyId', 'pinSort']) if (!(field in c)) delete old[field]
            Object.assign(old, c)
          }
          shown.push(old || c)
        }
        const sorted = sortConvs(shown)
        if (sorted.length !== state.conversations.length || sorted.some((c, index) => c !== state.conversations[index])) {
          state.conversations = sorted
        }
        void saveSnapshot(sorted)
        // 少量并发补拉，避免一个慢会话阻塞所有其他会话。
        const queue = notify.slice()
        const workers = Math.min(queue.length, 4)
        for (let i = 0; i < workers; i++) void (async () => {
          while (queue.length && !disposed && account === accountVersion) await pollNotification(queue.shift(), account)
        })()
      } catch (e: any) {
        if (!silent && !disposed && account === accountVersion) ctx.emit('ui/toast', { text: '会话列表加载失败：' + e.message, 'type': 'error' })
      } finally { if (account === accountVersion) state.loadingConvs = false }
    }

    /**
     * 已读上报（dismiss）带失败重试：失败进队列，10s 冲一次直到成功。
     * 之前 .catch(()=>{}) 静默吞失败，服务端未读残留 → 切走/重启后红点复现。
     */
    const dismissQueue = new Set<string>()
    const dismissFlights = new Map<string, number>()
    const dismissAgain = new Set<string>()
    let dismissRetryTimer: any = null
    function dismissNow(id: string) {
      const account = accountVersion
      if (dismissFlights.get(id) === account) { dismissAgain.add(id); return }
      dismissFlights.set(id, account)
      api.dismiss(id).then(() => { if (account === accountVersion) dismissQueue.delete(id) }).catch(() => {
        if (disposed || account !== accountVersion) return
        dismissQueue.add(id)
        if (!dismissRetryTimer) dismissRetryTimer = setInterval(flushDismiss, 10000)
      }).finally(() => {
        if (dismissFlights.get(id) !== account) return
        dismissFlights.delete(id)
        if (dismissAgain.delete(id)) dismissNow(id)
      })
    }
    function flushDismiss() {
      if (!dismissQueue.size) { clearInterval(dismissRetryTimer); dismissRetryTimer = null; return }
      for (const id of dismissQueue) if (!dismissFlights.has(id)) dismissNow(id)
    }

    /** 当前会话收到新消息时防抖报已读；每个会话独立计时槽（单槽会在切会话时丢已读） */
    const dismissTimers = new Map<string, any>()
    function clearBackgroundWork() {
      accountVersion++
      clearInterval(dismissRetryTimer)
      dismissRetryTimer = null
      dismissQueue.clear()
      dismissFlights.clear()
      dismissAgain.clear()
      for (const timer of dismissTimers.values()) clearTimeout(timer)
      dismissTimers.clear()
      for (const timer of reconcileTimers.values()) clearTimeout(timer)
      reconcileTimers.clear()
      state.loadingConvs = false
      conversationSnapshotReady = false
      notificationFlights.clear()
      for (const timer of notificationPollRetries.values()) clearTimeout(timer)
      notificationPollRetries.clear()
      notificationPollEpochs.clear()
      for (const pending of pendingNotifications.values()) clearTimeout(pending.timer)
      pendingNotifications.clear()
      conversationRevisions.clear()
    }
    ctx.on('auth/logout', clearBackgroundWork)
    ctx.effect(() => clearBackgroundWork)
    function scheduleDismiss(id: string) {
      const old = dismissTimers.get(id)
      if (old) clearTimeout(old)
      dismissTimers.set(id, setTimeout(() => {
        dismissTimers.delete(id)
        if (state.current?.id === id && viewingConversation()) dismissNow(id)
      }, 2500))
    }

    /* ---- 会话缓存（storage.cache）：重启秒开列表 + 恢复上次会话 ---- */
    let cachePromise: Promise<any> | undefined
    let lastSnapAt = 0
    function ensureCache(): Promise<any> {
      return cachePromise ||= Promise.resolve(storage?.load('cache')).then(value => value || {}, () => ({}))
    }
    async function saveCurrentId(id: string | null, type?: number) {
      if (detached) return
      const version = viewVersion, account = accountVersion
      const c = await ensureCache()
      if (disposed || version !== viewVersion || account !== accountVersion) return
      c.currentId = id
      c.currentType = type ?? null
      await storage?.save('cache', c).catch(() => {})
    }
    /** 会话列表快照（30s 节流，避免轮询频繁写盘） */
    async function saveSnapshot(list: any[]) {
      if (detached) return
      const now = Date.now()
      if (now - lastSnapAt < 30000) return
      lastSnapAt = now
      const account = accountVersion
      const c = await ensureCache()
      if (disposed || account !== accountVersion) return
      c.convs = list.slice(0, 60).map((x: any) => ({
        id: x.id, name: x.name, avatar: x.avatar, type: x.type,
        ts: x.ts, unread: x.unread, at: x.at, preview: x.preview, pinned: x.pinned, noDisturb: x.noDisturb,
      }))
      await storage?.save('cache', c).catch(() => {})
    }
    ctx.on('auth/logout', () => { cachePromise = undefined; lastSnapAt = 0 })
    ctx.on('auth/logout', () => { invalidateView(); drafts.clear() })
    ctx.effect(() => () => {
      disposed = true; invalidateView(); drafts.clear()
      ctx.ui?.dismissMessages((key: string) => key.startsWith('chat:'))
    })

    async function loadMessages(silent = false) {
      const cur = state.current
      if (!cur) return
      const version = viewVersion
      // 轮询未完成时不叠加请求；主动重载仍可取代旧请求。
      if (silent && messageFlightVersion === version) return
      const request = ++messageRequest
      messageAbort?.abort()
      const controller = messageAbort = new AbortController()
      const liveAtStart = liveVersion
      messageFlightVersion = version
      if (!silent) { state.jumpedAway = false; state.locateId = null }   // 主动重载=回最新
      state.loadingMsgs = !silent
      try {
        if (preferences.antiRecall) await recallCache.ready()
        if (controller.signal.aborted) return
        const response = await api.messages(cur.id, cur.type, 30, { signal: controller.signal })
        if (!inView(cur, version) || request !== messageRequest) return
        const existing = messagesById.value
        const list = response.map((m: any) => { const old = existing.get(String(m.id)); return samePollMessage(m, old) ? old : mergeMessage(m, cur, undefined, captureFromPoll(m)) })
        const since = list.length ? Math.min(...list.map((m: any) => m.ts || Infinity)) : 0
        for (const m of recallCache.recalled(cur, since)) if (!list.some((x: any) => x.id === m.id)) list.push(m)
        if (!inView(cur, version) || request !== messageRequest) return
        const mine = auth.state.user?.id
        for (const m of list) if (m.right === undefined) m.right = m.senderId === mine
        // E7：增量合并而非整表替换 —— 保留用户上滑加载的历史；
        // 仅当用户本来贴在底部时才自动滚到底（翻历史时不打断）。
        const added = []
        for (const m of list) {
          const old = existing.get(m.id)
          if (!old) { added.push(m); continue }
          if (m === old) continue
          const liveKey = `${channelKey(cur)}:${m.id}`
          if ((liveRevisions.get(liveKey) || 0) <= liveAtStart) Object.assign(old, mergeMessage(m, cur, old), { pending: false })
        }
        if (added.length) {
          const latest = state.messages.at(-1)
          if (!latest || added.every(m => m.ts >= latest.ts)) state.messages.push(...added.sort((a, b) => a.ts - b.ts))
          else state.messages = [...state.messages, ...added].sort((a, b) => a.ts - b.ts)
          // 翻历史时保留阅读窗口，不能因后台轮询删掉最上方的旧消息。
          if (atBottom() && !state.jumpedAway && state.messages.length > messageLimit()) state.messages.splice(0, state.messages.length - messageLimit())
          // pending 只在对应服务端 ID 确认后清除，避免新消息把未对账的发送吞掉。
          // 主动打开/刷新会话时，即便旧 DOM 的滚动事件刚把贴底状态改成 false，也要展示最新消息。
          // 定位历史消息可能在请求期间开始；此时保留定位，不抢回底部。
          if ((atBottom() || !silent) && !state.jumpedAway) ctx.emit('chat/scroll-bottom')
        } else if (!silent) {
          ctx.emit('chat/scroll-bottom')
        }
      } catch (e: any) {
        if (!silent && inView(cur, version) && request === messageRequest) ctx.emit('ui/toast', { text: '消息加载失败：' + e.message, type: 'error' })
      } finally {
        if (messageAbort === controller) messageAbort = undefined
        if (inView(cur, version) && request === messageRequest) { state.loadingMsgs = false; messageFlightVersion = -1 }
      }
    }

    /** 消息区是否贴在底部（ChatView 每次滚动时更新） */
    let bottomFlag = true
    function setAtBottom(v: boolean) { bottomFlag = v }
    function atBottom() { return bottomFlag }

    async function open(chat: any) {
      if (detached && channelKey(detached) !== channelKey(chat)) return
      cancelPendingNotification(chat.id, chat.type)
      const sameChannel = state.current?.id === chat.id && state.current?.type === chat.type
      if (state.current) {
        drafts.get(state.current).reply = state.reply
        drafts.flush(state.current)
        if (!sameChannel) drafts.releaseIdle(state.current)
      }
      rememberWindow()
      const version = invalidateView()
      const next = state.conversations.find((c: any) => c.id === chat.id && c.type === chat.type) || chat
      if (!sameChannel) state.messages = messageWindows.get(channelKey(next))?.slice() || []
      state.loadingMore = false
      state.loadingMsgs = true
      state.current = next
      lastOpened = { key: channelKey(next), sequence: touchConversation(next) }
      state.conversations = sortConvs(state.conversations)
      state.searching = false
      // 打开即清除本地「标记未读」
      if (convGroups.marked.includes(chat.id)) {
        convGroups.marked = convGroups.marked.filter((x: string) => x !== chat.id)
        saveGroups()
      }
      // E6：先归零再加载，避免总角标在 await 窗口内多计
      const hit0 = state.conversations.find((c: any) => c.id === chat.id && c.type === chat.type)
      if (hit0) { hit0.unread = 0; hit0.at = false }
      bottomFlag = true
      state.hasMore = true
      state.jumpedAway = false
      state.locateId = null
      state.locatingId = null
      state.searchResults = []
      state.searchWord = ''
      clearReply(false)
      state.reply=drafts.get(state.current).reply
      clearSelection()
      void saveCurrentId(chat.id, chat.type)
      await loadMessages()
      if (!inView(next, version)) return
      dismissNow(chat.id)
      const hit = state.conversations.find((c: any) => c.id === chat.id && c.type === chat.type)
      if (hit) { hit.unread = 0; hit.at = false }
      ctx.emit('chat/open', chat)
    }

    function close() {
      invalidateView()
      state.messages = []
      state.current = null
      state.loadingMsgs = false
      state.loadingMore = false
      state.searching = false
      void saveCurrentId(null)
    }

    /** 上滑加载更多历史 */
    async function loadMore() {
      const cur = state.current
      if (!cur || state.loadingMore || !state.hasMore) return
      const version = viewVersion
      const oldest = state.messages[0]
      if (!oldest) return
      state.loadingMore = true
      try {
        const response = await api.messagesBefore(cur.id, cur.type, oldest.id, 30, { signal: viewAbort.signal })
        if (!inView(cur, version)) return
        const existing = messagesById.value
        const older = new Map<string, any>()
        let since = Infinity
        for (const m of response) {
          const ts = Number(m.ts)
          if (Number.isFinite(ts) && ts > 0) since = Math.min(since, ts)
          if (!existing.has(m.id) && !older.has(m.id)) older.set(m.id, mergeMessage(m, cur))
        }
        state.hasMore = response.length >= 30 && older.size > 0
        // The server can omit recalled messages entirely; merge local matches into the same history window.
        for (const m of recallCache.recalled(cur, Number.isFinite(since) ? since : 0)) {
          if ((!oldest.ts || m.ts <= oldest.ts) && !existing.has(m.id) && !older.has(m.id)) older.set(m.id, m)
        }
        if (!older.size) return
        const page = [...older.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
        const mine = auth.state.user?.id
        for (const m of page) if (m.right === undefined) m.right = m.senderId === mine
        state.messages = [...page, ...state.messages]
      } catch (e: any) {
        if (inView(cur, version)) ctx.emit('ui/toast', { text: '加载历史失败：' + e.message, type: 'error' })
      } finally { if (inView(cur, version)) state.loadingMore = false }
    }

    /** 聊天记录搜索 */
    async function search(word: string) {
      const cur = state.current
      if (!cur) return []
      const version = viewVersion
      const request = ++searchRequest
      if (!word.trim()) { state.searchResults = []; state.searchWord = ''; state.searching = false; return [] }
      state.searching = true
      try {
        state.searchWord = word
        const results = await api.searchChat({ word, chatId: cur.id, chatType: cur.type, size: 30, signal: viewAbort.signal })
        if (!inView(cur, version) || request !== searchRequest) return []
        state.searchResults = results
        return state.searchResults
      } catch (e: any) {
        if (inView(cur, version) && request === searchRequest) ctx.emit('ui/toast', { text: '搜索失败：' + e.message, type: 'error' })
        return []
      } finally { if (inView(cur, version) && request === searchRequest) state.searching = false }
    }

    function cancelLocate() {
      locateRequest++
      locateAbort?.abort()
      locateAbort = undefined
      state.locatingId = null
    }
    /** 引用/通知统一定位入口：数据就绪后保存定位态，页面稍后挂载也能定位。 */
    async function locate(channel: any, messageId: string, target?: any) {
      if (!channel?.id || !messageId || disposed || (detached && channelKey(detached) !== channelKey(channel))) return
      const key = channelKey(channel)
      if (state.locatingId === messageId && pendingLocateKey === key) return
      const request = ++locateRequest
      locateAbort?.abort()
      const controller = locateAbort = new AbortController()
      const version = viewVersion
      const account = accountVersion
      const currentKey = state.current ? channelKey(state.current) : ''
      const deadline = Date.now() + 35000
      const options = () => ({ timeout: Math.max(1000, Math.min(12000, deadline - Date.now())), signal: controller.signal })
      const active = () => !disposed && account === accountVersion && version === viewVersion && request === locateRequest
      pendingLocateKey = key; state.locatingId = messageId; state.locatePages = 0
      ctx.console?.goto('/')
      // Fetch transactionally. A failed lookup must never clear the visible conversation.
      let messages = key === currentKey ? state.messages.slice() : messageWindows.get(key)?.slice() || []
      try {
        if (!messages.some((m: any) => m.id === messageId)) {
          // Retain the actual message/sequence obtained for a quote preview. A summary alone
          // cannot anchor an old history request, and a sparse response is not deletion evidence.
          let anchor = target?.id === messageId ? target : quoteTargets.get(`${key}:${messageId}`)
          let around: any[] = []
          try { around = await api.messagesAround(channel.id, channel.type, messageId, 30, anchor?.seq || 0, options()) }
          catch (error) { if (!anchor) throw error }
          if (!active()) return
          anchor ||= around.find((m: any) => m.id === messageId)
          if (!anchor) {
            const exact = await api.messagesAround(channel.id, channel.type, messageId, 1, 0, options())
            if (!active()) return
            anchor = exact.find((m: any) => m.id === messageId)
            if (anchor) {
              // The target-only query can resolve a sequence that a broad query omitted.
              if (anchor.seq > 0) {
                try { around = await api.messagesAround(channel.id, channel.type, messageId, 30, anchor.seq, options()) }
                catch { /* The resolved target remains usable if its neighbors fail to load. */ }
                if (!active()) return
              } else around = exact
            }
          }
          if (!anchor) {
            // Some servers return a recent page for distant IDs. Walk back from the
            // referencing message with a real cursor, stopping on empty/repeated pages.
            const reference = messages.find((m: any) => (m.quoteId || m.content?.quote_msg_id) === messageId)
            let cursor = reference?.id || around[0]?.id || messages[0]?.id
            const seen = new Set<string>()
            for (let page = 0; cursor && page < 20 && !anchor && Date.now() < deadline; page++) {
              if (seen.has(cursor)) break
              seen.add(cursor); state.locatePages = page + 1
              const older = await api.messagesBefore(channel.id, channel.type, cursor, 60, options())
              if (!active()) return
              anchor = older.find((m: any) => m.id === messageId)
              if (anchor) { around = older; break }
              const next = older.find((m: any) => m.id && !seen.has(m.id))?.id
              if (!next || !older.length) break
              cursor = next
            }
          }
          if (!anchor) throw new Error('服务器暂未返回这条消息，请重试；当前聊天记录已保留')
          rememberQuoteTarget(key, anchor)
          const byId = new Map(around.map((m: any) => [m.id, mergeMessage(m, channel)]))
          byId.set(messageId, mergeMessage(anchor, channel))
          messages = [...byId.values()]
        }
        if (disposed || account !== accountVersion || version !== viewVersion || request !== locateRequest) return
        // Seed open() with the resolved window, so even a slow latest-page response cannot blank it.
        if (key !== currentKey) {
          messageWindows.set(key, messages)
          void open(channel)
        } else {
          // Retain live pushes that arrived while the lookup was pending.
          const byId = new Map(state.messages.map((m: any) => [m.id, m]))
          for (const m of messages) if (!byId.has(m.id)) byId.set(m.id, m)
          if (byId.size !== state.messages.length) state.messages = [...byId.values()].sort((a: any, b: any) => a.ts - b.ts)
        }
        state.jumpedAway = true
        state.locateId = messageId
        bottomFlag = false
        ctx.emit('chat/locate', messageId)
      } catch (e: any) {
        if (disposed || account !== accountVersion || version !== viewVersion || request !== locateRequest) return
        ctx.ui?.toast('消息定位失败：' + e.message, 'warn')
      } finally {
        if (locateAbort === controller) locateAbort = undefined
        if (request === locateRequest) state.locatingId = null
      }
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
      state.reply = messageQuote(msg)
      if(state.current)drafts.get(state.current).reply=state.reply
      ctx.emit('chat/reply', state.reply)
    }
    function clearReply(save = true) {
      if(save&&state.current)drafts.get(state.current).reply=null
      state.reply = null
      ctx.emit('chat/reply', null)
    }

    const quoteCache = new Map<string, Promise<ReturnType<typeof messageQuote> | null>>()
    const quoteTargets = new Map<string, any>()
    let pendingLocateKey = ''
    function rememberQuoteTarget(channel: string, message: any) {
      quoteTargets.set(`${channel}:${message.id}`, message)
      if (quoteTargets.size > 200) quoteTargets.delete(quoteTargets.keys().next().value)
    }
    ctx.on('auth/logout', () => { quoteCache.clear(); quoteTargets.clear(); state.locatingId = null })
    async function getQuote(id: string) {
      const current = state.current
      if (!current) return null
      const local = findMessage(id)
      if (local) return messageQuote(local)
      const key = `${current.type}:${current.id}:${id}`
      const account = accountVersion
      if (!quoteCache.has(key)) {
        const query = api.messagesAround(current.id, current.type, id, 1, 0).then((list: any[]) => {
          const found = list.find((m: any) => m.id === id)
          if (!found) { quoteCache.delete(key); return null }
          if (account !== accountVersion || disposed) return null
          rememberQuoteTarget(channelKey(current), found)
          return messageQuote(found)
        }).catch(() => { quoteCache.delete(key); return null })
        quoteCache.set(key, query)
        if (quoteCache.size > 200) quoteCache.delete(quoteCache.keys().next().value)
      }
      return quoteCache.get(key)!
    }

    /* ---------------- 消息操作 ---------------- */
    /** 撤回：只允许撤回自己的消息（服务端也会校验） */
    async function recall(ids: string[]) {
      const cur = state.current
      if (!cur || !ids.length) return
      await api.recall(cur.id, cur.type, ids)
      for (const id of ids) {
        const i = state.messages.findIndex((x: any) => x.id === id)
        if (i >= 0) state.messages[i] = mergeMessage({ ...state.messages[i], recalled: true }, cur, state.messages[i])
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
    async function send(text: string, contentType: number = ContentType.text, mentionedIds: string[] = []) {
      const cur = state.current
      const version = viewVersion
      const me = auth.state.user
      if (!cur || !String(text ?? '').trim()) return
      const reply = state.reply
      const quoteId = reply?.id
      state.sending = true
      try {
        const elements = contentType === ContentType.markdown ? [h.markdown(text)]
          : contentType === ContentType.html ? [h.html(text)]
            : [h.text(text)]
        const quoted = quoteId ? state.messages.find((m: any) => m.id === quoteId) : null
        const quoteText = quoted ? `${quoted.sender}: ${previewOf(quoted)}` : (reply ? `${reply.sender}: ${reply.preview}` : '')
        const mentions = cur.type === 2 && mentionedIds.length ? { mentioned_id: mentionedIds } : {}
        const bot = (ctx as any).bots?.[0]
        let id: string
        if (bot) id = await bot.sendMessage({ id: cur.id, type: cur.type }, elements, cur.type, { quoteId, quoteText, ...mentions })
        else {
          const { contentType: ct, content } = render(elements)
          if (quoteText) content.quote_msg_text = quoteText
          id = await api.send(cur.id, cur.type, ct, { ...content, ...mentions }, { quoteId })
        }
        if (!inView(cur, version)) return
        if (state.reply?.id === quoteId) clearReply()

        // 服务端不回推自己发的消息：乐观上屏 + 稍后对账
        const optimistic = {
          id, senderId: me?.id, sender: me?.name || '我', avatar: me?.avatar,
          type: contentType, content: { text, ...mentions }, elements, ts: Date.now(), right: true, pending: true,
          quoteId,
        }
        // WS 可能先于 HTTP 响应到达，同一 ID 只上屏一次。
        if (!state.messages.some((m: any) => m.id === id)) state.messages.push(optimistic)
        locateRequest++; state.locatingId = null; state.jumpedAway = false; state.locateId = null; bottomFlag = true
        ctx.emit('chat/scroll-bottom')
        scheduleReconcile(cur)
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
      const version = viewVersion
      if (!cur || !text.trim()) return
      const m = state.messages.find((x: any) => x.id === msgId)
      const ct = m?.type === 3 ? 3 : m?.type === 8 ? 8 : 1
      await api.editMessage(cur.id, cur.type, msgId, ct, { text: text.trim() })
      if (inView(cur, version)) {
        const index = state.messages.findIndex((x: any) => x.id === msgId)
        if (index >= 0) {
          const current = state.messages[index]
          liveRevisions.set(`${cur.type}:${cur.id}:${msgId}`, ++liveVersion)
          state.messages[index] = mergeMessage({ ...current, content: { ...(current.content || {}), text: text.trim() }, edited: true, elements: null }, cur)
        }
      }
      ctx.emit('ui/toast', { text: '已修改并同步', type: 'success' })
    }

    /** 发送任意元素（图片/文件/视频等） */
    async function sendMedia(elements: any[], options: { msgId?: string; retry?: boolean } = {}) {
      const cur = state.current
      const version = viewVersion
      if (!cur || !elements?.length) return
      const reply = state.reply
      const quoteId = reply?.id
      const quoteText = reply ? `${reply.sender}: ${reply.preview}` : ''
      const bot = (ctx as any).bots?.[0]
      let id: string
      if (bot) id = await bot.sendMessage({ id: cur.id, type: cur.type }, elements, cur.type, { ...options, quoteId, quoteText })
      else {
        const { contentType, content } = render(elements)
        if (quoteText) content.quote_msg_text = quoteText
        id = await api.send(cur.id, cur.type, contentType, content, { ...options, quoteId })
      }
      if (inView(cur, version)) {
        if (state.reply?.id === quoteId) clearReply()
        const me = auth.state.user
        if (!state.messages.some((m: any) => m.id === id)) state.messages.push({
          id, elements, type: render(elements).contentType, senderId: me?.id, sender: me?.name || '我',
          avatar: me?.avatar, ts: Date.now(), right: true, pending: true, quoteId,
        })
        locateRequest++; state.locatingId = null; state.jumpedAway = false; state.locateId = null; bottomFlag = true
        ctx.emit('chat/scroll-bottom')
        scheduleReconcile(cur)
      }
    }

    // WS 重连可能重放同一消息。使用有界 ID 集避免未读和 Toast 重复累计。
    const seenIncoming = new Set<string>()
    ctx.on('auth/logout', () => { seenIncoming.clear(); liveRevisions.clear() })
    /** 统一会话事件写入本地状态 */
    function applySession(session: any, kind = 'created', fromPoll = false) {
      const selfId = auth.state.user?.id
      const type = Number(session.channel?.type) || 2
      let id = String(session.channel?.id || '')
      if (type === 1 && id === selfId) id = session.user?.id !== selfId ? session.user?.id : session.raw?.recvId
      if (!id || !session.id) return
      session = { ...session, id: String(session.id), channel: { ...session.channel, id: String(id), type } }
      const msg = session.raw || {}
      if (kind === 'created' && (session.recalled || msg.recalled || msg.recallTs)) kind = 'recalled'
      const mine = session.user.id === auth.state.user?.id
      // ⚠️ WS 推送经常只带 id/发送者不带 content（或 content 为空壳）：
      //    直接 { ...old, ...m } 会把已加载的正文/元素抹成 {}（文章打不开的根因）。
      //    这里做覆盖保护：incoming 空则保留本地已有值。
      const existing = state.current?.id === session.channel.id && state.current?.type === session.channel.type
        ? state.messages.find((x: any) => x.id === session.id) : undefined
      const hasContent = hasBody(msg.content)
      const content = hasContent ? msg.content : (existing?.content || {})
      const elements = session.elements?.length && (hasContent || !existing)
        ? session.elements
        : (hasContent ? parse(content, msg.type) : (existing?.elements || []))
      let m = {
        id: session.id,
        chatId: session.channel.id,
        senderId: session.user.id,
        sender: session.user.name,
        avatar: session.user.avatar,
        tags: session.tags || [],
        type: msg.type || existing?.type,
        content,
        elements,
        // An edit notification's timestamp is not a new send time; preserve the row's position.
        ts: kind === 'updated' && existing?.ts ? existing.ts : session.timestamp || existing?.ts,
        seq: msg.seq || existing?.seq,
        right: mine,
        recalled: kind === 'recalled' || !!session.recalled || !!msg.recalled || !!msg.recallTs,
        edited: kind === 'updated' || !!session.edited,
        quoteId: session.quoteId || msg.quoteId || existing?.quoteId,
      }
      const receivedBody = hasRecallBody({ content: msg.content, elements: session.elements })
      const capture = !m.recalled && receivedBody && (!fromPoll || captureFromPoll(m))
      m = mergeMessage(m, session.channel, existing, capture)
      if (m.recalled && preferences.antiRecall) {
        const owner = String(selfId || '')
        const account = accountVersion
        const eventMessage = m
        // A recall may arrive before the persisted cache finishes loading, including in a background conversation.
        void recallCache.ready().then(() => {
          if (disposed || account !== accountVersion || !preferences.antiRecall || String(auth.state.user?.id || '') !== owner) return
          const restored = recallCache.merge(session.channel, eventMessage)
          if (!restored.retainedRecall) return
          const update = (list: any[]) => {
            const index = list.findIndex((item: any) => String(item.id) === String(restored.id))
            if (index >= 0) list[index] = { ...list[index], ...restored }
          }
          if (state.current?.id === session.channel.id && state.current?.type === session.channel.type) update(state.messages)
          const windowMessages = messageWindows.get(channelKey(session.channel))
          if (windowMessages) update(windowMessages)
        })
      }
      const isCurrent = state.current && session.channel.id === state.current.id && session.channel.type === state.current.type
      const incomingKey = `${session.channel.type}:${session.channel.id}:${session.id}`
      if (!fromPoll) {
        liveRevisions.set(incomingKey, ++liveVersion)
        if (liveRevisions.size > 2000) liveRevisions.delete(liveRevisions.keys().next().value)
      }
      const duplicate = kind === 'created' && (seenIncoming.has(incomingKey) || (isCurrent && !!existing))
      if (kind === 'created') {
        seenIncoming.add(incomingKey)
        if (seenIncoming.size > 1000) seenIncoming.delete(seenIncoming.values().next().value)
      }
      if (isCurrent) {
        const i = state.messages.findIndex((x: any) => x.id === m.id)
        if (i >= 0) state.messages[i] = { ...state.messages[i], ...m }
        else {
          state.messages.push(m)
          if (atBottom() && !state.jumpedAway && state.messages.length > messageLimit()) state.messages.splice(0, state.messages.length - messageLimit())
          if (atBottom()) ctx.emit('chat/scroll-bottom')
        }
      }
      if (isCurrent && !hasContent && kind === 'created') scheduleReconcile(state.current)
      const conv = state.conversations.find((c: any) => c.id === session.channel.id && c.type === session.channel.type)
      if (kind === 'created' && !duplicate && !fromPoll) touchConversation(session.channel)
      if (conv) {
        conv.preview = previewOf(m)
        conv.ts = Math.max(conv.ts || 0, session.timestamp || 0)
        const reading = isCurrent && viewingConversation()
        if (!reading && kind === 'created' && !duplicate && !mine && !fromPoll) conv.unread = (conv.unread || 0) + 1
        if (kind === 'created' && !fromPoll) conversationRevisions.set(channelKey(conv), liveVersion)
        if (reading && kind === 'created' && !mine) {
          // E4：当前会话来消息立即本地归零 + 即时报已读（防抖兜底合并上报）
          conv.unread = 0; conv.at = false
          scheduleDismiss(session.channel.id)
        }
        if (kind === 'created' && !duplicate) state.conversations = sortConvs(state.conversations)
      } else if (kind === 'created') {
        if (!convGroups.hidden.includes(session.channel.id)) loadConversations(true)
      }
      const viewingCurrent = isCurrent && viewingConversation()
      if (!viewingCurrent && !mine && kind === 'created' && !duplicate) {
        if (!isCurrent) ctx.emit('chat/incoming', m)
        void notifyIncoming(session, m, conv)

      }
    }

    function notifyIncoming(session: any, message: any, known: any) {
      if (detached) return
      const key = `${session.channel.type}:${session.channel.id}`
      const previous = pendingNotifications.get(key)
      if (previous) clearTimeout(previous.timer)
      // 同一会话只保留最新待通知消息；较慢的旧资料请求不能覆盖新通知。
      const entry: PendingNotification = { key, account: accountVersion, session, message, known, attempt: 0 }
      pendingNotifications.set(key, entry)
      while (pendingNotifications.size > 100) {
        const oldest = pendingNotifications.keys().next().value
        clearTimeout(pendingNotifications.get(oldest)?.timer)
        pendingNotifications.delete(oldest)
      }
      void deliverIncoming(entry)
    }
    async function notificationMetadata(channel: any, known: any) {
      const getter = channel.type === 2 ? api.groupInfo : channel.type === 3 ? api.botInfo : api.getUser
      const requests: Promise<any>[] = []
      if (typeof getter === 'function') requests.push(Promise.resolve().then(() => getter.call(api, channel.id, { timeout: 5000 })).then((info: any) => {
        if (typeof info?.noDisturb !== 'boolean') throw new Error('会话免打扰状态未知')
        return { ...known, ...info, name: known?.name || info.name }
      }))
      if (typeof api.conversations === 'function') requests.push(Promise.resolve().then(() => api.conversations({ timeout: 5000 })).then((list: any[]) => {
        const hit = list.find((c: any) => String(c.id) === String(channel.id) && Number(c.type) === Number(channel.type))
        if (typeof hit?.noDisturb !== 'boolean') throw new Error('会话免打扰状态未知')
        return { ...known, ...hit }
      }))
      if (!requests.length) throw new Error('无法获取会话信息')
      return Promise.any(requests)
    }
    async function deliverIncoming(entry: PendingNotification) {
      const valid = () => !disposed && entry.account === accountVersion && pendingNotifications.get(entry.key) === entry
      const { session, message } = entry
      if (!valid()) return
      if ((ctx as any).lock?.isLocked || isMuted(session.channel.id) || showingConversation(session.channel)) { pendingNotifications.delete(entry.key); return }
      let conv = state.conversations.find((c: any) => c.id === session.channel.id && c.type === session.channel.type) || entry.known
      const hasInfoApi = !!(api.groupInfo || api.getUser || api.botInfo)
      if (!conv || (conv.noDisturb === undefined && hasInfoApi)) {
        try { conv = await notificationMetadata(session.channel, conv) }
        catch {
          if (!valid()) return
          if (entry.attempt >= 4) { pendingNotifications.delete(entry.key); return }
          const delay = retryBase * 2 ** entry.attempt++
          entry.timer = setTimeout(() => { entry.timer = undefined; void deliverIncoming(entry) }, delay)
          return
        }
      }
      if (!valid()) return
      if ((ctx as any).lock?.isLocked) { pendingNotifications.delete(entry.key); return }
      const live = state.conversations.find((c: any) => c.id === session.channel.id && c.type === session.channel.type)
      if (live && live.noDisturb === undefined && typeof conv?.noDisturb === 'boolean') live.noDisturb = conv.noDisturb
      if ((live?.noDisturb ?? conv?.noDisturb) || isMuted(session.channel.id) || showingConversation(session.channel)) {
        pendingNotifications.delete(entry.key); return
      }
      const channel = { id: session.channel.id, type: session.channel.type,
        name: live?.name || conv?.name || session.channel.name || (session.channel.type === 1 ? session.user.name : '') || '新会话',
        avatar: live?.avatar || conv?.avatar || session.channel.avatar }
      pendingNotifications.delete(entry.key)
      ctx.ui?.toast(`${session.user.name || session.user.id}：${previewOf(message) || '[新消息]'}`, 'message', 6500, {
        title: channel.name, avatar: channel.avatar,
        key: `chat:${channel.type}:${channel.id}`,
        onClick: () => locate(channel, message.id, message),
      })
    }

    const chat = {
      state, drafts, preferences, setAntiRecall, clearRecallCache, filtered, loadConversations, loadMessages, loadMore, search, locate, cancelLocate, open, send, sendMedia, edit, previewOf,
      /* 选择态 */
      isSelected, toggleSelect, startSelecting, selectAll, clearSelection,
      get selectedMessages() { return state.messages.filter((m: any) => state.selected.includes(m.id)) },
      /* 引用态 */
      setReply, clearReply, findMessage, getQuote, quoteOf: messageQuote,
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
      close,
      /** 清除某会话的本机消息缓存（云端记录不动；云湖无删记录端点） */
      clearLocal(convId: string) {
        if (state.current?.id === convId) state.messages = []
        ensureCache().then((c) => {
          if (Array.isArray(c.convs)) {
            const hit = c.convs.find((x: any) => x.id === convId)
            if (hit) { hit.preview = ''; }
          }
          return storage?.save('cache', c).catch(() => {})
        })
      },
      /** ChatView 滚动时调用：标记是否贴在底部（决定新消息要不要自动滚） */
      setAtBottom, atBottom,
    }

    /* ---- 订阅统一事件（Satori 风格） ---- */
    ctx.on('message-created', (s: any) => applySession(s, 'created'))
    ctx.on('message-updated', (s: any) => applySession(s, 'updated'))
    ctx.on('message-recalled', (s: any) => applySession(s, 'recalled'))

    /* ---- 轮询兜底 ---- */
    ctx.effect(() => {
      let timer: any = null, tick = 0
      const stop = () => { if (timer) { clearInterval(timer); timer = null } }
      const unwatch = watch(() => auth.state.status, async (s: string) => {
        stop()
        if (s !== 'ready') { invalidateView(); state.conversations = []; state.messages = []; state.current = null; return }
        // E1：登录后先用本地快照秒开列表，并恢复上次打开的会话（重启不再丢现场）
        const version = viewVersion, account = accountVersion
        const c = await ensureCache()
        if (disposed || auth.state.status !== 'ready' || account !== accountVersion) return
        if (Array.isArray(c.convs) && c.convs.length && !state.conversations.length) {
          state.conversations = c.convs
          if (!detached && version === viewVersion && c.currentId && !state.current) {
            const hit = c.convs.find((x: any) => x.id === c.currentId && (c.currentType == null || x.type === c.currentType))
            if (hit) { hit.unread = 0; hit.at = false; state.current = hit; loadMessages(true) }
          }
        }
        loadConversations(true)
        timer = setInterval(() => {
          tick++
          // 后台仍检查未读：WS 断线时不能让最小化窗口完全失去通知。
          // 当前消息每次 tick 对账，WS 丢包或历史定位后也不会停止刷新；
          // WS 在线时会话列表降频，消息请求由 messageFlightVersion 合并。
          const ws: any = (ctx as any).ws
          const online = !!ws?.online
          if (!detached && (!online || tick % 5 === 0)) loadConversations(true)
          if (!document.hidden && !windowMinimized && state.current) loadMessages(true)
        }, pollMs)
      }, { immediate: true })
      // E5：回到前台立即对账（不等下一个 tick，最长 20s 的陈旧窗口消失）
      const onVis = () => {
        if (document.visibilityState === 'visible' && auth.state.status === 'ready') {
          readCurrent()
          if (!detached) loadConversations(true)
          if (state.current) loadMessages(true)
        }
      }
      const onMinimized = (event: Event) => {
        windowMinimized = (event as CustomEvent).detail === true
        if (windowMinimized && resourceMode.economy) { messageWindows.clear(); quoteCache.clear(); quoteTargets.clear() }
        if (!windowMinimized && auth.state.status === 'ready') {
          readCurrent(); loadConversations(true)
          if (state.current) loadMessages(true)
        }
      }
      document.addEventListener('visibilitychange', onVis)
      const onFocus = () => { windowFocused = true; readCurrent() }
      const onBlur = () => { windowFocused = false }
      const onNativeFocus = (event: Event) => { windowFocused = (event as CustomEvent).detail === true; if (windowFocused) readCurrent() }
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      window.addEventListener('yh-window-focused', onNativeFocus)
      window.addEventListener('yh-window-minimized', onMinimized)
      const unwatchPage = watch(() => ctx.console?.state.currentPage, readCurrent)
      return () => { unwatch(); unwatchPage(); stop(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); window.removeEventListener('yh-window-focused', onNativeFocus); window.removeEventListener('yh-window-minimized', onMinimized) }
    })

    /* 输入区按钮由插件贡献 —— 这批是 chat 插件自带的（默认序：文本/MD/HTML → 表情 → 图片 → 视频 → 文件） */
    chat.composer('composer', [
      { id: 'type.text', kind: 'type', value: 1, label: '文本', order: 10 },
      { id: 'type.md', kind: 'type', value: 3, label: 'Markdown', order: 11 },
      { id: 'type.html', kind: 'type', value: 8, label: 'HTML', order: 12 },
      { id: 'att.image', kind: 'image', label: '图片', order: 50 },
      { id: 'att.file', kind: 'file', label: '文件', order: 70 },
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
