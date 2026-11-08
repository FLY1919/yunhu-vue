<script setup lang="ts">
import { computed, inject, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import KLayout from '../components/KLayout.vue'
import Icon from '../components/Icon.vue'
import CommunityAvatar from '../components/CommunityAvatar.vue'
import { fmtTime } from '../../core/util'
import { renderMarkdown } from '../../core/render'
import { fixResourceUrls } from '../../core/res'
import { commentAuthorName } from '../../core/community-comments'
import { communityFlag } from '../../core/community-drafts'

const ctx = inject<any>('ctx'), cm = ctx.community, s = cm.state
const TABS = [{ key: 2, label: '热门' }, { key: 1, label: '关注' }, { key: 3, label: '我的' }, { key: 4, label: '全部' }]
const search = ref(''), postSearch = ref(''), creating = ref(false), newName = ref('')
const dialog = ref<HTMLDialogElement>(), articleBody = ref<HTMLElement>()
const commentsSection = ref<HTMLElement>(), commentInput = ref<HTMLTextAreaElement>()
const commentEditing = ref(false)
const canComment = computed(() => !!s.postDetail && !s.loadingDetail && !s.detailError)
function showComments() {
  const section = commentsSection.value
  const reader = section?.closest('.reader-scroll')
  if (!section || !reader) return
  reader.scrollTo({ top: reader.scrollTop + section.getBoundingClientRect().top - reader.getBoundingClientRect().top,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
function replyToComment(comment: any) {
  s.replyTo = comment
  commentInput.value?.focus({ preventScroll: true })
}
function openCommentAuthor(comment: any) {
  if (comment.senderId) ctx.group?.openProfile?.({ id: String(comment.senderId), name: commentAuthorName(comment), avatar: cm.commentAvatar(comment) })
}
async function sendComment() {
  const post = s.postDetail?.id
  if (await cm.comment() && s.postDetail?.id === post) showComments()
}
const focusReading = ref(true), showLibrary = ref(false), showBoardTools = ref(false)
const reading = computed(() => !!s.postDetail)
const libraryCollapsed = computed(() => reading.value && focusReading.value && !showLibrary.value)
function toggleLibrary() {
  if (!focusReading.value) { focusReading.value = true; showLibrary.value = false }
  else showLibrary.value = !showLibrary.value
}
const dialogType = computed(() => draftsOpen.value ? 'drafts' : sharing.value ? 'share' : creating.value ? 'create' : s.editing ? 'edit' : s.groupsOf ? 'groups' : '')
const dialogTitle = computed(() => ({ create: '创建板块', edit: '管理板块', groups: '关联群聊', drafts: '云端草稿', share: '分享至会话' }[dialogType.value] || ''))
const busy = computed(() => s.creating || s.saving || s.managing || s.binding || s.uploading || s.savingDraft || sharingBusy.value)
const norm = (t: any) => String(t ?? '').normalize('NFKC').toLocaleLowerCase()
const boards = computed(() => s.list.filter((b: any) => norm(`${b.name} ${b.id}`).includes(norm(search.value.trim()))))
const posts = computed(() => s.posts.filter((p: any) => norm(`${p.title} ${p.senderName || p.senderId}`).includes(norm(postSearch.value.trim()))))
const owns = (b: any) => cm.owns(b)
const followed = (b: any) => cm.isFollowed(b.id)
const followBusy = (b: any) => s.following.includes(Number(b.id))
const articleHtml = computed(() => Number(s.postDetail?.contentType) === 1 ? '' : renderMarkdown(String(s.postDetail?.content || '')))
const canBind = typeof ctx.api?.bindBaGroup === 'function'
const permission = ref('')
const draftsOpen = ref(false), sharing = ref<'board' | 'post' | ''>(''), shareTarget = ref(''), sharingBusy = ref(false)
let groupInspectRequest = 0
const selectedGroup = ref<any>(null), groupJoined = ref(false), groupBusy = ref(false), groupError = ref('')
const shareTargets = computed(() => (ctx.chat?.state?.conversations || []).map((c: any) => ({ ...c, key: c.type + ':' + c.id })))
function showDrafts() { cm.refreshDrafts(); draftsOpen.value = true }
async function resumeDraft(draft: any) { if (await cm.resumeDraft(draft)) draftsOpen.value = false }
async function removeDraft(draft: any) { if (await ctx.ui.confirm?.('删除草稿', draft.cloudId && !draft.legacy ? '确定删除这篇云端草稿？此操作会同步到官方客户端。' : '确定删除这份本机恢复副本？', { danger: true })) cm.deleteDraft(draft.id, !!draft.legacy) }
function share(kind: 'board' | 'post') { sharing.value = kind; shareTarget.value = '' }
async function copyPostLink() {
  try { await navigator.clipboard.writeText('yunhu://post-detail?id=' + encodeURIComponent(s.postDetail.id)); ctx.ui.toast('文章链接已复制', 'success') }
  catch { ctx.ui.toast('无法使用剪贴板，请通过分享按钮选择会话', 'error') }
}
async function sendShare() {
  const target = shareTargets.value.find((c: any) => c.key === shareTarget.value), kind = sharing.value, board = s.viewing, post = s.postDetail
  const account = String(ctx.auth?.state?.user?.id || '')
  if (!target || sharingBusy.value) return
  sharingBusy.value = true
  try {
    if (kind === 'board') await ctx.api.baForward(Number(board.id), [{ chatId: String(target.id), chatType: target.type }])
    else await ctx.api.send(String(target.id), target.type, 6, { post_id: Number(post.id), post_title: post.title, post_content: String(post.content || '').slice(0, 200), post_content_type: Number(post.contentType) || 2 })
    if (account !== String(ctx.auth?.state?.user?.id || '')) return
    sharing.value = ''; ctx.ui.toast('已分享至「' + target.name + '」', 'success')
    if (String(ctx.chat?.state?.current?.id) === String(target.id) && ctx.chat.state.current.type === target.type) void ctx.chat.loadMessages?.()
  } catch (e: any) { ctx.ui.toast('分享失败：' + e.message, 'error') }
  finally { sharingBusy.value = false }
}
async function inspectGroup(group: any) {
  const request = ++groupInspectRequest, account = String(ctx.auth?.state?.user?.id || '')
  selectedGroup.value = group; groupJoined.value = false; groupBusy.value = true; groupError.value = ''
  try {
    const book = await ctx.api.addressBook()
    if (!Array.isArray(book?.groups)) throw new Error('通讯录未返回群列表')
    if (request === groupInspectRequest && account === String(ctx.auth?.state?.user?.id || '')) groupJoined.value = book.groups.some((g: any) => String(g.id) === String(group.groupId || group.id))
  } catch (e: any) { if (request === groupInspectRequest) groupError.value = '无法确认入群状态：' + e.message }
  finally { if (request === groupInspectRequest) groupBusy.value = false }
}
function goGroup() {
  const group = selectedGroup.value
  if (!group || !groupJoined.value || groupBusy.value || groupError.value) return
  const id = String(group.groupId || group.id)
  const conv = ctx.chat.state.conversations.find((c: any) => c.type === 2 && String(c.id) === id) || { id, type: 2, name: group.name, avatar: group.avatar || group.avatarUrl, unread: 0, preview: '', ts: Date.now() }
  cm.closeGroups(); selectedGroup.value = null; groupInspectRequest++; ctx.console.goto('/'); void ctx.chat.open(conv)
}
async function joinGroup() {
  const group = selectedGroup.value, account = String(ctx.auth?.state?.user?.id || ''), request = groupInspectRequest
  if (!group || groupBusy.value || groupError.value) return
  groupBusy.value = true
  try {
    await ctx.api.applyFriend(String(group.groupId || group.id), 2, '通过板块关联群聊申请加入')
    if (request !== groupInspectRequest || account !== String(ctx.auth?.state?.user?.id || '')) return
    ctx.ui.toast('加群申请已发送，开放群可直接加入', 'success')
    await inspectGroup(group)
  } catch (e: any) { if (request === groupInspectRequest) groupError.value = '加群失败：' + e.message }
  finally { if (request === groupInspectRequest) groupBusy.value = false }
}
const permissionChoices = [
  { value: '0:0', label: '公开 · 所有人可发文章' },
  { value: '0:1', label: '公开 · 仅我可发文章' },
  { value: '1:2', label: '仅自己可见' },
]
const preview = (p: any) => String(p.content || '').replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]').replace(/[#*`>]/g, '').slice(0, 100)
function openCreate() { s.newAvatar = ''; newName.value = ''; creating.value = true }
function editBoard(b: any) {
  if (!owns(b)) return
  s.editing = { ...b }
  const info = Number(s.info?.id) === Number(b.id) ? s.info : b
  permission.value = info.visibleRange != null && info.publishAuthority != null ? `${info.visibleRange}:${info.publishAuthority}` : ''
}
function closeDialog() {
  if (busy.value) return
  creating.value = false; s.editing = null; cm.closeGroups(); s.newAvatar = ''; draftsOpen.value = false; sharing.value = ''; selectedGroup.value = null; groupInspectRequest++
}
async function submitCreate() { if (await cm.createWithAvatar(newName.value)) { creating.value = false; newName.value = ''; search.value = '' } }
async function saveEdit() {
  const b = s.editing
  if (await cm.edit(b.id, { name: b.name, avatar: b.avatar })) s.editing = null
}
async function savePermissions() {
  if (!permission.value || !s.editing) return
  const [visible, publish] = permission.value.split(':').map(Number)
  await cm.manage(s.editing.id, visible, publish)
}
function selectTab(type: number) { search.value = ''; void cm.load(type) }
function selectBoard(b: any) { postSearch.value = ''; void cm.enter(b) }
function resetSearch() { search.value = '' }
function refresh() { void cm.load(s.listType); void cm.loadFollows() }
watch(dialogType, async type => {
  await nextTick()
  if (type && !dialog.value?.open) dialog.value?.showModal()
  else if (!type && dialog.value?.open) dialog.value.close()
})
watch(() => s.viewing?.id, () => { postSearch.value = '' })
watch(() => s.postDetail?.id, () => {
  focusReading.value = true; showLibrary.value = false; showBoardTools.value = false; commentEditing.value = false
})
watch(articleBody, body => { if (body) fixResourceUrls(body) })
watch(articleHtml, async () => { await nextTick(); fixResourceUrls(articleBody.value) })
onMounted(() => { void cm.load(s.listType || 2); void cm.mine(); void cm.loadFollows() })
onBeforeUnmount(() => { creating.value = false; s.editing = null; cm.closeGroups() })
</script>

<template>
  <KLayout class="community-page" :class="{ 'reading-article': reading, 'focus-reading': reading && focusReading }" ns="community" title="板块" desc="发现值得读的内容，找到同好。">
    <template #actions>
      <button class="secondary" @click="showDrafts"><Icon name="page" :size="16" />草稿</button>
      <button class="create-button" @click="openCreate"><Icon name="plus" :size="16" />创建板块</button>
    </template>

    <div class="community-toolbar">
      <nav class="community-tabs" aria-label="板块分类">
        <button v-for="t in TABS" :key="t.key" :aria-current="s.listType === t.key ? 'page' : undefined" :class="{ active: s.listType === t.key }" @click="selectTab(t.key)">{{ t.label }}</button>
      </nav>
      <div class="toolbar-search">
        <label class="search-box"><Icon name="search" :size="17" /><input v-model="search" aria-label="筛选已加载板块" placeholder="搜索名称或 ID" /><button v-if="search" class="icon-button" aria-label="清空板块搜索" @click="resetSearch"><Icon name="close" :size="14" /></button></label>
        <button class="icon-button refresh-button" :disabled="s.loading" aria-label="刷新板块" title="刷新板块" @click="refresh"><Icon name="refresh" :size="17" /></button>
      </div>
    </div>

    <div class="community-workspace" :class="{ 'has-selection': s.viewing, 'library-collapsed': libraryCollapsed }">
      <aside class="board-library" aria-label="板块列表" :aria-busy="s.loading">
        <Transition name="status-fade"><div v-if="s.loading" class="reader-loading" role="status" aria-label="正在加载板块"><span></span></div></Transition>
        <div class="section-label"><span>{{ TABS.find(t => t.key === s.listType)?.label }}板块</span><span>{{ s.list.length }} 个已加载</span></div>
        <div class="board-list">
          <p v-if="search" class="search-note">仅筛选已加载的板块</p>
          <div v-if="s.loading && !s.list.length" class="empty-state" role="status"><Icon name="layers" :size="28" /><b>正在寻找好内容</b><span>板块加载中…</span></div>
          <TransitionGroup name="board-list-motion" appear tag="div" class="board-rows">
          <div v-for="b in boards" :key="s.listType + ':' + b.id" class="board-row" :class="{ selected: Number(s.viewing?.id) === Number(b.id) }">
            <button class="board-open" :aria-label="`进入板块 ${b.name}`" :aria-pressed="Number(s.viewing?.id) === Number(b.id)" @click="selectBoard(b)">
              <CommunityAvatar :src="b.avatar" :name="b.name" />
              <span class="board-copy"><span class="board-name">{{ b.name }}<em v-if="owns(b)">我创建的</em></span><span class="board-id">ID {{ b.id }}<span v-if="b.memberNum != null"> · {{ b.memberNum }} 人关注</span><span v-if="b.lastActive"> · {{ fmtTime(b.lastActive) }} 活跃</span></span></span>
            </button>
            <button class="follow-quick icon-button" :class="{ followed: followed(b) }" :aria-label="`${followed(b) ? '取消关注' : '关注'} ${b.name}`" :aria-pressed="followed(b)" :disabled="followBusy(b)" :title="followed(b) ? '取消关注' : '关注板块'" @click="cm.toggleFollow(b)"><Icon :name="followed(b) ? 'check' : 'plus'" :size="16" /></button>
          </div>
          </TransitionGroup>
          <div v-if="s.listError" class="error-state" role="alert"><b>板块加载失败</b><p>{{ s.listError }}</p><button class="secondary" :disabled="s.loading" @click="cm.load(s.listType, s.list.length > 0)">重试</button></div>
          <div v-else-if="!boards.length && !s.loading" class="empty-state"><Icon name="layers" :size="28" /><b>{{ search ? '没有匹配的板块' : '这里还没有板块' }}</b><span>{{ search ? '换一个名称或 ID，或继续加载' : '试试热门分类，或创建自己的板块' }}</span><button v-if="search" class="secondary" @click="resetSearch">清除筛选</button></div>
          <button v-if="s.hasMore" class="load-more secondary" :disabled="s.loading" @click="cm.load(s.listType, true)">{{ s.loading ? '加载中…' : '加载更多板块' }}</button>
        </div>
      </aside>

      <section class="board-reader" aria-label="板块内容">
        <div v-if="!s.viewing" class="reader-welcome">
          <span class="welcome-icon"><Icon name="layers" :size="32" /></span>
          <span class="eyebrow">COMMUNITY</span><h3>从一个兴趣开始</h3><p>选择左侧板块，阅读文章、关注更新，<br />或看看有哪些同好群聊。</p><button class="secondary" @click="openCreate"><Icon name="plus" :size="16" />创建我的板块</button>
        </div>
        <template v-else>
          <header class="reader-header">
            <button class="mobile-back icon-button" aria-label="返回板块列表" @click="cm.exitBoard()"><Icon name="chevronLeft" :size="20" /></button>
            <button v-if="reading" class="library-toggle icon-button" :aria-label="libraryCollapsed ? '展开板块列表' : '收起板块列表'" :title="libraryCollapsed ? '展开板块列表' : '收起板块列表'" :aria-expanded="!libraryCollapsed" @click="toggleLibrary"><Icon name="layers" :size="18" /></button>
            <CommunityAvatar :src="s.info?.avatar || s.viewing.avatar" :name="s.info?.name || s.viewing.name" />
            <div class="reader-title"><span class="eyebrow">{{ s.viewing.id ? '板块 / ' + s.viewing.id : '会话文章' }}</span><h3>{{ s.info?.name || s.viewing.name }}</h3><div class="reader-stats"><span>{{ s.info?.postNum ?? '—' }} 篇文章</span><span>{{ s.info?.memberNum ?? s.viewing.memberNum ?? '—' }} 人关注</span><span>{{ s.info?.groupNum ?? '—' }} 个群聊</span></div></div>
            <template v-if="reading">
              <button class="icon-button" :aria-label="focusReading ? '退出专注阅读' : '专注阅读'" :title="focusReading ? '退出专注阅读' : '专注阅读'" :aria-pressed="focusReading" @click="focusReading = !focusReading; showLibrary = false"><Icon :name="focusReading ? 'collapse' : 'expand'" :size="18" /></button>
              <button class="icon-button" aria-label="板块操作" title="板块操作" :aria-expanded="showBoardTools" @click="showBoardTools = !showBoardTools"><Icon name="sliders" :size="18" /></button>
            </template>
            <button class="icon-button reader-close" aria-label="关闭板块" title="关闭板块" @click="cm.exitBoard()"><Icon name="close" :size="18" /></button>
          </header>
          <Transition name="board-tools"><div v-show="s.viewing.id && (!reading || showBoardTools)" class="reader-actions">
            <button class="follow-button" :class="{ 'secondary followed': followed(s.viewing) }" :disabled="followBusy(s.viewing)" :aria-pressed="followed(s.viewing)" @click="cm.toggleFollow(s.viewing)"><Icon :name="followed(s.viewing) ? 'check' : 'plus'" :size="15" />{{ followBusy(s.viewing) ? '处理中…' : followed(s.viewing) ? '已关注' : '关注板块' }}</button>
            <button class="secondary" @click="cm.openEditor()"><Icon name="pencil" :size="15" />发布文章</button>
            <button class="secondary" @click="share('board')"><Icon name="forward" :size="15" />分享板块</button>
            <button class="secondary" @click="selectedGroup = null; cm.loadGroups(s.viewing)"><Icon name="contacts" :size="15" />关联群聊</button>
            <button v-if="owns(s.viewing)" class="secondary" @click="editBoard(s.viewing)"><Icon name="sliders" :size="15" />管理</button>
            <button class="icon-button reader-refresh" :disabled="s.loadingPosts || s.loadingDetail" aria-label="刷新文章" title="刷新文章" @click="s.postDetail ? cm.openPost(s.postDetail) : cm.enter(s.viewing)"><Icon name="refresh" :size="16" /></button>
          </div>
          </Transition>
          <Transition name="status-fade"><div v-if="s.loadingPosts || s.loadingDetail" class="reader-loading" role="status" aria-label="正在加载文章"><span></span></div></Transition>
          <div class="reader-scroll">
            <Transition name="reader-content" mode="out-in">
            <div v-if="s.postDetail" :key="'article-' + s.postDetail.id">
              <div class="article-navigation"><button class="text-button" @click="cm.openPostList()"><Icon name="chevronLeft" :size="16" />{{ s.sharedPost && !s.viewing.id ? '板块首页' : '文章列表' }}</button><span>文章详情</span></div>
              <article class="article-detail">
                <h1>{{ s.postDetail.title || '无标题文章' }}</h1>
                <div class="post-meta"><span>{{ s.postDetail.senderName || s.postDetail.senderId || '匿名作者' }}</span><time v-if="s.postDetail.createTime">{{ fmtTime(s.postDetail.createTime) }}</time></div>
                <p v-if="s.loadingDetail" class="loading-note" role="status">正在加载完整文章…</p>
                <div v-if="s.detailError" class="error-state" role="alert"><p>{{ s.detailError }}</p><button class="secondary" @click="cm.openPost(s.postDetail)">重试文章</button></div>
                <div v-if="Number(s.postDetail.contentType) === 1" class="article-prose plain-article">{{ s.postDetail.content }}</div><div v-else ref="articleBody" class="article-prose" v-html="articleHtml"></div>
                <div class="article-footer">
                  <button class="secondary" @click="share('post')"><Icon name="forward" :size="15" />分享文章</button><button class="secondary" @click="copyPostLink">复制链接</button>
                  <button v-if="cm.canEditPost(s.postDetail)" class="secondary" :disabled="s.loadingDetail || !!s.detailError" @click="cm.openEditor(undefined, s.postDetail)">编辑文章</button>
                  <button v-if="cm.canEditPost(s.postDetail) || owns(s.viewing)" class="secondary danger" :disabled="s.loadingDetail || s.actions.includes('delete:' + s.postDetail.id)" @click="cm.deletePost()">删除文章</button>
                </div>
                <section ref="commentsSection" class="article-comments" aria-label="文章评论"><h3>评论 <span>{{ s.postDetail.commentNum ?? 0 }}</span></h3>
                  <p v-if="s.commentsError" role="alert">{{ s.commentsError }} <button class="text-button" @click="cm.loadComments()">重试评论</button></p>
                  <TransitionGroup name="post-list-motion" tag="div" class="comments-list">
                    <article v-for="c in cm.orderedComments.value" :key="c.id" class="comment-item">
                      <header>
                        <button class="text-button comment-author" @click="openCommentAuthor(c)">
                          <CommunityAvatar :src="cm.commentAvatar(c)" :name="commentAuthorName(c)" />{{ commentAuthorName(c) }}
                        </button>
                        <span v-if="s.commentPin?.id === String(c.id)" class="comment-pin"><Icon name="pinUp" :size="13" />本机置顶</span>
                        <time>{{ fmtTime(c.createTime) }}</time>
                      </header>
                      <p>{{ c.content }}</p>
                      <div class="comment-actions">
                        <button class="text-button" :aria-pressed="communityFlag(c.isLiked)" :disabled="s.actions.includes('comment:' + c.id)" @click="cm.commentAction(c)">{{ communityFlag(c.isLiked) ? '已赞' : '赞' }} {{ c.likeNum || 0 }}</button>
                        <button class="text-button" @click="replyToComment(c)">回复</button>
                        <button class="text-button" @click="cm.toggleCommentPin(c)">{{ s.commentPin?.id === String(c.id) ? '取消本机置顶' : '本机置顶' }}</button>
                        <button v-if="String(c.senderId) === String(ctx.auth?.state?.user?.id) || owns(s.viewing)" class="text-button" :disabled="s.actions.includes('comment:' + c.id)" @click="cm.commentAction(c, true)">删除</button>
                      </div>
                      <div v-for="r in c.replies || []" :key="r.id" class="comment-reply">
                        <button class="text-button comment-author" @click="openCommentAuthor(r)">
                          <CommunityAvatar :src="cm.commentAvatar(r)" :name="commentAuthorName(r)" />{{ commentAuthorName(r) }}
                        </button>
                        <p>{{ r.content }}</p>
                        <button class="text-button" @click="replyToComment(r)">回复</button>
                      </div>
                    </article>
                  </TransitionGroup>
                  <p v-if="s.loadingComments" role="status" class="end-note">评论加载中…</p><button v-else-if="s.hasMoreComments" class="secondary load-more" @click="cm.loadComments(true)">加载更多评论</button><p v-else-if="!s.comments.length && !s.commentsError" class="end-note">还没有评论，来聊聊吧。</p>
                </section>
              </article>
            </div>
            <div v-else :key="'posts-' + s.viewing.id">
              <div class="posts-heading"><h4>文章<span>{{ s.posts.length }}</span></h4><label v-if="s.posts.length || postSearch" class="search-box post-search"><Icon name="search" :size="15" /><input v-model="postSearch" placeholder="筛选已加载文章" aria-label="筛选已加载文章" /></label></div>
              <div v-if="s.loadingPosts && !s.posts.length" class="empty-state" role="status"><Icon name="page" :size="28" /><b>文章加载中…</b></div>
              <TransitionGroup name="post-list-motion" appear tag="div" class="post-list">
              <button v-for="p in posts" :key="p.id" class="post-card" @click="cm.openPost(p)">
                <span class="post-meta"><span>{{ p.senderName || p.senderId || '匿名作者' }}</span><time v-if="p.createTime">{{ fmtTime(p.createTime) }}</time></span>
                <strong>{{ p.title || '无标题文章' }}</strong><span v-if="p.content" class="post-excerpt">{{ preview(p) }}</span><span class="post-footer"><span>{{ p.likeNum ?? 0 }} 赞<span class="meta-dot">·</span>{{ p.commentNum ?? 0 }} 评论</span><span class="read-link">阅读全文 <Icon name="chevronRight" :size="14" /></span></span>
              </button>
              </TransitionGroup>
              <div v-if="s.postsError" class="error-state" role="alert"><b>文章加载失败</b><p>{{ s.postsError }}</p><button class="secondary" :disabled="s.loadingPosts" @click="s.posts.length ? cm.loadMorePosts() : cm.enter(s.viewing)">重试文章列表</button></div>
              <div v-else-if="!posts.length && !s.loadingPosts" class="empty-state"><Icon name="page" :size="28" /><b>{{ postSearch ? '没有匹配的文章' : '这个板块还没有文章' }}</b><span>{{ postSearch ? '试试其他标题或作者名' : '关注板块，之后再来看看吧' }}</span></div>
              <button v-if="s.hasMorePosts" class="load-more secondary" :disabled="s.loadingPosts" @click="cm.loadMorePosts()">{{ s.loadingPosts ? '加载中…' : '加载更多文章' }}</button>
              <p v-else-if="s.posts.length && !s.loadingPosts && !s.postsError" class="end-note">已显示全部文章</p>
            </div>
            </Transition>
          </div>
          <footer v-if="canComment" class="article-dock">
            <form class="comment-compose" :class="{ editing: commentEditing || s.replyTo || s.commentText }" @submit.prevent="sendComment">
              <div v-if="s.replyTo" class="reply-banner">
                <span>回复 {{ commentAuthorName(s.replyTo) }}</span>
                <button type="button" class="text-button" @click="s.replyTo = null; commentInput?.focus()">取消回复</button>
              </div>
              <div class="comment-field">
                <Icon name="pencil" :size="16" aria-hidden="true" />
                <textarea ref="commentInput" v-model="s.commentText" rows="1" maxlength="5000" aria-label="评论内容" placeholder="说点什么…" :disabled="s.commenting" @focus="commentEditing = true" @blur="commentEditing = false"></textarea>
                <button v-if="s.commentText.trim() || s.commenting" type="submit" :disabled="s.commenting || !s.commentText.trim()">{{ s.commenting ? '发送中…' : '发送' }}</button>
              </div>
            </form>
            <div class="article-reactions">
              <button aria-label="点赞文章" title="点赞文章" :aria-pressed="communityFlag(s.postDetail.isLiked)" :disabled="s.actions.includes('like:' + s.postDetail.id)" @click="cm.togglePost('like')"><Icon name="heart" :size="18" /><span>{{ s.postDetail.likeNum ?? 0 }}</span></button>
              <button aria-label="跳到评论" title="跳到评论" @click="showComments"><Icon name="chat" :size="18" /><span>{{ s.postDetail.commentNum ?? 0 }}</span></button>
              <button aria-label="收藏文章" title="收藏文章" :aria-pressed="communityFlag(s.postDetail.isCollected)" :disabled="s.actions.includes('collect:' + s.postDetail.id)" @click="cm.togglePost('collect')"><Icon name="star" :size="18" /><span>{{ s.postDetail.collectNum ?? 0 }}</span></button>
            </div>
          </footer>
        </template>
      </section>
    </div>

    <Teleport to="body">
      <dialog ref="dialog" class="community-dialog" :aria-label="dialogTitle" @cancel.prevent="closeDialog" @click="e => { if (e.target === dialog) closeDialog() }">
        <template v-if="dialogType">
          <header class="dialog-header"><div><span class="eyebrow">{{ dialogType === 'groups' ? s.groupsOf?.name : 'COMMUNITY' }}</span><h3>{{ dialogTitle }}</h3></div><button class="icon-button" aria-label="关闭对话框" :disabled="busy" @click="closeDialog"><Icon name="close" :size="20" /></button></header>
          <div v-if="draftsOpen" class="dialog-content"><p class="dialog-hint">编辑内容会自动保存到官方云端，也可点击“保存草稿”立即保存。断网时会保留本机临时草稿。</p><p v-if="s.draftsLoading" role="status">正在读取云端草稿…</p><p v-if="s.draftsError" role="alert">{{ s.draftsError }} <button @click="cm.refreshDrafts()">重试</button></p><div v-for="d in s.drafts" :key="(d.legacy ? 'local:' : 'cloud:') + d.id" class="draft-row"><button class="text-button" @click="resumeDraft(d)"><b>{{ d.title || '未命名草稿' }}</b><span>{{ d.legacy ? '本机恢复副本 · 点击打开并保存到云端' : d.boardName }} · {{ new Date(d.updatedAt).toLocaleString() }}</span></button><button class="text-button" @click="removeDraft(d)">删除</button></div><button v-if="s.hasMoreDrafts" :disabled="s.draftsLoading" @click="cm.refreshDrafts(true)">加载更多</button><p v-if="!s.drafts.length && !s.draftsLoading && !s.draftsError" class="end-note">还没有保存的草稿。</p></div>
          <form v-else-if="sharing" class="dialog-content" @submit.prevent="sendShare"><p class="dialog-hint">{{ sharing === 'post' ? s.postDetail?.title : s.viewing?.name }}</p><label class="field-label">选择会话<select v-model="shareTarget" :disabled="sharingBusy"><option value="" disabled>请选择接收的会话</option><option v-for="c in shareTargets" :key="c.key" :value="c.key">{{ c.name || c.id }} · {{ c.type === 2 ? '群聊' : c.type === 3 ? '机器人' : '私聊' }}</option></select></label><p v-if="!shareTargets.length" class="dialog-hint">暂无会话，请先建立会话。</p><footer class="dialog-footer"><button type="button" class="secondary" :disabled="sharingBusy" @click="closeDialog">取消</button><button :disabled="!shareTarget || sharingBusy">{{ sharingBusy ? '分享中…' : '发送分享' }}</button></footer></form>
          <form v-else-if="creating" class="dialog-content" @submit.prevent="submitCreate">
            <p class="dialog-hint">一个名字，一群同好。为你的板块选个名字吧。</p>
            <div class="avatar-field"><CommunityAvatar :name="newName" :src="s.newAvatar" /><label class="secondary upload-label"><Icon name="image" :size="16" />{{ s.uploading ? '上传中…' : '上传头像' }}<input type="file" accept="image/*" :disabled="busy" hidden @change="cm.uploadAvatar($event, 'new')" /></label><button v-if="s.newAvatar" type="button" class="text-button" :disabled="busy" @click="s.newAvatar = ''">移除</button></div>
            <label class="field-label">板块名称<input v-model="newName" autofocus maxlength="10" placeholder="例如：物理研习室" :disabled="busy" /></label><span class="field-help">{{ [...newName].length }} / 10 字 · 头像可选，图片不超过 10MB</span>
            <footer class="dialog-footer"><button type="button" class="secondary" :disabled="busy" @click="closeDialog">取消</button><button type="submit" :disabled="busy || !newName.trim()">{{ s.creating ? '创建中…' : '创建板块' }}</button></footer>
          </form>
          <div v-else-if="s.editing" class="dialog-content">
            <form @submit.prevent="saveEdit">
              <div class="avatar-field"><CommunityAvatar :src="s.editing.avatar" :name="s.editing.name" /><label class="secondary upload-label"><Icon name="image" :size="16" />{{ s.uploading ? '上传中…' : '更换头像' }}<input type="file" accept="image/*" :disabled="busy" hidden @change="cm.uploadAvatar($event, 'edit')" /></label></div>
              <label class="field-label">板块名称<input v-model="s.editing.name" maxlength="10" :disabled="busy" /></label>
              <label class="field-label">头像地址<input v-model="s.editing.avatar" placeholder="可选，也可以直接上传图片" :disabled="busy" /></label>
              <div class="form-actions"><button type="submit" :disabled="busy || !s.editing.name.trim()">{{ s.saving ? '保存中…' : '保存信息' }}</button></div>
            </form>
            <section class="permission-section"><h4><Icon name="lock" :size="16" />访问与发帖权限</h4><p class="dialog-hint">单独保存权限。未获取到当前值时，请先选择。</p><label class="field-label">权限方案<select v-model="permission" :disabled="busy"><option disabled value="">选择权限方案</option><option v-for="p in permissionChoices" :key="p.value" :value="p.value">{{ p.label }}</option></select></label><button class="secondary" :disabled="busy || !permission" @click="savePermissions">{{ s.managing ? '更新中…' : '更新权限' }}</button></section>
          </div>
          <div v-else-if="s.groupsOf" class="dialog-content">
            <p class="dialog-hint">{{ owns(s.groupsOf) ? '查看关联群聊，或通过群 ID 绑定新的群聊。' : '查看这个板块关联的群聊。' }}</p>
            <div class="group-list" :aria-busy="s.loadingGroups"><button v-for="g in s.groups" :key="g.groupId || g.id" class="group-row group-open" :aria-label="'查看群聊 ' + g.name" @click="inspectGroup(g)"><CommunityAvatar :src="g.avatar || g.avatarUrl" :name="g.name" /><div><b>{{ g.name || '未命名群聊' }}</b><span>ID {{ g.groupId || g.id }}</span><p v-if="g.introduction">{{ g.introduction }}</p></div><Icon name="chevronRight" :size="16" /></button><p v-if="s.loadingGroups" class="loading-note" role="status">正在加载群聊…</p><div v-if="s.groupsError" class="error-state" role="alert"><p>{{ s.groupsError }}</p><button class="secondary" @click="cm.loadGroups(s.groupsOf, s.groups.length > 0)">重试群聊</button></div><div v-else-if="!s.groups.length && !s.loadingGroups" class="empty-state"><Icon name="contacts" :size="26" /><b>暂时没有关联群聊</b></div><button v-if="s.hasMoreGroups" class="load-more secondary" :disabled="s.loadingGroups" @click="cm.loadGroups(s.groupsOf, true)">加载更多群聊</button></div>
            <section v-if="selectedGroup" class="group-inspector" aria-label="群聊详情"><h4>{{ selectedGroup.name }}</h4><p>ID {{ selectedGroup.groupId || selectedGroup.id }} · {{ selectedGroup.headcount ?? '—' }} 人</p><p>{{ selectedGroup.introduction || '暂无群介绍' }}</p><p v-if="groupBusy" role="status">正在查询群聊状态…</p><p v-if="groupError" role="alert">{{ groupError }} <button class="text-button" @click="inspectGroup(selectedGroup)">重试</button></p><button v-if="groupJoined" :disabled="groupBusy || !!groupError" @click="goGroup">进入群聊</button><button v-else :disabled="groupBusy || !!groupError" @click="joinGroup">申请加入群聊</button></section>
            <p v-if="owns(s.groupsOf) && !canBind" class="binding-help">新增关联群聊请在云湖官方客户端操作。</p>
            <form v-if="owns(s.groupsOf) && canBind" class="bind-form" @submit.prevent="cm.bindGroup(s.groupsOf.id, s.bindGroupId)"><label class="field-label">绑定群聊<input v-model="s.bindGroupId" placeholder="输入你有权管理的群 ID" :disabled="busy" /></label><button type="submit" :disabled="busy || !s.bindGroupId.trim()">{{ s.binding ? '绑定中…' : '绑定' }}</button></form>
          </div>
        </template>
      </dialog>
    </Teleport>
  </KLayout>
</template>

<style scoped>
.community-page { height: 100%; min-height: 0; container-type: inline-size; }
.community-page :deep(.k-header) { position: static; padding: 22px 28px 18px; border-bottom: 0; }
.community-page :deep(.k-title h2) { font-size: 25px; font-weight: 700; letter-spacing: -.6px; }
.community-page :deep(.k-title p) { margin-top: 4px; color: var(--fg2); }
.community-page :deep(.k-body) { flex: 1; min-height: 0; padding: 0 28px 24px; gap: 18px; overflow: hidden; }
button, .secondary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; }
button:focus-visible, .upload-label:focus-within { outline: 2px solid var(--acc); outline-offset: 3px; }
.create-button { border-radius: 12px; padding: 10px 16px; font-size: 13px; }
.community-toolbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.community-tabs { display: flex; padding: 4px; border: 1px solid var(--line); border-radius: 13px; background: var(--card); gap: 3px; }
.community-tabs button { padding: 7px 17px; background: transparent; color: var(--fg2); border-radius: 9px; font-size: 13px; }
.community-tabs button:hover { color: var(--fg); background: var(--card2); }
.community-tabs button.active { background: var(--acc-soft); color: var(--fg); font-weight: 650; }
.toolbar-search { display: flex; gap: 8px; align-items: center; min-width: 0; }
.search-box { display: flex; align-items: center; gap: 8px; padding: 0 11px; height: 38px; background: var(--card); border: 1px solid var(--line); border-radius: 11px; min-width: 0; color: var(--fg2); }
.search-box:focus-within { border-color: var(--acc); }
.search-box input { border: 0; box-shadow: none; padding: 0; width: 190px; min-width: 0; background: transparent; font-size: 12px; }
.search-box .icon-button { width: 22px; height: 24px; }
.icon-button { width: 34px; height: 34px; padding: 0; background: transparent; border-radius: 10px; color: var(--fg2); }
.icon-button:hover { background: var(--card2); color: var(--fg); }
.community-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: clamp(220px, 22cqw, 270px) minmax(0, 1fr); gap: 14px; }
.board-library, .board-reader { min-width: 0; min-height: 0; border: 1px solid var(--line); background: var(--card); border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; }
.section-label { display: flex; justify-content: space-between; gap: 8px; padding: 17px 17px 12px; font-size: 12px; color: var(--fg2); }
.section-label > span:first-child { color: var(--fg); font-weight: 600; }
.board-list { overflow: auto; padding: 0 8px 10px; flex: 1; scrollbar-gutter: stable; }
.board-row { display: flex; align-items: center; gap: 4px; padding-right: 8px; border-radius: 12px; margin: 3px 0; border: 1px solid transparent; transition: background .16s; }
.board-row:hover { background: var(--card2); }
.board-row.selected { background: var(--acc-soft); border-color: color-mix(in srgb, var(--acc) 24%, transparent); }
.board-open { flex: 1; min-width: 0; padding: 13px 9px; border-radius: 12px; text-align: left; justify-content: flex-start; gap: 11px; color: var(--fg); background: transparent; }
.board-open:hover { background: transparent; }
.board-open .community-avatar { width: 40px; height: 40px; border-radius: 12px; }
.board-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.board-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; overflow-wrap: anywhere; line-height: 1.5; }
.board-name em { font-size: 9px; font-style: normal; padding: 1px 5px; border-radius: 4px; background: var(--card2); color: var(--fg2); font-weight: 400; white-space: nowrap; }
.board-id { font-size: 11px; color: var(--fg2); overflow-wrap: anywhere; }
.follow-quick { width: 27px; height: 27px; border-radius: 50%; border: 1px solid var(--line); }
.followed { color: var(--fg); }
.reader-welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px 18px; }
.welcome-icon { width: 76px; height: 76px; border-radius: 26px; background: var(--acc-soft); color: var(--acc); display: grid; place-items: center; margin-bottom: 24px; }
.eyebrow { font-size: 10px; color: var(--fg2); letter-spacing: 1.6px; }
.reader-welcome h3 { font-size: 23px; margin: 10px 0; font-weight: 650; }
.reader-welcome p { color: var(--fg2); font-size: 13px; margin: 0 0 24px; line-height: 1.9; }
.secondary { background: var(--card2); border: 1px solid var(--line); color: var(--fg); padding: 8px 12px; border-radius: 10px; font-size: 12px; }
.secondary:hover { background: var(--acc-soft); }
.reader-header { display: flex; align-items: center; padding: 22px 24px 14px; gap: 13px; }
.reader-header > .community-avatar { width: 52px; height: 52px; border-radius: 16px; }
.reader-title { flex: 1; min-width: 0; }
.reader-title h3 { font-size: 21px; line-height: 1.4; margin: 2px 0 6px; overflow-wrap: anywhere; }
.reader-stats { display: flex; gap: 12px; flex-wrap: wrap; color: var(--fg2); font-size: 11px; }
.reader-actions { display: flex; align-items: center; gap: 8px; padding: 0 24px 19px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.follow-button { padding: 8px 13px; font-size: 12px; border: 1px solid transparent; border-radius: 10px; }
.reader-refresh { margin-left: auto; }
.reader-scroll { padding: 0 24px 20px; overflow: auto; min-height: 0; flex: 1; scrollbar-gutter: stable; }
.posts-heading { display: flex; align-items: center; gap: 12px; padding: 20px 0 12px; }
.posts-heading h4 { margin: 0; display: flex; gap: 8px; align-items: center; font-size: 13px; flex: 1; }
.posts-heading h4 span { color: var(--fg2); font-weight: 400; font-size: 11px; }
.post-search { height: 31px; max-width: 55%; background: var(--card2); }
.post-search input { width: 135px; }
.post-card { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 18px 0; border-radius: 0; border-bottom: 1px solid var(--line); text-align: left; width: 100%; background: transparent; color: var(--fg); }
.post-card:hover { background: transparent; }
.post-card:hover strong, .post-card:hover .read-link { color: var(--acc); }
.post-card strong { font-size: 17px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; transition: color .16s; }
.post-meta { display: flex; gap: 10px; font-size: 11px; color: var(--fg2); font-weight: 400; flex-wrap: wrap; overflow-wrap: anywhere; }
.post-excerpt { font-size: 12px; color: var(--fg2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.7; font-weight: 400; }
.post-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--fg2); font-weight: 400; }
.meta-dot { padding: 0 8px; }
.read-link { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.load-more { margin: 14px auto 4px; display: flex; }
.empty-state { min-height: 200px; padding: 30px 16px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 11px; color: var(--fg2); font-size: 12px; overflow-wrap: anywhere; }
.empty-state b { font-size: 14px; color: var(--fg); font-weight: 500; }
.error-state { border: 1px solid color-mix(in srgb, var(--err) 25%, var(--line)); border-radius: 10px; padding: 14px; margin: 12px 0; font-size: 12px; color: var(--fg); overflow-wrap: anywhere; }
.error-state p { color: var(--fg2); margin: 6px 0 12px; }
.loading-note, .search-note, .end-note { text-align: center; font-size: 11px; color: var(--fg2); margin: 16px 0; }
.article-navigation { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 17px 0; font-size: 11px; color: var(--fg2); }
.text-button { background: transparent; color: var(--fg2); padding: 4px 0; font-size: 12px; }
.text-button:hover { background: transparent; color: var(--acc); }
.article-detail h1 { font-size: 25px; line-height: 1.45; margin: 12px 0 14px; overflow-wrap: anywhere; }
.article-detail { width: 100%; max-width: 1000px; margin: 0 auto; }
.article-prose { font-size: 16px; line-height: 1.85; overflow-wrap: anywhere; padding: 12px 0; }
.article-prose :deep(img), .article-prose :deep(video) { max-width: 100%; height: auto; border-radius: 10px; }
.article-prose :deep(pre) { max-width: 100%; overflow: auto; padding: 14px; background: var(--card2); border-radius: 10px; }
.article-prose :deep(table) { display: block; max-width: 100%; overflow: auto; }
.article-prose :deep(blockquote) { margin: 12px 0; border-left: 3px solid var(--acc); padding-left: 16px; color: var(--fg2); }
.article-footer { flex-wrap:wrap; display: flex; gap: 10px; border-top: 1px solid var(--line); padding: 18px 0; color: var(--fg2); font-size: 12px; }
.mobile-back { display: none; }
.community-dialog { width: min(480px, calc(100vw - 28px)); max-height: min(80dvh, 720px); border: 1px solid var(--line); border-radius: 22px; background: var(--card); color: var(--fg); padding: 0; box-shadow: var(--shadow); overflow: auto; }
.community-dialog[open] { animation: community-in .16s ease-out; }
.community-dialog::backdrop { background: rgba(0,0,0,.5); }
.dialog-header { padding: 22px 24px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
.dialog-header h3 { margin: 3px 0 0; font-size: 19px; }
.dialog-content { padding: 20px 24px 24px; }
.dialog-hint { margin: 0 0 18px; color: var(--fg2); font-size: 12px; }
.avatar-field { display: flex; align-items: center; gap: 12px; margin: 0 0 20px; flex-wrap: wrap; }
.upload-label { cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.upload-label:has(input:disabled) { opacity: .5; cursor: wait; }
.field-label { display: flex; flex-direction: column; gap: 7px; color: var(--fg); font-size: 12px; margin: 12px 0; }
.field-label input, .field-label select { width: 100%; min-width: 0; font-size: 13px; }
.field-help { color: var(--fg2); font-size: 11px; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.form-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.permission-section { border-top: 1px solid var(--line); margin-top: 24px; padding-top: 16px; }
.permission-section h4 { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 0 0 8px; }
.permission-section .dialog-hint { margin-bottom: 8px; }
.group-list { max-height: 36vh; overflow: auto; }
.group-row { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.group-row > div { min-width: 0; overflow-wrap: anywhere; }
.group-row b { display: block; font-size: 13px; font-weight: 600; }
.group-row span, .group-row p { font-size: 11px; color: var(--fg2); margin: 3px 0 0; }
.binding-help { color: var(--fg2); font-size: 12px; border-top: 1px solid var(--line); padding-top: 16px; }
.bind-form { display: flex; gap: 10px; align-items: flex-end; border-top: 1px solid var(--line); margin-top: 20px; padding-top: 12px; }
.bind-form label { flex: 1; min-width: 0; margin: 0; }
.bind-form button { height: 39px; }
@keyframes community-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@container (max-width: 960px) {
  .community-workspace { grid-template-columns: 250px minmax(0,1fr); gap: 12px; }
  .community-page :deep(.k-body) { padding: 0 18px 18px; }
  .community-page :deep(.k-header) { padding: 18px; }
  .reader-header { padding: 18px 18px 14px; }
  .reader-actions { padding: 0 18px 16px; gap: 6px; }
  .reader-scroll { padding: 0 18px 16px; }
}
@container (max-width: 740px) {
  .community-toolbar { align-items: stretch; flex-direction: column; gap: 12px; }
  .community-tabs { width: fit-content; max-width: 100%; }
  .community-tabs button { flex: 1; min-width: 0; padding: 6px clamp(10px, 2.5cqw, 18px); }
  .toolbar-search .search-box { flex: 1; }
  .toolbar-search input { width: 100%; }
  .community-workspace { grid-template-columns: minmax(0, 1fr); }
  .board-reader { display: none; }
  .has-selection .board-library { display: none; }
  .has-selection .board-reader { display: flex; }
  .mobile-back { display: flex; }
  .reader-close { display: none; }
  .board-list { padding: 0 10px 10px; }
  .reader-title h3 { font-size: 18px; }
  .community-page :deep(.k-header) { gap: 8px; }
  .community-page :deep(.k-title h2) { font-size: 22px; }
  .community-page :deep(.k-title p) { font-size: 11px; max-width: 165px; }
  .create-button { padding: 9px 11px; font-size: 12px; }
}
/* 阅读时让正文占据整个工作区，仅保留一行板块导航。 */
.reading-article .reader-header { flex-shrink: 0; padding: 10px 16px; gap: 10px; border-bottom: 1px solid var(--line); }
.reading-article .reader-header > .community-avatar { width: 30px; height: 30px; border-radius: 9px; }
.reading-article .reader-title h3 { font-size: 14px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reading-article .reader-title .eyebrow, .reading-article .reader-stats { display: none; }
.reading-article .reader-actions { padding: 10px 16px; }
.reading-article .reader-scroll { padding: 0 clamp(16px, 3cqw, 40px) 24px; }
.reading-article .article-navigation { padding: 10px 0; }
.reading-article .article-detail h1 { margin: 8px 0 10px; }
.community-page.focus-reading :deep(.k-header), .focus-reading .community-toolbar { max-height: 0; opacity: 0; padding-block: 0; border-width: 0; overflow: hidden; pointer-events: none; visibility: hidden; }
.community-page.focus-reading :deep(.k-body) { padding: 12px; gap: 0; }
.community-workspace.library-collapsed { grid-template-columns: 0px minmax(0, 1fr); gap: 0; }
.library-collapsed .board-library { opacity: 0; visibility: hidden; transform: translateX(-10px); pointer-events: none; }
@container (max-width: 740px) {
  .community-workspace.library-collapsed { grid-template-columns: minmax(0, 1fr); }
  .reading-article .library-toggle { display: none; }
  .reading-article .reader-header { gap: 6px; padding: 8px; }
  .reading-article .reader-header > .community-avatar { display: none; }
  .community-page.focus-reading :deep(.k-body) { padding: 6px; }
}
/* 动画只覆盖当前列表与阅读区，不创建轮询或持续的后台动画。 */
.community-page :deep(.k-header) { flex-shrink: 0; max-height: 120px; transition: max-height .22s ease, padding .22s ease, opacity .16s ease, visibility .22s; }
.community-toolbar { flex-shrink: 0; max-height: 110px; transition: max-height .22s ease, opacity .16s ease, visibility .22s; }
.community-page :deep(.k-body) { transition: padding .22s ease, gap .22s ease; }
.community-workspace { transition: grid-template-columns .24s ease, gap .24s ease; }
.board-library { transition: opacity .16s ease, transform .24s ease, visibility .24s; }
.board-rows, .post-list { position: relative; }
.board-list-motion-move, .post-list-motion-move { transition: transform .2s ease; }
.board-list-motion-enter-active, .board-list-motion-leave-active,
.post-list-motion-enter-active, .post-list-motion-leave-active { transition: opacity .16s ease, transform .2s ease; }
.board-list-motion-enter-from, .board-list-motion-leave-to,
.post-list-motion-enter-from, .post-list-motion-leave-to { opacity: 0; transform: translateY(6px); }
.board-list-motion-leave-active, .post-list-motion-leave-active { position: absolute; left: 0; right: 0; pointer-events: none; }
.reader-content-enter-active, .reader-content-leave-active { transition: opacity .12s ease, transform .12s ease; }
.reader-content-enter-from { opacity: 0; transform: translateY(5px); }
.reader-content-leave-to { opacity: 0; transform: translateY(-3px); }
.board-tools-enter-active, .board-tools-leave-active { max-height: 160px; overflow: hidden; transition: max-height .2s ease, padding .2s ease, opacity .16s ease; }
.board-tools-enter-from, .board-tools-leave-to { max-height: 0; padding-block: 0 !important; opacity: 0; }
.board-library, .board-reader { position: relative; }
.search-box { transition: border-color .16s ease, background-color .16s ease; }
.reader-loading { position: absolute; top: 0; left: 0; right: 0; height: 2px; overflow: hidden; background: var(--acc-soft); pointer-events: none; z-index: 1; }
.reader-loading span { display: block; width: 35%; height: 100%; background: var(--acc); animation: reader-progress 1.1s ease-in-out infinite; }
.status-fade-enter-active, .status-fade-leave-active { transition: opacity .15s ease; }
.status-fade-enter-from, .status-fade-leave-to { opacity: 0; }
@keyframes reader-progress { from { transform: translateX(-110%); } to { transform: translateX(390%); } }
@media (prefers-reduced-motion: reduce) {
  .community-page :deep(*), .community-page :deep(*::before), .community-page :deep(*::after) { transition-duration: .001ms !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
  .reader-loading span { width: 100%; animation: none; opacity: .65; }
}
@media (max-width: 400px) { .dialog-header { padding: 18px; } .dialog-content { padding: 18px; } }
@media (prefers-reduced-motion: reduce) { .community-dialog[open] { animation: none; } .board-row, .post-card strong { transition: none; } }
.group-open { width:100%; text-align:left; color:var(--fg); background:transparent; border:1px solid transparent; border-radius:12px; transition:background .16s,transform .16s; }.group-open:hover { background:var(--acc-soft); transform:translateX(2px); }.group-open > div { flex:1; min-width:0; }.group-inspector { padding:16px; background:var(--card2); border:1px solid var(--line); border-radius:12px; margin-top:15px; }.group-inspector h4 { margin-top:0; }.group-inspector p { color:var(--fg2); font-size:12px; overflow-wrap:anywhere; }.plain-article { white-space:pre-wrap; }
.article-reactions button[aria-pressed=true],.comment-actions button[aria-pressed=true] { color:var(--acc); background:var(--acc-soft); }.article-comments { padding:10px 0 25px; }.article-comments h3 { font-size:17px; }.article-comments h3 span { color:var(--fg2); font-size:12px; }.comments-list { position:relative; }.comment-item { border-bottom:1px solid var(--line); padding:15px 0; }.comment-item header { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }.comment-item header time { margin-left:auto; }.comment-item time { color:var(--fg2); font-size:10px; }.comment-item p { white-space:pre-wrap; overflow-wrap:anywhere; margin:8px 0; font-size:13px; }.comment-actions { display:flex; gap:15px; }.comment-reply { margin:10px 0 0 12px; padding:8px 12px; border-left:2px solid var(--line); background:var(--card2); }.draft-row { display:flex; align-items:center; gap:12px; padding:13px 0; border-bottom:1px solid var(--line); }.draft-row > button:first-child { flex:1; min-width:0; text-align:left; display:flex; flex-direction:column; gap:5px; }.draft-row b { color:var(--fg); overflow-wrap:anywhere; }.draft-row span { font-size:10px; }

.article-dock { flex:none; display:flex; align-items:flex-end; justify-content:center; gap:10px; padding:9px clamp(10px,3cqw,30px); background:var(--card); border-top:1px solid var(--line); }
.comment-compose { min-width:0; flex:1; max-width:720px; border:1px solid var(--line); background:var(--card2); border-radius:17px; }
.comment-compose:focus-within { border-color:var(--link,var(--acc)); }
.comment-field { display:flex; align-items:center; gap:7px; padding:6px 8px 6px 11px; min-height:42px; color:var(--fg2); }
.comment-field textarea { flex:1; width:0; min-width:0; min-height:24px; max-height:112px; resize:none; padding:3px 0; color:var(--fg); background:transparent; border:0; outline:none; font:inherit; font-size:13px; field-sizing:content; }
.comment-field button { font-size:12px; white-space:nowrap; }
.reply-banner { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 10px 0; font-size:12px; color:var(--fg2); }
.reply-banner span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.article-reactions { display:flex; align-items:center; border:1px solid var(--line); border-radius:17px; padding:2px 3px; }
.article-reactions button { display:grid; justify-items:center; gap:3px; min-width:37px; padding:4px 6px; border-radius:12px; background:transparent; color:var(--fg2); font-size:11px; transition:background 150ms, color 150ms; }
.article-reactions button:hover { color:var(--fg); background:var(--card2); }
.comment-author { display:inline-flex; align-items:center; gap:8px; text-align:left; }
.comment-author .community-avatar { width:30px; height:30px; border-radius:50%; font-size:13px; }
.comment-reply .community-avatar { width:25px; height:25px; font-size:11px; }
.comment-pin { display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--link,var(--acc)); }
@media (max-width:460px) {
  .article-dock { gap:6px; padding-inline:7px; }
  .article-reactions button { min-width:30px; padding-inline:4px; }
  .article-dock:has(.comment-compose.editing) .article-reactions { display:none; }
}
</style>
