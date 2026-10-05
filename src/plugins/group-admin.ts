/**
 * group-admin 插件 —— 群聊相关：成员列表 / 踢出 / 禁言 / 看板 / 聊天记录搜索
 * ------------------------------------------------------------------
 * 依赖 api、chat、ui
 */
import { reactive } from 'vue'
import type { Context } from '../core/context'
import GroupPanel from '../components/GroupPanel.vue'
import ProfilePanel from '../components/ProfilePanel.vue'
import SettingsPage from '../console/pages/SettingsPage.vue'

/** 禁言时长（秒），对齐云湖接口允许的取值 */
export const GAG_OPTIONS = [
  { label: '取消禁言', value: 0 },
  { label: '10 分钟', value: 600 },
  { label: '1 小时', value: 3600 },
  { label: '6 小时', value: 21600 },
  { label: '12 小时', value: 43200 },
  { label: '永久', value: -1 },
]

export const groupAdminPlugin = {
  name: 'group-admin',
  inject: ['api', 'chat', 'ui'],
  provide: ['group'],

  apply(ctx: Context, config: any = {}) {
    const api = ctx.api
    const chat = ctx.chat
    const ui = ctx.ui

    const state = reactive({
      open: false,
      tab: 'members' as 'members' | 'board' | 'search',
      /* 成员 */
      members: [] as any[],
      membersTotal: 0,
      membersLoading: false,
      memberKeyword: '',
      page: 1,
      /* 群信息 */
      info: null as any,        // 群详细信息（群资料页用）
      infoLoading: false,
      /* 看板 */
      board: null as any,
      boardLoading: false,
      boardOpen: true,
      dockOpen: false,           // 底部停靠栏是否展开
      panelOpen: false,          // 群设置抽屉是否展开
      profileUser: null as any,  // 正在查看的用户（点头像进主页）
      friendIds: [] as string[], // 通讯录里的用户 id（判断是否好友，非好友只能“加好友”）
      friendsLoaded: false,
      /* 群文件 */
      diskList: [] as any[],
      diskLoading: false,
      diskFolder: 0,
      newFolder: '',
      diskPath: [] as any[],
      diskTotal: null as any,
      mounts: [] as any[],      // 群里的第三方网盘挂载（WebDAV）
      /* 挂载盘的页内浏览状态 */
      mountView: null as any,
      mountPath: [] as string[],
      mountEntries: [] as any[],
      mountLoading: false,
      mountPwd: '',
      mountNeedPwd: false,
      mountError: '',
      dockTab: 'board' as 'board' | 'members' | 'tags' | 'search' | 'disk' | 'info' | 'all',  // 停靠栏页签
      allBoards: [] as any[],    // 扫描到的所有会话看板
      scanProgress: 0,
      scanning: false,
      boardOwner: null as any,   // 看板所属机器人
      bots: [] as any[],         // 群内全部机器人（/v1/group/bot-list）
      boardBots: [] as any[],    // **只含有看板的**机器人（从扫描结果反推，见 refreshBoardBots）
      boardBotId: '',            // 当前查看哪个机器人的看板（空=会话默认看板）
      /* 群标签 */
      tags: [] as any[],
      tagsLoading: false,
      tagPage: 1,
      tagSearch: '',
      tagsEnd: false,        // 是否已到最后一页
      newTag: '',
      newTagColor: '#2196F3',
      tagMemberFor: null as any,       // 正在给谁打标签
      tagMap: {} as Record<string, any[]>,  // userId -> [{id,tag,color}]，用于消息头顶显示标签
      tagMapLoading: false,
      memberTagIds: [] as number[],
      /* 搜索 */
      searchWord: '',
      searching: false,
      results: [] as any[],
      searched: false,
    })

    const isGroup = () => chat.state.current?.type === 2

    function requireGroup(): string | null {
      const cur = chat.state.current
      if (!cur || cur.type !== 2) {
        ui.toast('只有群聊支持该操作', 'warn')
        return null
      }
      return cur.id
    }

    async function loadMembers(append = false) {
      const gid = requireGroup(); if (!gid) return
      state.membersLoading = true
      try {
        if (!append) state.page = 1
        const { list, total } = await api.listMembers(gid, {
          size: 50, page: state.page, keywords: state.memberKeyword,
        })
        state.members = append ? [...state.members, ...list] : list
        state.membersTotal = total
      } catch (e: any) {
        ui.toast('成员列表加载失败：' + e.message, 'error')
      } finally { state.membersLoading = false }
    }

    async function loadMoreMembers() {
      state.page += 1
      await loadMembers(true)
    }

    async function loadInfo() {
      const gid = requireGroup(); if (!gid) return
      state.infoLoading = true
      try { state.info = await api.groupInfo(gid) }
      catch (e: any) { ui.toast('群信息加载失败：' + e.message, 'error') }
      finally { state.infoLoading = false }
    }

    /** 群内机器人列表：每个机器人可以对应一个看板 */
    async function loadBots() {
      const cur = chat.state.current
      if (!cur || cur.type !== 2) { state.bots = []; return }
      try { state.bots = await api.listBots(cur.id) } catch { state.bots = [] }
    }

    /**
     * 拉取看板。
     *  · 不指定机器人：取当前会话的看板（群看板会带上所属机器人）
     *  · 指定机器人：先试该机器人在本会话的看板，取不到再退回会话看板
     */
    /**
     * 算出「哪些机器人真的有看板」。
     *
     * 接口真相（实测过）：
     *   POST /v1/bot/board { id=会话ID, chat_type=2 }  → 一个会话**只有一个**看板，
     *   返回体里的 bot_id/bot_name 标明它属于哪个机器人；
     *   把 id 换成机器人 ID（chat_type 1/2/3 都试过）**一律返回空** —— 没法按机器人查。
     * 所以只能用「已经见过的看板」反推：当前会话的看板归属 + 全部看板扫描的结果。
     */
    function refreshBoardBots() {
      const seen = new Map<string, string>()
      const put = (id?: string, name?: string) => { if (id) seen.set(String(id), name || String(id)) }
      if (state.board?.botId) put(state.board.botId, state.board.botName)
      for (const it of state.allBoards) {
        const b = it?.board
        if (b?.botId) put(b.botId, b.botName)
      }
      state.boardBots = [...seen].map(([id, name]) => ({ id, name }))
    }

    async function loadBoard(botId?: string) {
      const cur = chat.state.current
      if (!cur) return
      state.boardLoading = true
      state.boardBotId = botId ?? state.boardBotId
      try {
        let b = null
        if (state.boardBotId) {
          b = await api.board(state.boardBotId, 3).catch(() => null)
          b = b?.content ? b : null
        }
        if (!b) b = await api.board(cur.id, cur.type)
        state.board = b
        state.boardOwner = b?.botId
          ? { id: b.botId, name: b.botName || b.botId }
          : (state.boardBotId ? { id: state.boardBotId, name: (state.bots.find(x => x.id === state.boardBotId)?.name) || state.boardBotId } : null)
        if (!b && state.boardBotId) ui.toast('该机器人没有设置看板', 'warn')
      } catch { state.board = null; state.boardOwner = null }
      finally { state.boardLoading = false; refreshBoardBots() }
    }

    async function kick(m: any) {
      const gid = requireGroup(); if (!gid) return
      if (!window.confirm(`确定把「${m.name}」踢出本群？`)) return
      try {
        await api.kickMember(gid, m.id)
        ui.toast(`已踢出 ${m.name}`, 'success')
        state.members = state.members.filter((x: any) => x.id !== m.id)
        state.membersTotal = Math.max(0, state.membersTotal - 1)
      } catch (e: any) { ui.toast('踢出失败：' + e.message, 'error') }
    }

    async function gag(m: any, seconds: number) {
      const gid = requireGroup(); if (!gid) return
      try {
        await api.gagMember(gid, m.id, seconds)
        ui.toast(seconds === 0 ? `已解除 ${m.name} 的禁言` : `已禁言 ${m.name}（${GAG_OPTIONS.find(o => o.value === seconds)?.label}）`, 'success')
        m.isGag = seconds !== 0
        m.gagTs = seconds > 0 ? Date.now() + seconds * 1000 : 0
      } catch (e: any) { ui.toast('禁言失败：' + e.message, 'error') }
    }

    async function doSearch() {
      const cur = chat.state.current
      if (!cur) return
      if (!state.searchWord.trim()) { state.results = []; state.searched = false; return }
      state.searching = true
      try {
        state.results = await api.searchChat({
          word: state.searchWord.trim(), chatId: cur.id, chatType: cur.type, size: 30,
        })
        state.searched = true
      } catch (e: any) {
        ui.toast('搜索失败：' + e.message, 'error')
      } finally { state.searching = false }
    }

    /** 打开群设置抽屉（原来的 toggle('members') 入口现在指这里） */
    function open() { state.panelOpen = true }
    function close() { state.panelOpen = false; state.open = false; state.tagMemberFor = null }
    function toggle() {
      state.panelOpen = !state.panelOpen
      if (state.panelOpen) { loadInfo(); if (!state.members.length) loadMembers() }
    }

    /* ---------------- 挂载盘：页内浏览 ----------------
     * 走本站 /mount-json（服务端替我们 PROPFIND 目标 WebDAV），
     * 结果直接在这个面板里渲染，跟云湖自带的群网盘交互一致，不跳新标签。
     */
    async function loadMount() {
      const mid = state.mountView?.id
      const gid = chat.state.current?.id
      if (!mid || !gid) return
      state.mountLoading = true
      state.mountError = ''
      try {
        const token = ctx.api?.token || ''
        const q = new URLSearchParams({ gid: String(gid), mid: String(mid), path: state.mountPath.join('/'), token })
        if (state.mountPwd) q.set('pwd', state.mountPwd)
        const r = await fetch('/mount-json?' + q.toString(), { headers: { token } }).then((x) => x.json())
        if (!r.ok) { state.mountError = r.msg || '打开失败'; state.mountEntries = []; state.mountNeedPwd = true; return }
        state.mountEntries = r.entries || []
        state.mountNeedPwd = !!r.needPassword
      } catch (e: any) {
        state.mountError = e.message
        state.mountEntries = []
      } finally { state.mountLoading = false }
    }

    function openMount(m: any) {
      state.mountView = m
      state.mountPath = []
      state.mountPwd = ''
      state.mountError = ''
      loadMount()
    }
    function closeMount() { state.mountView = null; state.mountEntries = []; state.mountPath = [] }
    function mountEnter(name: string) { state.mountPath.push(name); loadMount() }
    function mountUp() { state.mountPath.pop(); loadMount() }
    async function reloadMount() { await loadMount() }

    /* ---------------- 通讯录（好友判断） ---------------- */

    /** 拉通讯录，拿到好友 id 列表（只对“用户”这一类） */
    async function loadFriends() {
      if (state.friendsLoaded) return
      try {
        const book = await api.addressBook()
        state.friendIds = (book.users || []).map((u: any) => u.id)
      } catch { /* 忽略 */ }
      finally { state.friendsLoaded = true }
    }
    function isFriend(userId: string) { return state.friendIds.includes(userId) }

    /* ---------------- 群文件（群网盘） ---------------- */

    async function loadDisk(folderId = state.diskFolder) {
      const cur = chat.state.current
      if (!cur) return
      state.diskLoading = true
      state.diskFolder = folderId
      try {
        state.diskList = await api.diskList(cur.id, cur.type, folderId)
        state.diskTotal = await api.diskTotalSize(cur.id, cur.type).catch(() => null)
        // 挂载只在群根目录显示一次
        state.mounts = folderId === 0 && cur.type === 2 ? await api.mountList(cur.id).catch(() => []) : []
      } catch (e: any) {
        ui.toast('群文件加载失败：' + e.message, 'error')
      } finally { state.diskLoading = false }
    }
    /** 进文件夹 */
    function openFolder(item: any) {
      state.diskPath.push({ id: state.diskFolder, name: '根目录' })
      loadDisk(item.id)
    }
    /** 返回上一级 */
    function backFolder() {
      state.diskPath.pop()
      loadDisk(state.diskPath.length ? state.diskPath[state.diskPath.length - 1].id : 0)
    }
    async function createFolder(name: string) {
      const cur = chat.state.current
      if (!cur || !name.trim()) return
      try {
        await api.diskCreateFolder(cur.id, cur.type, name.trim(), state.diskFolder)
        await loadDisk()
        ui.toast('文件夹已创建', 'success')
      } catch (e: any) { ui.toast('创建失败：' + e.message, 'error') }
    }

    /* ---------------- 群标签 ---------------- */

    /** 拉取本群全部标签 */
    async function loadTags() {
      const gid = requireGroup(); if (!gid) return
      state.tagsLoading = true
      try {
        state.tagPage = 1
        state.tagsEnd = false
        const list = await api.listTags(gid, { size: 100, page: 1, tag: state.tagSearch.trim() })
        state.tags = list
        state.tagsEnd = list.length < 100
      } catch (e: any) { ui.toast('标签加载失败：' + e.message, 'error') }
      finally { state.tagsLoading = false }
    }

    /** 加载更多标签（云湖群标签可能上百个，必须分页） */
    async function loadMoreTags() {
      const gid = requireGroup(); if (!gid || state.tagsLoading || state.tagsEnd) return
      state.tagsLoading = true
      try {
        state.tagPage += 1
        const list = await api.listTags(gid, { size: 100, page: state.tagPage, tag: state.tagSearch.trim() })
        const seen = new Set(state.tags.map((t: any) => t.id))
        for (const t of list) if (!seen.has(t.id)) state.tags.push(t)
        state.tagsEnd = list.length < 100
      } finally { state.tagsLoading = false }
    }

    /** 按名字搜标签 */
    async function searchTags() { await loadTags() }

    /** 新建标签 */
    async function createTag() {
      const gid = requireGroup(); if (!gid) return
      const name = state.newTag.trim()
      if (!name) return ui.toast('标签名不能为空', 'warn')
      try {
        await api.createTag(gid, name, state.newTagColor)
        state.newTag = ''
        // 标签可能很多，建完按名字确认一次，避免“看着没加上”
        // 新建后直接按名字查一次，保证界面上立刻能看到（群里可能有 200+ 标签，第一页不一定有）
        const hit = (await api.listTags(gid, { size: 20, page: 1, tag: name }))[0]
        if (hit && !state.tags.some((t: any) => t.id === hit.id)) state.tags.unshift(hit)
        ui.toast('标签已创建：' + name, 'success')
      } catch (e: any) { ui.toast('创建失败：' + e.message, 'error') }
    }

    /** 删除标签 */
    async function removeTag(t: any) {
      const gid = requireGroup(); if (!gid) return
      if (!window.confirm(`删除标签「${t.tag}」？`)) return
      try { await api.deleteTag(gid, t.id); await loadTags(); ui.toast('已删除', 'success') }
      catch (e: any) { ui.toast('删除失败：' + e.message, 'error') }
    }

    /**
     * 构建「用户 -> 标签」映射：逐个标签查它绑定了哪些人。
     * 用来在消息头像上方显示该用户的群标签。
     */
    async function loadTagMap() {
      const gid = requireGroup(); if (!gid) return
      if (state.tagMapLoading) return
      state.tagMapLoading = true
      try {
        if (!state.tags.length) await loadTags()
        const map: Record<string, any[]> = {}
        // 之前只取前 80 个标签，导致很多人的标签显示不出来；这里改成全量（并发 6）
        const list = state.tags
        const CONC = 6
        for (let i = 0; i < list.length; i += CONC) {
          const batch = list.slice(i, i + CONC)
          const res = await Promise.all(batch.map(t =>
            api.tagMembers(gid, t.id).then(users => ({ t, users })).catch(() => null)))
          for (const r of res) {
            if (!r) continue
            for (const u of r.users) {
              ;(map[u.id] = map[u.id] || []).push({ id: r.t.id, tag: r.t.tag, color: r.t.color })
            }
          }
        }
        state.tagMap = map
      } catch { /* 忽略 */ }
      finally { state.tagMapLoading = false }
    }

    /** 取某个用户在本群的标签 */
    function tagsOf(userId: string) {
      return state.tagMap[userId] || []
    }

    /** 打开「给成员打标签」 */
    function openTagMember(m: any) {
      state.tagMemberFor = m
      // 预填该成员已有的标签
      state.memberTagIds = tagsOf(m.id).map(t => t.id)
    }

    /**
     * 提交成员标签。
     * 云湖没有批量接口，只能按标签逐个 relate / relate-cancel，
     * 这里算出「该加」和「该删」的差集再调用。
     */
    async function saveMemberTags() {
      const gid = requireGroup(); if (!gid || !state.tagMemberFor) return
      const uid = state.tagMemberFor.id
      const had = new Set(tagsOf(uid).map(t => t.id))
      const want = new Set(state.memberTagIds)
      const toAdd = [...want].filter(x => !had.has(x))
      const toDel = [...had].filter(x => !want.has(x))
      try {
        for (const id of toAdd) await api.relateTag(uid, id)
        for (const id of toDel) await api.relateTagCancel(uid, id)
        await loadTagMap()
        ui.toast(`已更新 ${state.tagMemberFor.name} 的标签（+${toAdd.length} -${toDel.length}）`, 'success')
        state.tagMemberFor = null
      } catch (e: any) { ui.toast('保存失败：' + e.message, 'error') }
    }

    /**
     * 扫描「所有会话」的看板。
     * 云湖接口只支持按会话取看板（BoardRequest{id=3, chat_type=4}），
     * 实测 id=机器人&chat_type=3 恒为空，所以这里遍历所有群聊/机器人会话逐个取，
     * 把有内容的列出来 —— 这就是「所有机器人看板」能做到的最大范围。
     */
    async function scanAllBoards() {
      if (state.scanning) return
      state.scanning = true
      state.allBoards = []
      state.scanProgress = 0
      try {
        const targets = chat.state.conversations.filter((c: any) => c.type === 2 || c.type === 3)
        const CONC = 6
        for (let i = 0; i < targets.length; i += CONC) {
          const batch = targets.slice(i, i + CONC)
          const res = await Promise.all(batch.map(async (c: any) => {
            try {
              const b = await api.board(c.id, c.type)
              return b?.content ? { chat: c, board: b } : null
            } catch { return null }
          }))
          for (const r of res) if (r) state.allBoards.push(r)
          state.scanProgress = Math.min(i + CONC, targets.length)
        }
        refreshBoardBots()
        ui.toast(`扫描完成，找到 ${state.allBoards.length} 个看板（涉及 ${state.boardBots.length} 个机器人）`, 'success')
      } finally { state.scanning = false }
    }

    /* 切换会话时重置 */
    ctx.on('chat/open', () => {
      state.members = []
      state.membersTotal = 0
      state.info = null
      state.board = null
      state.results = []
      state.searchWord = ''
      state.searched = false
      if (state.panelOpen) open()
      state.tagMap = {}
      if (chat.state.current?.type === 2) loadTagMap()
      loadFriends()
    })

    const group = {
      state, GAG_OPTIONS, isGroup,
      open, close, toggle,
      loadMembers, loadMoreMembers, loadInfo, loadBoard, loadBots, kick, gag, doSearch, scanAllBoards,
      loadTags, loadMoreTags, searchTags, createTag, removeTag, openTagMember, saveMemberTags, loadTagMap, tagsOf,
      loadFriends, isFriend, loadDisk, openFolder, backFolder, createFolder,
      openMount, closeMount, mountEnter, mountUp, reloadMount, loadMount,
      /** 打开用户主页 */
      openProfile(user: any) { state.profileUser = user },
      closeProfile() { state.profileUser = null },
      /** 底部看板栏开关 */
      /** 退出全屏群界面（最右边那个按钮） */
      closeDock() { state.dockOpen = false; state.tagMemberFor = null },
      toggleBoardDock() { state.dockOpen = !state.dockOpen; if (state.dockOpen && !state.board) { loadBots(); loadBoard() } },
      setDockTab(t: 'board' | 'members' | 'tags' | 'search' | 'disk' | 'info' | 'all') {
        state.dockTab = t
        state.dockOpen = true
        if (t === 'board' && !state.board) { loadBots(); loadBoard() }
        if (t === 'members' && !state.members.length) { loadInfo(); loadMembers() }
        if (t === 'tags' && !state.tags.length) loadTags()
        if (t === 'tags') loadTagMap()
        if (t === 'disk') loadDisk()
        if (t === 'info') loadInfo()
        if (t === 'all' && !state.allBoards.length && !state.scanning) scanAllBoards()
      },
      /**
       * 切换看板所属机器人。
       * 因为接口没法按机器人取看板，所以只能「跳到那个机器人持有看板的会话」，
       * 找不到就退回刷新当前会话的看板。
       */
      setBoardBot(id: string) {
        state.boardBotId = id
        const hit = state.allBoards.find((it: any) => it?.board?.botId === id)
        if (hit && hit.chat && hit.chat.id !== chat.state.current?.id) {
          chat.open(hit.chat)
          ui.toast(`已切到「${hit.chat.name}」（该看板属于 ${hit.board.botName || id}）`, 'success')
          setTimeout(() => loadBoard(), 600)
          return
        }
        loadBoard(id)
      },
      refreshBoardBots,
    }

    ctx.set('group', group)
    ctx.logger?.info('group-admin 插件已加载（成员/踢出/禁言/看板/搜索）')

    /* ---- 控制台扩展：把面板挂到全局插槽 ---- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addEntry((cc: any) => {
        cc.slot({ type: 'global', component: GroupPanel, order: 40 })
        cc.slot({ type: 'global', component: ProfilePanel, order: 41 })
      })
      ctx.console.addEntry((cc: any) => {
        cc.page({ name: '设置', path: '/settings', icon: 'sliders', order: 860, component: SettingsPage })
      })
    })
  },
}
