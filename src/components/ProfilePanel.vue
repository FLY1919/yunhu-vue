<script setup lang="ts">
/**
 * 用户主页抽屉（点消息头像 / 昵称 / 侧栏自己头像打开）。
 *
 * 三种数据来源：
 *   · 普通用户 → /v1/user/get-user（字段号按 full.proto#GetUserResponse.Data）
 *   · 机器人   → /v1/bot/bot-info（get-user 对机器人返回「该用户不存在」）
 *   · 板块     → /v1/community/ba/list-by-create（**看谁的资料就显示谁的板块**）
 *
 * 好友判断：通讯录里有就是好友 → 显示「发消息」；否则显示「添加好友」；
 * 看自己资料时显示「这是你自己」。点板块 chip 会跳到控制台板块页并进入该板块。
 */
import { inject, ref, computed, watch, onUnmounted, nextTick } from 'vue'
import Icon from '../console/components/Icon.vue'
import { resUrl } from '../core/res'
import { fallbackAvatar, fmtTime } from '../core/util'

const ctx = inject<any>('ctx')
const g = ctx.group
const chat = ctx.chat
const api = ctx.api
const ui = ctx.ui
const cm = ctx.community
/** 该用户创建的板块（点谁的头像就看谁的，不再固定显示「我的」） */
const userBas = ref<any[]>([])
const basLoading = ref(false)
const createdPacks = ref<any[]>([]), packsLoading = ref(false), packsError = ref('')
let packsRequest: AbortController | undefined
let profileVersion = 0
async function loadPacks(id: string) {
  packsRequest?.abort()
  const request = new AbortController(); packsRequest = request
  createdPacks.value = []; packsError.value = ''; packsLoading.value = true
  try {
    const response = await fetch('/sticker-directory?' + new URLSearchParams({ author_id: id }), { signal: request.signal })
    const result = await response.json()
    if (!response.ok || !Array.isArray(result.data)) throw new Error(result.error?.message || '目录返回格式不正确')
    if (packsRequest === request) createdPacks.value = result.data.filter(p => Number.isSafeInteger(Number(p.id)) && Number(p.id) > 0 && String(p.author?.user_id) === id)
  } catch (e: any) { if (!request.signal.aborted && packsRequest === request) packsError.value = e.message }
  finally { if (packsRequest === request) packsLoading.value = false }
}
async function gotoPack(pack: any) {
  g.closeProfile(); ctx.console?.goto?.('/')
  await nextTick()
  await ctx.stickers?.openPackOf?.({ packId: Number(pack.id) })
}
onUnmounted(() => { profileVersion++; packsRequest?.abort() })

async function loadBas(id: string) {
  if (!id) { userBas.value = []; return }
  const version = profileVersion
  basLoading.value = true
  try {
    const result = await ctx.api.baListByCreate(id)
    if (version === profileVersion && String(g.state.profileUser?.id) === id) userBas.value = result
  } catch {
    // 接口失败时，如果是自己就退回本地缓存的「我的板块」
    if (version === profileVersion && String(g.state.profileUser?.id) === id) userBas.value = String(id) === String(ctx.auth?.state?.user?.id || '') ? (cm?.state?.mine || []) : []
  } finally { if (version === profileVersion && String(g.state.profileUser?.id) === id) basLoading.value = false }
}

/** 点板块 → 跳到控制台「板块」页并定位到这个板块 */
function gotoBoard(b: any) {
  g.closeProfile()
  ctx.community?.focus?.(b)          // 让板块页选中它（并尽量进入）
  ctx.console?.goto?.('/community')  // 真正的跳页
}

const data = ref<any>(null)
const loading = ref(false)
const tags = computed(() => (g?.state?.profileUser ? g.tagsOf(g.state.profileUser.id) : []))

const GENDER = { 1: '男', 2: '女', 3: '其他' }

const isMe = computed(() => {
  const id = data.value?.id || g.state.profileUser?.id
  return !!id && String(id) === String(ctx.auth?.state?.user?.id || '')
})

const isFriend = computed(() => {
  const id = data.value?.id || g.state.profileUser?.id
  if (!id || data.value?.isBot) return true     // 机器人不判断好友
  return g.isFriend(id)
})

/** 非好友 → 添加好友 */
async function addFriend() {
  const id = data.value?.id || g.state.profileUser?.id
  if (!id) return
  const name = data.value?.name || g.state.profileUser?.name || id
  if (!(await ui.confirm?.('添加好友', `向「${name}」发送好友申请？`))) return
  try {
    await api.applyFriend(id, 1, '')
    ui.toast('已发送好友申请', 'success')
  } catch (e: any) { ui.toast('申请失败：' + e.message, 'error') }
}

/** 拉黑/取消拉黑（/v1/community/set-black-list，审计补齐 UI） */
async function toggleBlack() {
  const id = data.value?.id || g.state.profileUser?.id
  if (!id) return
  const next = !data.value?.isBlocked
  if (next && !(await ui.confirm?.('拉黑用户', `拉黑后对方消息将不再显示，确定拉黑？`, { danger: true }))) return
  try {
    await api.setBlackList(id, next)
    ui.toast(next ? '已拉黑' : '已取消拉黑', 'success')
    data.value = { ...data.value, isBlocked: next }
  } catch (e: any) { ui.toast('操作失败：' + e.message, 'error') }
}

async function load() {
  const u = g.state.profileUser
  const version = ++profileVersion
  if (!u) { data.value = null; return }
  loading.value = true; data.value = null
  try {
    const result = u.isBot ? await api.botInfo(u.id) : await api.getUser(u.id)
    if (version === profileVersion) data.value = { ...result, id: String(result.id || u.id), isBot: !!u.isBot }
  } catch (e: any) {
    if (version === profileVersion) data.value = { ...u, _note: (u.isBot ? '机器人' : '用户') + '资料加载失败：' + e.message }
  } finally { if (version === profileVersion) loading.value = false }
}

watch(() => g.state.profileUser, (u) => {
  load()
  userBas.value = []; createdPacks.value = []; packsError.value = ''; packsRequest?.abort(); packsLoading.value = false
  // 看谁的资料就拉谁的板块
  if (u?.id && !u.isBot) { loadBas(String(u.id)); loadPacks(String(u.id)) }
  if (u && !(cm?.state?.mine || []).length) cm?.mine?.()
}, { immediate: true })

/** 和 TA 聊天：切到该用户的私聊会话 */
function chatWith() {
  const u = data.value || g.state.profileUser
  const type = u.isBot ? 3 : 1
  let conv = chat.state.conversations.find((c: any) => String(c.id) === String(u.id) && c.type === type)
  if (!conv) { conv = { id: String(u.id), type, name: u.name, avatar: u.avatar, preview: '', unread: 0, ts: Date.now() }; chat.state.conversations.unshift(conv) }
  ctx.console?.goto?.('/'); chat.open(conv); g.closeProfile()
}

async function copyId() {
  const id = String(data.value?.id || g.state.profileUser?.id || '')
  try { await navigator.clipboard.writeText(id); ui.toast('已复制 ID', 'success') }
  catch { ui.toast('无法访问剪贴板，请手动复制 ID：' + id, 'error') }
}
const panel = ref<HTMLElement>()
let lastFocus: HTMLElement | null = null
watch(() => !!g.state.profileUser, async visible => {
  if (visible) { lastFocus = document.activeElement as HTMLElement; await nextTick(); panel.value?.focus() }
  else { await nextTick(); if (lastFocus?.isConnected) lastFocus.focus() }
}, { immediate: true })
function profileKey(e: KeyboardEvent) {
  if (document.querySelector('dialog[open]')) return
  if (e.key === 'Escape') { e.stopPropagation(); g.closeProfile() }
  if (e.key !== 'Tab') return
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)') || [])].filter(el => el.getClientRects().length)
  if (!items.length) return
  const first = items[0], last = items[items.length - 1]
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
</script>

<template>
  <Transition name="profile-panel"><div v-if="g.state.profileUser" class="pf-mask" @click.self="g.closeProfile()">
    <aside ref="panel" class="pf" role="dialog" aria-modal="true" aria-label="用户主页" tabindex="-1" @keydown="profileKey">
      <header>
        <span class="pf-heading-icon"><Icon name="userCircle" :size="18" /></span><b>用户主页</b>
        <span class="grow"></span>
        <button class="pf-x" aria-label="关闭用户主页" @click="g.closeProfile()"><Icon name="close" :size="18" /></button>
      </header>

      <div class="pf-body pf-skeleton" v-if="loading" role="status" aria-label="正在加载用户资料"><span class="skeleton-avatar"></span><span></span><span></span><span></span></div>

      <div class="pf-body" v-else-if="data" :key="data.id">
        <section class="pf-identity" aria-label="用户概览"><div class="pf-top">
          <img :src="data.avatar ? resUrl(data.avatar) : fallbackAvatar(data.name)"
               @error="(e: any) => (e.target.src = fallbackAvatar(data.name))" alt="" />
          <div>
            <div class="pf-name">
              {{ data.name }}
              <em v-if="data.isBot" class="bot">机器人</em>
              <em v-if="data.isVip" class="vip">VIP</em>
              <em v-if="data.banId" class="ban">封禁中</em>
            </div>
            <button class="pf-id" title="复制 ID" @click="copyId">ID {{ data.id }} <Icon name="copy" :size="12" /></button>
            <div class="pf-tags" v-if="tags.length">
              <span v-for="t in tags" :key="t.id" class="pf-tag" :style="{ background: (t.color || '#888') + '22', color: t.color || '#888' }">{{ t.tag }}</span>
            </div>
          </div>
        </div>

        <div v-if="!data.isBot" class="pf-highlights"><div><strong>{{ data.onlineDay ?? '—' }}</strong><span>在线天数</span></div><div><strong>{{ data.medalCount ?? 0 }}</strong><span>获得勋章</span></div><div><strong>{{ userBas.length }}</strong><span>创建板块</span></div></div></section>
        <p class="dim small" v-if="data._note">{{ data._note }}</p>

        <!-- 机器人资料（/v1/bot/bot-info） -->
        <div class="pf-grid" v-if="data.isBot">
          <div class="kv" v-if="data.id"><span class="k">机器人 ID</span><span>{{ data.id }}</span></div>
          <div class="kv" v-if="data.headcount"><span class="k">使用人数</span><span>{{ data.headcount }}</span></div>
          <div class="kv" v-if="data.createTime"><span class="k">创建时间</span><span>{{ fmtTime(data.createTime) }}</span></div>
          <div class="kv"><span class="k">可见性</span><span>{{ data.isPrivate ? '私有' : '公开' }}</span></div>
          <div class="kv"><span class="k">状态</span><span>{{ data.isStopped ? '已停用' : '运行中' }}</span></div>
          <div class="kv" v-if="data.autoAgree"><span class="k">进群方式</span><span>自动同意</span></div>
          <div class="kv" v-if="data.groupLimit"><span class="k">进群限制</span><span>限制进群</span></div>
          <div class="kv" v-if="data.isDeleted"><span class="k">标记</span><span>已删除</span></div>
        </div>

        <div class="pf-intro" v-if="data.isBot && data.introduction">
          <div class="lab">机器人介绍</div>
          <p>{{ data.introduction }}</p>
        </div>

        <div class="pf-grid" v-if="!data.isBot">
          <div class="kv"><span class="k">注册时间</span><span>{{ data.registerTime || '—' }}</span></div>
          <div class="kv"><span class="k">连续在线</span><span>{{ data.continuousOnlineDay ?? '—' }} 天</span></div>
          <div class="kv"><span class="k">IP 归属地</span><span>{{ data.ipGeo || '—' }}</span></div>
          <div class="kv" v-if="data.profile?.gender"><span class="k">性别</span><span>{{ GENDER[data.profile.gender] || '—' }}</span></div>
          <div class="kv" v-if="data.profile?.birthday"><span class="k">生日</span><span>{{ new Date(data.profile.birthday * 1000).toLocaleDateString() }}</span></div>
          <div class="kv" v-if="data.profile?.city"><span class="k">所在地</span><span>{{ data.profile.city }}{{ data.profile.district }}</span></div>
          <div class="kv" v-if="data.doNotDisturb"><span class="k">免打扰</span><span>已开启</span></div>
          <div class="kv" v-if="data.isBlocked"><span class="k">黑名单</span><span>已拉黑</span></div>
        </div>

        <div class="pf-intro" v-if="data.profile?.introduction">
          <div class="lab">简介</div>
          <p>{{ data.profile.introduction }}</p>
        </div>

        <!-- 我的板块（云湖的「文章分区」） -->
        <div class="pf-ba" v-if="userBas.length">
          <div class="lab">
            {{ isMe ? '我的板块' : 'TA 的板块' }}
            <span class="dim small">（{{ userBas.length }} 个）</span>
          </div>
          <div class="ba-list">
            <button v-for="b in userBas" :key="b.id" class="ba-chip" @click="gotoBoard(b)">
              <img v-if="b.avatar" :src="resUrl(b.avatar)" alt="" />
              <span v-else class="ba-ic">{{ (b.name || '?').slice(0, 1) }}</span>
              {{ b.name }}
            </button>
          </div>
        </div>

        <section v-if="!data.isBot" class="pf-ba pf-packs" aria-label="已创建的表情包">
          <div class="lab">已创建的表情包 <span v-if="createdPacks.length">（{{ createdPacks.length }} 个）</span></div>
          <p v-if="packsLoading" class="dim small" role="status">正在查询表情包目录…</p>
          <p v-else-if="packsError" class="small" role="alert">{{ packsError }} <button class="ghost small" @click="loadPacks(String(data.id))">重试</button></p>
          <div v-else-if="createdPacks.length" class="ba-list"><button v-for="p in createdPacks" :key="p.id" class="ba-chip" :title="'查看表情包 ' + p.id" @click="gotoPack(p)">{{ p.name || ('表情包 ' + p.id) }}</button></div>
          <p v-else class="dim small">目录暂未收录该用户创建的表情包。</p>
        </section>
        <div class="pf-actions">
          <!-- 好友才能直接发消息；非好友只能加好友 -->
          <template v-if="isMe">
            <button class="small" @click="chatWith">发消息</button>
            <span class="dim small" style="align-self:center">这是你自己</span>
          </template>
          <template v-else-if="!data.isBot && !isFriend">
            <button class="small" @click="addFriend">添加好友</button>
            <span class="dim small" style="align-self:center">你们还不是好友</span>
          </template>
          <button v-else-if="!isMe" class="small" @click="chatWith">发消息</button>
          <button v-if="!isMe && !data.isBot" class="ghost small" :class="{ danger: data.isBlocked }" @click="toggleBlack">
            {{ data.isBlocked ? '取消拉黑' : '拉黑' }}
          </button>
          <button class="ghost small" @click="copyId">复制 ID</button>
          <button class="ghost small" @click="load">刷新</button>
        </div>
      </div>

      <div class="pf-body" v-else>没有拿到资料</div>
    </aside>
  </div></Transition>
</template>

<style scoped>
.pf-mask { color:var(--fg);  position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 115; display: flex; justify-content: flex-end; }
.pf { width: 440px; max-width: 100vw; outline:none; background: var(--card); border-left: 1px solid var(--line); display: flex; flex-direction: column; box-shadow: var(--shadow); }
.pf > header { display: flex; align-items: center; gap: 8px; padding: 17px 20px; border-bottom: 1px solid var(--line); }
.pf > header .grow { flex: 1; }
.pf-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.pf-x:hover { color: var(--err); background: transparent; }
.pf-body { flex: 1; overflow: auto; padding: 18px; scrollbar-gutter:stable; animation:profile-content .2s ease-out; }
.pf-identity { padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--card); }.pf-top { display:flex; gap:13px; align-items:center; padding:0; }.pf-top > div { min-width:0; flex:1; }
.pf-top img { width: 58px; height: 58px; border-radius: 18px; flex-shrink:0; border:1px solid var(--line); object-fit: cover; background: var(--card2); }
.pf-name { overflow-wrap:anywhere; flex-wrap:wrap; font-size: 19px; font-weight: 650; display: flex; align-items: center; gap: 6px; }
.pf-name em { font-style: normal; font-size: 11px; border-radius: 5px; padding: 1px 6px; }
.pf-name em.vip { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
.pf-name em.ban { color: var(--err); background: color-mix(in srgb, var(--err) 18%, transparent); }
.pf-name em.bot { color: var(--acc); background: var(--acc-soft); }
.pf-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.pf-tag { font-size: 11px; border-radius: 5px; padding: 1px 6px; }
.pf-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 18px; margin-top:14px; padding:14px 16px; background:var(--card2); border:1px solid var(--line); border-radius:16px; }
.kv { display:flex; flex-direction:column; gap:5px; font-size:13px; min-width:0; }
.kv:last-child { border-bottom:0; }.kv > span:last-child { min-width:0; overflow-wrap:anywhere; }.kv .k { flex: 0 0 auto; color: var(--fg2); font-size: 12.5px; }
.pf-intro { margin-top: 14px; }
.pf-intro .lab { font-size: 12.5px; color: var(--fg2); margin-bottom: 4px; }
.pf-intro p { margin: 0; font-size: 13px; white-space: pre-wrap; background: var(--card2); padding: 10px; border-radius: 8px; }
.pf-actions { padding-top:18px; border-top:1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.pf-ba { margin-top: 16px; }
.pf-ba .lab { font-size: 12.5px; color: var(--fg2); margin-bottom: 6px; }
.ba-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ba-chip { transition:background .16s, border-color .16s, transform .16s;  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.ba-chip:hover { background:var(--acc-soft); transform:translateY(-1px);  border-color: var(--acc); color: var(--acc); }
.ba-chip img, .ba-ic { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; display: inline-flex; align-items: center; justify-content: center; background: var(--card2); font-size: 11px; }
.pf-heading-icon { display:grid; place-items:center; color:var(--acc); background:var(--acc-soft); width:32px; height:32px; border-radius:10px; }.pf > header b { font-size:13px; letter-spacing:.5px; }.pf-x { display:grid; place-items:center; width:30px; height:30px; border-radius:9px; }.pf-id { display:inline-flex; align-items:center; gap:7px; background:transparent; color:var(--fg2); font-size:11px; padding:5px 0; }.pf-id:hover { color:var(--acc); background:transparent; }.pf-highlights { width:100%; box-sizing:border-box; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); background:transparent; margin-top:15px; border-top:1px solid var(--line); padding:12px 0 0; }.pf-highlights > div { display:flex; align-items:center; flex-direction:column; gap:4px; border-right:1px solid var(--line); }.pf-highlights > div:last-child { border:0; }.pf-highlights strong { font-size:16px; font-weight:650; }.pf-highlights span { color:var(--fg2); font-size:11px; }.pf-skeleton { display:flex; flex-direction:column; gap:18px; }.pf-skeleton span { display:block; height:34px; border-radius:9px; background:var(--card2); }.pf-skeleton .skeleton-avatar { width:80px; height:80px; border-radius:25px; }.pf-intro .lab,.pf-ba .lab { font-weight:600; color:var(--fg); margin-bottom:10px; }.pf-intro p { line-height:1.8; padding:14px; border-radius:13px; }.pf-actions button { display:inline-flex; align-items:center; justify-content:center; border-radius:10px; min-height:34px; padding:8px 12px; }.pf-actions .danger { color:var(--err); }.profile-panel-enter-active,.profile-panel-leave-active { transition:opacity .2s ease; }.profile-panel-enter-active .pf,.profile-panel-leave-active .pf { transition:transform .25s cubic-bezier(.2,.7,.3,1); }.profile-panel-enter-from,.profile-panel-leave-to { opacity:0; }.profile-panel-enter-from .pf,.profile-panel-leave-to .pf { transform:translateX(100%); }@keyframes profile-content { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:none; } }@media(max-width:480px) { .pf { width:100%; border-left:0; }.pf-body { padding:18px; }.pf-name { font-size:19px; }.pf-body { padding:12px; }.pf-identity { padding:14px; } }@media(prefers-reduced-motion:reduce) { *, .profile-panel-enter-active .pf,.profile-panel-leave-active .pf { transition:none !important; animation:none !important; } }
</style>
