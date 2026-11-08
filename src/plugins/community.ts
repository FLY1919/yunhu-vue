/** 板块服务：按请求归属接收结果，避免快速切换时串板、丢页和重复提交。 */
import Schema from 'schemastery'
import { computed, reactive } from 'vue'
import { commentAuthorAvatar, readCommentPin, writeCommentPin } from '../core/community-comments'
import type { Context } from '../core/context'
import CommunityPage from '../console/pages/CommunityPage.vue'
import { readCommunityDrafts, removeCommunityDraft, communityFlag, type CommunityDraft } from '../core/community-drafts'

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
      postDetail: null as any, sharedPost: false, loadingPosts: false, loadingDetail: false,
      postsError: '', detailError: '', info: null as any,
      newAvatar: '', editing: null as any, creating: false, saving: false, managing: false,
      uploading: false, following: [] as number[], followReady: false,
      comments: [] as any[], commentPin: null as ReturnType<typeof readCommentPin>, pinnedComment: null as any, commentPage: 0, hasMoreComments: false, loadingComments: false, commentsError: '',
      commentText: '', replyTo: null as any, commenting: false, actions: [] as string[],
      editor: null as CommunityDraft | null, drafts: [] as CommunityDraft[], publishing: false, savingDraft: false, draftsLoading: false, draftsError: '', draftPage: 1, hasMoreDrafts: false, editorError: '', savedAt: 0,
    })
    const owner = () => String((ctx as any).auth?.state?.user?.id || '')
    const commentPages = new Map<string, number>()
    const avatars = reactive(new Map<string, string>())
    const avatarQueue = new Set<string>()
    const avatarFlights = new Set<string>()
    const orderedComments = computed(() => {
      const id = state.commentPin?.id
      if (!id) return state.comments
      const pin = state.comments.find(c => String(c.id) === id) || state.pinnedComment
      return pin ? [pin, ...state.comments.filter(c => String(c.id) !== id)] : state.comments
    })
    function loadCommentAvatars(comments: any[]) {
      if (typeof api.getUser !== 'function') return
      for (const c of comments.flatMap(c => [c, ...(Array.isArray(c.replies) ? c.replies : [])])) {
        const id = String(c.senderId || '')
        if (id && !commentAuthorAvatar(c) && !avatars.has(id) && !avatarFlights.has(id)) avatarQueue.add(id)
      }
      pumpAvatars()
    }
    function pumpAvatars() {
      const identity = identityRequest
      for (const id of avatarQueue) {
        if (avatarFlights.size >= 4) break
        avatarQueue.delete(id); avatarFlights.add(id)
        void Promise.resolve().then(() => api.getUser(id, { timeout: 5000 })).then(user => {
          if (identity !== identityRequest) return
          if (avatars.size >= 300) avatars.delete(avatars.keys().next().value!)
          avatars.set(id, String(user?.avatar || user?.avatarUrl || ''))
        }).catch(() => {}).finally(() => {
          if (identity !== identityRequest) return
          avatarFlights.delete(id); pumpAvatars()
        })
      }
    }
    const commentAvatar = (c: any) => commentAuthorAvatar(c) || avatars.get(String(c?.senderId || ''))
    let commentsRequest = 0
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
      state.sharedPost = false; state.viewing = ba; state.info = null; state.posts = []; state.postDetail = null
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
    function backToPosts() { state.sharedPost = false; ++detailRequest; ++commentsRequest; state.postDetail = null; state.loadingDetail = false; state.detailError = ''; state.comments = []; state.commentPin = null; state.pinnedComment = null; commentPages.clear(); avatarQueue.clear(); state.loadingComments = false; state.commentText = ''; state.replyTo = null }
    function exitBoard() { ++boardRequest; backToPosts(); state.viewing = null; state.posts = []; state.info = null; state.loadingPosts = false }
    function openPostList() {
      if (!state.sharedPost) { backToPosts(); return }
      const board = state.viewing
      if (board?.id) void enter(board)
      else exitBoard()
    }
    function openSharedBoard(id: number, title?: string) {
      if (!Number.isSafeInteger(id) || id <= 0) return false
      const board = state.mine.find(ba => Number(ba.id) === id)
        || state.list.find(ba => Number(ba.id) === id)
      const opening = enter(board || { id, name: title?.slice(0, 300) || `板块 ${id}` })
      ctx.console.goto('/community')
      return opening
    }
    function openSharedPost(p: any) {
      exitBoard()
      state.sharedPost = true
      state.viewing = { name: '分享的文章' }
      const opening = openPost(p)
      ctx.console.goto('/community')
      return opening
    }
    async function openPost(p: any) {
      if (!state.viewing) return false
      const request = ++detailRequest, board = boardRequest
      state.postDetail = p; state.loadingDetail = true; state.detailError = ''
      state.comments = []; state.commentPin = owner() ? readCommentPin(owner(), String(p.id)) : null
      state.pinnedComment = null; commentPages.clear(); avatarQueue.clear(); state.commentPage = 0; state.hasMoreComments = false; state.loadingComments = false; state.commentsError = ''; state.commentText = ''; state.replyTo = null
      try {
        const d = await api.baPostDetail(p.id)
        if (request !== detailRequest || board !== boardRequest) return false
        if (!d) throw new Error('服务端未返回文章内容')
        const post = d.post || d
        state.postDetail = { ...p, ...d, ...post, id: p.id, content: post.content ?? post.body ?? post.text ?? d.postContent ?? '',
          contentType: post.contentType ?? post.content_type ?? p.contentType }
        if (state.sharedPost) {
          const ba = d.ba || d.board || post.ba || {}
          const id = Number(ba.id || post.baId || d.baId || post.ba_id)
          if (id > 0) {
            const known = [...state.list, ...state.mine].find(item => Number(item.id) === id)
            state.viewing = { ...known, ...ba, id, name: ba.name || post.baName || known?.name || '文章所属板块' }
          }
        }
        if (d.ba) state.info = { ...state.info, ...d.ba }
        if (typeof api.baComments === 'function') void loadComments()
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
        const was = isFollowed(id)
        if (was) { await api.unfollowBoard(id); if (identity !== identityRequest) return false; state.followIds = state.followIds.filter(x => x !== id); if (state.listType === 1) state.list = state.list.filter(x => idOf(x) !== id) }
        else { await api.followBoard(id); if (identity !== identityRequest) return false; state.followIds = [...state.followIds, id] }
        const known = Number(state.info?.id) === id ? state.info : b
        if (known.memberNum != null) updateBoard(id, { memberNum: Math.max(0, Number(known.memberNum) + (was ? -1 : 1)) })
        return true
      } catch (e) { return fail('关注操作失败：', e) }
      finally { state.following = state.following.filter(x => x !== id) }
    }
    async function action(key: string, run: () => Promise<any>, success: () => void) {
      if (state.actions.includes(key)) return false
      const identity = identityRequest
      state.actions.push(key)
      try { await run(); if (identity !== identityRequest) return false; success(); return true }
      catch (e) { return fail('操作失败：', e) }
      finally { if (identity === identityRequest) state.actions = state.actions.filter(k => k !== key) }
    }
    function patchPost(id: number, patch: any) {
      for (const p of [...state.posts, state.postDetail]) if (p && Number(p.id) === id) Object.assign(p, patch)
    }
    async function togglePost(kind: 'like' | 'collect') {
      const p = state.postDetail
      if (!p || state.loadingDetail || state.detailError) return false
      const id = Number(p.id), field = kind === 'like' ? 'isLiked' : 'isCollected', count = kind === 'like' ? 'likeNum' : 'collectNum', was = communityFlag(p[field])
      return action(kind + ':' + id, () => kind === 'like' ? api.baPostLike(id) : api.baPostCollect(id), () => patchPost(id, { [field]: was ? 0 : 1, [count]: Math.max(0, Number(p[count] || 0) + (was ? -1 : 1)) }))
    }
    async function loadComments(more = false) {
      const p = state.postDetail
      if (!p || (more && (state.loadingComments || !state.hasMoreComments))) return false
      const request = detailRequest, commentRequest = ++commentsRequest, page = more ? state.commentPage + 1 : 1
      state.loadingComments = true; state.commentsError = ''
      try {
        const result = await api.baComments(p.id, { page, size: 20 })
        if (request !== detailRequest || commentRequest !== commentsRequest) return false
        const list = Array.isArray(result) ? result : result.comments || []
        if (!more) { commentPages.clear(); state.pinnedComment = null }
        for (const c of list) commentPages.set(String(c.id), page)
        state.comments = unique(more ? [...state.comments, ...list] : list); state.commentPage = page
        loadCommentAvatars(list)
        const pin = state.commentPin
        if (!more && pin && pin.page > 1 && !commentPages.has(pin.id)) {
          void api.baComments(p.id, { page: pin.page, size: 20 }).then((batch: any) => {
            if (request !== detailRequest || state.commentPin?.id !== pin.id) return
            const found = (Array.isArray(batch) ? batch : batch.comments || []).find((c: any) => String(c.id) === pin.id)
            if (found) { state.pinnedComment = found; loadCommentAvatars([found]) }
          }).catch(() => {})
        }
        state.hasMoreComments = list.length >= 20 && (result.total == null || state.comments.length < Number(result.total))
        return true
      } catch (e: any) { if (request === detailRequest && commentRequest === commentsRequest) state.commentsError = e.message || '评论加载失败'; return false }
      finally { if (request === detailRequest && commentRequest === commentsRequest) state.loadingComments = false }
    }
    async function comment() {
      const p = state.postDetail, text = state.commentText.trim(), request = detailRequest, identity = identityRequest
      if (!p || !text || state.commenting || state.loadingDetail || state.detailError) return false
      if (text.length > 5000) return fail('', new Error('评论不能超过 5000 字'))
      const reply = Number(state.replyTo?.id || 0)
      state.commenting = true
      try {
        await api.baComment(p.id, text, reply)
        if (identity !== identityRequest) return false
        patchPost(Number(p.id), { commentNum: Number(p.commentNum || 0) + 1 })
        if (request === detailRequest) { state.commentText = ''; state.replyTo = null; await loadComments() }
        ui.toast('评论已发送', 'success'); return true
      } catch (e) { return fail('评论失败：', e) }
      finally { if (identity === identityRequest) state.commenting = false }
    }
    const canEditPost = (p: any) => !!owner() && String(p?.senderId) === owner()
    async function deletePost() {
      const p = state.postDetail, identity = identityRequest
      if (!p || !(canEditPost(p) || owns(state.viewing)) || !(await ui.confirm?.('删除文章', '删除后无法恢复，确定继续？', { danger: true })) || identity !== identityRequest) return false
      return action('delete:' + p.id, () => api.baDeletePost(Number(p.id)), () => {
        state.posts = state.posts.filter(x => Number(x.id) !== Number(p.id))
        if (Number(state.postDetail?.id) === Number(p.id)) backToPosts()
        ui.toast('文章已删除', 'success')
      })
    }
    function toggleCommentPin(c: any) {
      const user = owner(), post = state.postDetail
      const id = String(c.id)
      if (!user || !post || !/^[0-9]+$/.test(id)) return
      const pin = state.commentPin?.id === id ? null : { id, page: commentPages.get(id) || 1 }
      if (!writeCommentPin(user, String(post.id), pin)) return fail('', new Error('无法保存本机置顶'))
      state.commentPin = pin
      state.pinnedComment = pin ? c : null
    }
    async function commentAction(c: any, deleting = false) {
      const request = detailRequest, identity = identityRequest, p = state.postDetail
      if (!p) return false
      if (deleting && (!(String(c.senderId) === owner() || owns(state.viewing)) || !(await ui.confirm?.('删除评论', '确定删除这条评论？', { danger: true })))) return false
      if (identity !== identityRequest || request !== detailRequest) return false
      const was = communityFlag(c.isLiked)
      return action('comment:' + c.id, () => deleting ? api.baDeleteComment(Number(c.id)) : api.baCommentLike(Number(c.id)), () => {
        if (request !== detailRequest) return
        if (deleting) { if (state.commentPin?.id === String(c.id)) toggleCommentPin(c); state.comments = state.comments.filter(x => x.id !== c.id); patchPost(Number(p.id), { commentNum: Math.max(0, Number(p.commentNum || 0) - 1) }) }
        else { c.isLiked = was ? 0 : 1; c.likeNum = Math.max(0, Number(c.likeNum || 0) + (was ? -1 : 1)) }
      })
    }
    const fingerprint = (d: CommunityDraft) => JSON.stringify([d.baId, d.postId, d.title, d.content, d.contentType])
    let savedFingerprint = '', draftRequest = 0, editorRequest = 0
    const editorDirty = () => !!state.editor && fingerprint(state.editor) !== savedFingerprint
    const asCloudDraft = (d: any): CommunityDraft => ({ id: 'cloud:' + d.id, cloudId: Number(d.id), owner: owner(),
      baId: Number(d.baId || d.ba?.id || 0), boardName: d.ba?.name || d.boardName || '云端草稿',
      title: String(d.title || ''), content: String(d.content || ''), contentType: Number(d.contentType) === 1 ? 1 : 2,
      updatedAt: Number(d.updateTime || d.editTime || d.createTime || 0) * (Number(d.updateTime || d.createTime || 0) < 1e12 ? 1000 : 1) })
    async function refreshDrafts(more = false) {
      const identity = identityRequest, account = owner(), request = ++draftRequest
      if (!account) { state.drafts = []; return }
      state.draftsLoading = true; state.draftsError = ''
      try {
        const page = more ? state.draftPage + 1 : 1
        const result = await api.baDrafts({ page, size: 50 })
        if (identity !== identityRequest || owner() !== account || request !== draftRequest) return
        const cloud = result.list.map(asCloudDraft).filter((d: CommunityDraft) => Number.isSafeInteger(d.cloudId) && d.cloudId > 0)
        const old = more ? state.drafts.filter(d => !d.legacy) : []
        const combined = [...new Map([...old, ...cloud].map(d => [d.id, d])).values()]
        let legacy: CommunityDraft[] = []
        try { legacy = readCommunityDrafts(account).map(d => ({ ...d, legacy: true })) } catch { /* Cloud saving never depends on browser storage. */ }
        state.drafts = [...combined.sort((a, b) => b.updatedAt - a.updatedAt), ...legacy]
        state.draftPage = page; state.hasMoreDrafts = !!result.more
      } catch (e: any) {
        if (identity === identityRequest && request === draftRequest) {
          state.draftsError = '读取云端草稿失败：' + e.message
          try {
            const local = readCommunityDrafts(account).map(d => ({ ...d, legacy: true }))
            state.drafts = [...state.drafts.filter(d => !d.legacy), ...local]
          } catch { /* Keep the existing list if browser storage is unavailable. */ }
        }
      } finally { if (identity === identityRequest && request === draftRequest) state.draftsLoading = false }
    }
    async function saveDraft(options: { silent?: boolean } = {}) {
      const d = state.editor, identity = identityRequest
      if (!d || d.owner !== owner() || state.savingDraft || state.publishing) return false
      if (!d.title.trim() && !d.content.trim()) { state.editorError = '请先填写标题或正文'; return false }
      if (d.title.length > 200 || d.content.length > 200000) { state.editorError = '标题最多 200 字，正文最多 20 万字'; return false }
      const snapshot = { ...d }, signature = fingerprint(snapshot)
      state.savingDraft = true; state.editorError = ''
      try {
        const cloudId = await api.baSaveDraft(snapshot.baId, snapshot.title, snapshot.content, snapshot.contentType, snapshot.cloudId || 0)
        if (identity !== identityRequest || d !== state.editor || owner() !== snapshot.owner) return false
        // Updating a cloud draft replaces its ID. Always retain the new ID, even if text changed in flight.
        d.cloudId = cloudId; d.updatedAt = Date.now(); savedFingerprint = signature; draftRequest++; state.draftsLoading = false
        state.savedAt = fingerprint(d) === signature ? d.updatedAt : 0
        // A local recovery copy may be newer than the in-flight cloud snapshot.
        if (state.savedAt) { try { removeCommunityDraft(d.owner, d.id) } catch {} }
        d.legacy = false
        const item = { ...snapshot, cloudId, id: 'cloud:' + cloudId, updatedAt: d.updatedAt }
        state.drafts = [item, ...state.drafts.filter(x => x.cloudId !== snapshot.cloudId && x.id !== snapshot.id && x.cloudId !== cloudId)]
        if (!options.silent) ui.toast(state.savedAt ? '草稿已保存到云端' : '已保存点击时的版本，后续修改尚未保存', 'success')
        return true
      } catch (e: any) { if (identity === identityRequest && d === state.editor) state.editorError = '云端草稿保存失败，编辑内容已保留：' + e.message; return false }
      finally { if (identity === identityRequest) state.savingDraft = false }
    }
    function openEditor(draft?: CommunityDraft, post?: any) {
      editorRequest++
      if (!owner() || (!state.viewing && !draft) || state.publishing || state.savingDraft || (post && !canEditPost(post))) return false
      if (state.editor && editorDirty()) { state.editorError = '请先保存当前草稿或关闭编辑器'; return false }
      state.editor = draft ? { ...draft } : { id: crypto.randomUUID(), owner: owner(), baId: Number(state.viewing.id), boardName: state.viewing.name,
        postId: post?.id, title: post?.title || '', content: post?.content || '', contentType: Number(post?.contentType || 2), updatedAt: Date.now() }
      if (!state.editor.baId && state.viewing?.id) { state.editor.baId = Number(state.viewing.id); state.editor.boardName = state.viewing.name }
      if (state.editor.owner !== owner()) { state.editor = null; return false }
      savedFingerprint = draft || post ? fingerprint(state.editor) : fingerprint({ ...state.editor, title: '', content: '' })
      state.savedAt = draft?.cloudId ? draft.updatedAt : 0; state.editorError = ''; return true
    }
    async function resumeDraft(draft: CommunityDraft) {
      const identity = identityRequest, request = ++editorRequest
      try {
        const detail = draft.cloudId && !draft.legacy ? await api.baGetDraft(draft.cloudId, 0) : null
        if (identity !== identityRequest || request !== editorRequest || draft.owner !== owner()) return false
        return openEditor(detail ? asCloudDraft({ ...detail, baId: detail.baId || detail.ba?.id || draft.baId, ba: detail.ba || { name: draft.boardName } }) : draft)
      } catch (e: any) { if (identity === identityRequest) state.draftsError = '打开云端草稿失败：' + e.message; return false }
    }
    async function closeEditor() {
      editorRequest++
      const d = state.editor
      if (state.publishing || state.savingDraft) return false
      if (d && editorDirty()) {
        if (!await ui.confirm?.('放弃未保存的修改', '这部分内容尚未保存到云端，确定关闭？', { okText: '放弃修改', cancelText: '继续编辑' })) return false
      }
      if (d !== state.editor) return false
      if (d) { try { removeCommunityDraft(d.owner, d.id) } catch {} }
      state.editor = null; return true
    }
    async function publish() {
      const d = state.editor, identity = identityRequest
      if (!d || state.publishing || state.savingDraft || d.owner !== owner()) return false
      if (!d.baId) { state.editorError = '请先进入要发布的板块，再打开这份草稿'; return false }
      if (!d.title.trim() || !d.content.trim()) { state.editorError = '请填写标题和正文'; return false }
      if (d.title.length > 200 || d.content.length > 200000) { state.editorError = '标题最多 200 字，正文最多 20 万字'; return false }
      state.publishing = true; state.editorError = ''
      try {
        if (d.postId) await api.baEditPost(d.postId, d.title.trim(), d.content, d.contentType)
        else await api.baCreatePost(d.baId, d.title.trim(), d.content, d.contentType, d.cloudId || 0)
        if (identity !== identityRequest) return false
        if (d.postId && d.cloudId) { try { await api.baDeleteDraft(d.cloudId) } catch { ui.toast('文章已更新，云端草稿未清理，可在草稿列表手动删除', 'warn') } }
        try { removeCommunityDraft(d.owner, d.id) } catch {}
        state.editor = null; void refreshDrafts(); ui.toast(d.postId ? '文章已更新' : '文章已发布', 'success')
        if (Number(state.viewing?.id) === d.baId) await enter(state.viewing)
        return true
      } catch (e: any) { if (identity === identityRequest) state.editorError = '发布失败，编辑内容已保留：' + e.message; return false }
      finally { if (identity === identityRequest) state.publishing = false }
    }
    async function deleteDraft(id: string, local?: boolean) {
      const d = state.drafts.find(d => d.id === id && (local === undefined || !!d.legacy === local)), identity = identityRequest
      if (!d || d.owner !== owner() || state.savingDraft || state.publishing) return
      try {
        if (d.cloudId && !d.legacy) await api.baDeleteDraft(d.cloudId)
        else removeCommunityDraft(owner(), id)
        if (identity !== identityRequest) return
        draftRequest++; state.draftsLoading = false; state.drafts = state.drafts.filter(item => item !== d)
      } catch (e) { if (identity === identityRequest) fail('删除草稿失败：', e) }
    }
    ctx.set('community', { state, load, mine, countOf, owns, create, createWithAvatar, edit, manage, loadGroups, closeGroups, bindGroup, enter, exitBoard, backToPosts, openPostList, openPost, openSharedPost, openSharedBoard, uploadAvatar, focus, loadFollows, isFollowed, toggleFollow, loadMorePosts,
      togglePost, loadComments, orderedComments, commentAvatar, toggleCommentPin, comment, canEditPost, deletePost, commentAction, openEditor, closeEditor, saveDraft, publish, refreshDrafts, deleteDraft, resumeDraft, editorDirty })
    function resetAccount() {
      state.editor = null; savedFingerprint = ''; draftRequest++; editorRequest++; state.savingDraft = false; state.draftsLoading = false; state.draftsError = ''; state.drafts = []; state.comments = []; state.commentPin = null; state.pinnedComment = null; commentPages.clear(); avatars.clear(); avatarQueue.clear(); avatarFlights.clear(); state.commentText = ''; state.replyTo = null; state.loadingComments = false; state.commenting = false; state.publishing = false; state.actions = []
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
