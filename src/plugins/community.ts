/** 板块服务：按请求归属接收结果，避免快速切换时串板、丢页和重复提交。 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import CommunityPage from '../console/pages/CommunityPage.vue'

export const name = 'community'
export interface CommunityCfg { pageSize: number; autoLoadMine: boolean }
export const communityConfig: Schema<CommunityCfg> = Schema.object({
  pageSize: Schema.number().default(20).description('板块文章每页条数'),
  autoLoadMine: Schema.boolean().default(true).description('启动时自动加载我的板块'),
})
export const communityPlugin = {
  Config: communityConfig, name: 'community', inject: ['api', 'ui', 'console'], provide: ['community'],
  apply(ctx: Context) {
    const api: any = ctx.api, ui: any = ctx.ui
    const PAGE_SIZE = 30
    const state = reactive({
      list: [] as any[], mine: [] as any[], myIds: [] as number[], followIds: [] as number[],
      listType: 2, listPage: 1, hasMore: false, loading: false, listError: '',
      groups: [] as any[], groupsOf: null as any, bindGroupId: '', groupPage: 1,
      hasMoreGroups: false, loadingGroups: false, groupsError: '', binding: false,
      viewing: null as any, posts: [] as any[], postPage: 1, hasMorePosts: false,
      postDetail: null as any, loadingPosts: false, loadingDetail: false,
      postsError: '', detailError: '', info: null as any,
      newAvatar: '', editing: null as any, creating: false, saving: false, managing: false,
      uploading: false, following: [] as number[], followReady: false,
    })
    let listRequest = 0, boardRequest = 0, detailRequest = 0, groupRequest = 0, identityRequest = 0, followsVersion = 0
    const idOf = (x: any) => Number(x?.id ?? x)
    const owns = (b: any) => state.myIds.includes(idOf(b))
    const unique = (items: any[]) => [...new Map(items.map(x => [String(x.id), x])).values()]
    const fail = (message: string, e: any) => { ui.toast(message + (e?.message || '请稍后重试'), 'error'); return false }

    async function load(typ = state.listType, more = false) {
      if (more && (state.loading || !state.hasMore)) return false
      const request = ++listRequest, page = more ? state.listPage + 1 : 1
      state.listType = typ; state.loading = true; state.listError = ''
      if (!more) { state.list = []; state.hasMore = false }
      try {
        const list = await api.baList(typ, { size: PAGE_SIZE, page })
        if (request !== listRequest) return false
        state.list = unique(more ? [...state.list, ...list] : list)
        state.listPage = page; state.hasMore = list.length >= PAGE_SIZE
        if (typ === 3) { state.mine = state.list; state.myIds = [...new Set([...state.myIds, ...state.list.map(idOf)])] }
        if (typ === 1) { state.followIds = [...new Set([...state.followIds, ...list.map(idOf)])]; state.followReady = true }
        return true
      } catch (e: any) { if (request === listRequest) state.listError = e?.message || '加载失败'; return false }
      finally { if (request === listRequest) state.loading = false }
    }
    async function readIdentityList(type: number, identity: number) {
      const all: any[] = [], seen = new Set<string>()
      for (let page = 1; ; page++) {
        const batch = await api.baList(type, { size: PAGE_SIZE, page })
        if (identity !== identityRequest) return null
        let added = 0
        for (const b of batch) if (!seen.has(String(b.id))) { seen.add(String(b.id)); all.push(b); added++ }
        if (batch.length < PAGE_SIZE || !added) return all
      }
    }
    async function mine() {
      const request = identityRequest
      try {
        const list = await readIdentityList(3, request)
        if (list && request === identityRequest) { state.mine = list; state.myIds = list.map(idOf) }
        return list || []
      } catch { return [] }
    }
    function countOf(typ: number) { return typ === 3 ? state.myIds.length : '' }
    async function create(name: string, avatar = '') {
      name = name.trim()
      if (!name || [...name].length > 10) { ui.toast('板块名称应为 1～10 个字', 'warn'); return false }
      if (state.creating) return false
      state.creating = true
      const identity = identityRequest
      try {
        const id = await api.baCreate(name, avatar)
        if (identity !== identityRequest) return false
        state.newAvatar = ''; ui.toast(id ? `板块已创建（ID ${id}）` : '板块已创建', 'success')
        await mine(); await load(3)
        return true
      } catch (e) { return fail('创建失败：', e) }
      finally { state.creating = false }
    }
    function updateBoard(id: number, patch: any) {
      for (const list of [state.list, state.mine]) for (const b of list) if (idOf(b) === Number(id)) Object.assign(b, patch)
      for (const b of [state.viewing, state.info, state.groupsOf]) if (b && idOf(b) === Number(id)) Object.assign(b, patch)
    }
    async function edit(id: number, patch: any) {
      if (!owns(id) || state.saving) return false
      const name = String(patch.name || '').trim()
      if (!name || [...name].length > 10) { ui.toast('板块名称应为 1～10 个字', 'warn'); return false }
      state.saving = true
      const identity = identityRequest
      try { await api.baEdit(id, { ...patch, name }); if (identity !== identityRequest) return false; updateBoard(id, { ...patch, name }); ui.toast('板块信息已保存', 'success'); return true }
      catch (e) { return fail('保存失败：', e) }
      finally { state.saving = false }
    }
    async function manage(id: number, visibleRange = 0, publishAuthority = 0) {
      if (!owns(id) || state.managing) return false
      state.managing = true
      const identity = identityRequest
      try { await api.baManage(id, visibleRange, publishAuthority); if (identity !== identityRequest) return false; updateBoard(id, { visibleRange, publishAuthority }); ui.toast('权限已更新', 'success'); return true }
      catch (e) { return fail('更新失败：', e) }
      finally { state.managing = false }
    }
    async function loadGroups(ba: any, more = false) {
      if (!ba || (more && (state.loadingGroups || !state.hasMoreGroups))) return false
      const request = ++groupRequest, page = more ? state.groupPage + 1 : 1
      state.groupsOf = ba; state.groupsError = ''; state.loadingGroups = true
      if (!more) { state.groups = []; state.hasMoreGroups = false; state.bindGroupId = '' }
      try {
        const groups = await api.baGroups(ba.id, { size: PAGE_SIZE, page })
        if (request !== groupRequest) return false
        const merged = more ? [...state.groups, ...groups] : groups
        state.groups = [...new Map(merged.map(g => [String(g.groupId ?? g.id), g])).values()]
        state.groupPage = page; state.hasMoreGroups = groups.length >= PAGE_SIZE
        return true
      } catch (e: any) { if (request === groupRequest) state.groupsError = e?.message || '群聊加载失败'; return false }
      finally { if (request === groupRequest) state.loadingGroups = false }
    }
    function closeGroups() { ++groupRequest; state.groupsOf = null; state.groups = []; state.loadingGroups = false }
    async function bindGroup(baId: number, groupId: string) {
      groupId = String(groupId || '').trim()
      if (!groupId) { ui.toast('请填写群 ID', 'warn'); return false }
      if (!owns(baId) || state.binding) return false
      if (typeof api.bindBaGroup !== 'function') { ui.toast('当前 API 不支持绑定群聊', 'error'); return false }
      state.binding = true
      const ba = state.groupsOf, identity = identityRequest
      try {
        await api.bindBaGroup(baId, groupId); if (identity !== identityRequest) return false; ui.toast('群聊已绑定', 'success')
        if (state.groupsOf === ba) await loadGroups(ba)
        return true
      } catch (e) { return fail('绑定失败：', e) }
      finally { state.binding = false }
    }
    async function enter(ba: any) {
      if (!ba) return false
      const request = ++boardRequest; ++detailRequest
      state.viewing = ba; state.info = null; state.posts = []; state.postDetail = null
      state.postPage = 1; state.hasMorePosts = false; state.loadingPosts = true
      state.loadingDetail = false; state.postsError = ''; state.detailError = ''
      // 资料失败不阻塞文章，也不把上一个板块的统计留在标题里。
      void api.baInfo(ba.id).then(info => { if (request === boardRequest) state.info = info }).catch(() => {})
      try {
        const posts = await api.baPosts(ba.id, { size: PAGE_SIZE, page: 1 })
        if (request !== boardRequest) return false
        state.posts = unique(posts); state.hasMorePosts = posts.length >= PAGE_SIZE
        return true
      } catch (e: any) { if (request === boardRequest) state.postsError = e?.message || '文章加载失败'; return false }
      finally { if (request === boardRequest) state.loadingPosts = false }
    }
    function backToPosts() { ++detailRequest; state.postDetail = null; state.loadingDetail = false; state.detailError = '' }
    function exitBoard() { ++boardRequest; backToPosts(); state.viewing = null; state.posts = []; state.info = null; state.loadingPosts = false }
    async function openPost(p: any) {
      if (!state.viewing) return false
      const request = ++detailRequest, board = boardRequest
      state.postDetail = p; state.loadingDetail = true; state.detailError = ''
      try {
        const d = await api.baPostDetail(p.id)
        if (request !== detailRequest || board !== boardRequest) return false
        if (!d) throw new Error('服务端未返回文章内容')
        state.postDetail = { ...p, ...d, ...(d.post || {}) }
        return true
      } catch (e: any) {
        if (request === detailRequest && board === boardRequest) state.detailError = '完整文章加载失败：' + (e?.message || '请重试')
        return false
      } finally { if (request === detailRequest && board === boardRequest) state.loadingDetail = false }
    }
    async function loadMorePosts() {
      if (!state.viewing || state.loadingPosts || !state.hasMorePosts) return false
      const request = boardRequest, ba = state.viewing, page = state.postPage + 1
      state.loadingPosts = true; state.postsError = ''
      try {
        const more = await api.baPosts(ba.id, { size: PAGE_SIZE, page })
        if (request !== boardRequest) return false
        state.posts = unique([...state.posts, ...more]); state.postPage = page; state.hasMorePosts = more.length >= PAGE_SIZE
        return true
      } catch (e: any) { if (request === boardRequest) state.postsError = e?.message || '加载更多失败'; return false }
      finally { if (request === boardRequest) state.loadingPosts = false }
    }
    async function uploadAvatar(ev: any, target: 'new' | 'edit') {
      const f = ev?.target?.files?.[0], editing = state.editing
      if (!f || state.uploading) return false
      if (!f.type.startsWith('image/') || f.size > 10 * 1024 * 1024) { ui.toast('请选择 10MB 以内的图片', 'warn'); ev.target.value = ''; return false }
      state.uploading = true
      const identity = identityRequest
      try {
        const res = await api.uploadFile(f, 'image'), key = typeof res === 'string' ? res : res?.key
        if (identity !== identityRequest) return false
        if (!res?.url && !key) throw new Error('未返回图片地址')
        const url = res?.url || (/^https?:\/\//.test(key) ? key : `https://chat-img.jwznb.com/${key}`)
        if (target === 'new') state.newAvatar = url
        else if (state.editing === editing && editing) editing.avatar = url
        return true
      } catch (e) { return fail('上传失败：', e) }
      finally { state.uploading = false; ev.target.value = '' }
    }
    const createWithAvatar = (name: string) => create(name, state.newAvatar || '')
    function focus(ba: any) {
      if (!ba) return
      if (!state.list.some(b => idOf(b) === idOf(ba))) state.list = [ba, ...state.list]
      void enter(ba)
    }
    async function loadFollows() {
      const request = identityRequest, version = followsVersion
      try {
        const list = await readIdentityList(1, request)
        if (list && request === identityRequest && version === followsVersion && !state.following.length) { state.followIds = list.map(idOf); state.followReady = true }
      } catch { /* 失败不把已知关注状态清空，避免误操作。 */ }
    }
    const isFollowed = (id: number) => state.followIds.includes(Number(id))
    async function toggleFollow(b: any) {
      const id = idOf(b)
      if (!state.followReady) { await loadFollows(); if (!state.followReady) { ui.toast('关注状态未加载，请重试', 'warn'); return false } }
      if (state.following.includes(id)) return false
      state.following.push(id); ++followsVersion
      const identity = identityRequest
      try {
        if (isFollowed(id)) { await api.unfollowBoard(id); if (identity !== identityRequest) return false; state.followIds = state.followIds.filter(x => x !== id); if (state.listType === 1) state.list = state.list.filter(x => idOf(x) !== id) }
        else { await api.followBoard(id); if (identity !== identityRequest) return false; state.followIds = [...state.followIds, id] }
        return true
      } catch (e) { return fail('关注操作失败：', e) }
      finally { state.following = state.following.filter(x => x !== id) }
    }
    ctx.set('community', { state, load, mine, countOf, owns, create, createWithAvatar, edit, manage, loadGroups, closeGroups, bindGroup, enter, exitBoard, backToPosts, openPost, uploadAvatar, focus, loadFollows, isFollowed, toggleFollow, loadMorePosts })
    function resetAccount() {
      ++identityRequest; ++listRequest; ++followsVersion; exitBoard(); closeGroups()
      state.list = []; state.mine = []; state.myIds = []; state.followIds = []; state.followReady = false
      state.following = []; state.editing = null; state.newAvatar = ''; state.loading = false; state.listError = ''
    }
    ctx.on('auth/ready' as any, () => mine())
    ctx.on('auth/login' as any, () => { resetAccount(); void mine() })
    ctx.on('auth/logout' as any, resetAccount)
    mine()
    ctx.setTimeout(() => { if (!state.mine.length) mine() }, 3000)
    ctx.setTimeout(() => { if (!state.mine.length) mine() }, 8000)
    ctx.console.addEntry((cc: any) => { cc.page({ name: '板块', path: '/community', icon: 'layers', order: 170, component: CommunityPage }) })
  },
}
