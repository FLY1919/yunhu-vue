<script setup lang="ts">
/**
 * 左侧会话列表（含本地分组）。
 *
 * 关键点：
 *   · 数据源是 chat.filtered() —— 注意它是**函数**，要调用；漏了括号会一条会话都不显示
 *   · 分组完全存本地 localStorage（云湖没有分组接口）
 *   · 「未读」样式走 .has-unread（名字加重 + 小圆点），不再用整块红底，减少颜色噪音
 *   · 点头像 = 看自己的资料（走 group.openProfile）
 *   · 右键会话 = 分组菜单（替代旧的 window.prompt 交互）
 */
import { inject, computed, ref, reactive, watch, onUnmounted } from 'vue'
import { fallbackAvatar } from '../core/util.js'
import { resUrl } from '../core/res.js'
import { rankSearchResults } from '../core/search'
import Icon from '../console/components/Icon.vue'
import ConversationItem from './ConversationItem.vue'
import CreateGroupForm from './CreateGroupForm.vue'

const ctx = inject<any>('ctx')
const auth = ctx.auth
const chat = ctx.chat

const list = computed(() => chat.filtered())
function open(c: any) { chat.open(c) }

/* ---- 全局搜索（Enter 触发 /v1/search/home-search：人/群/机器人混合结果） ---- */
const GS_TYPE: Record<number, string> = { 1: '用户', 2: '群聊', 3: '机器人' }
const gsResults = ref<any[]>([])
let gsRequest = 0
watch(() => chat.state.keyword, () => { gsRequest++; gsResults.value = [] }, { flush: 'sync' })
onUnmounted(() => { gsRequest++ })
async function globalSearch() {
  const request = ++gsRequest
  const w = chat.state.keyword.trim()
  if (!w) { gsResults.value = []; return }
  try {
    const d = await ctx.api.homeSearch(w)
    if (request !== gsRequest) return
    // 返回结构按类别分组，摊平成一列（带 type）
    const out: any[] = []
    for (const key of ['users', 'groups', 'bots']) {
      for (const it of d[key] || []) out.push({ ...it, type: key === 'users' ? 1 : key === 'groups' ? 2 : 3 })
    }
    gsResults.value = rankSearchResults(out, w).slice(0, 8)
  } catch (e: any) {
    if (request === gsRequest) ctx.ui?.toast?.('搜索失败：' + e.message, 'error')
  }
}
function gsPick(r: any) {
  gsRequest++
  gsResults.value = []
  if (r.type === 2) chat.open({ id: r.id, type: 2, name: r.name, avatar: r.avatar })
  else if (r.type === 3) chat.open({ id: r.id, type: 3, name: r.name, avatar: r.avatar })
  else ctx.group?.openProfile?.(r)   // 用户 → 资料面板
}

/* ---------------- 会话分组（本地，存 localStorage） ---------------- */
// 注意：filtered 是函数，必须调用 —— 之前少个括号导致侧栏一条会话都不显示
const pinTab = ref<'unpinned' | 'pinned'>('unpinned')
const searching = computed(() => !!chat.state.keyword.trim())
const sections = computed(() => chat.sections(list.value, pinTab.value))
const visibleCount = computed(() => sections.value.pinned.length + sections.value.active.length + sections.value.ungrouped.length +
  sections.value.groups.reduce((sum: number, g: any) => sum + g.items.length, 0))
const pinnedCount = computed(() => list.value.filter((c: any) => chat.isPinned(c.id)).length)

/* ---- 右键会话 → 分组菜单（夹回视口，避免菜单出屏） ---- */
const menu = reactive({ open: false, x: 0, y: 0, conv: null as any })
const menuGroupInput = ref('')
function openMenu(c: any, e: MouseEvent) {
  menu.conv = c
  menu.x = Math.min(e.clientX, window.innerWidth - 180)
  menu.y = Math.min(e.clientY, window.innerHeight - 320)
  menu.open = true
}
function closeMenu() { menu.open = false; menuGroupInput.value = '' }
// 点菜单外任意处关闭
const offDoc = () => closeMenu()
watch(() => menu.open, (v) => {
  if (v) setTimeout(() => document.addEventListener('click', offDoc), 0)
  else document.removeEventListener('click', offDoc)
})
onUnmounted(() => document.removeEventListener('click', offDoc))
function assignTo(groupId: string) {
  if (menu.conv) chat.assignTo(menu.conv.id, groupId)
  closeMenu()
}
function createAndAssign() {
  const n = menuGroupInput.value.trim()
  if (!n) return
  chat.addGroup(n)
  const g = chat.groups.groups.find((x: any) => x.name === n)
  if (g && menu.conv) chat.assignTo(menu.conv.id, g.id)
  closeMenu()
}
/** 置顶/取消置顶（本地排序） */
function togglePin() {
  if (menu.conv) chat.togglePin(menu.conv.id)
  closeMenu()
}
/** 免打扰开关（本地：不计未读角标） */
function toggleMute() {
  if (menu.conv) chat.toggleMute(menu.conv.id)
  closeMenu()
}
/** 复制群号/会话 ID（QQ 式右键项） */
async function copyId() {
  const c = menu.conv
  closeMenu()
  if (!c) return
  try { await navigator.clipboard.writeText(String(c.id)); ctx.ui?.toast?.('已复制 ' + c.id, 'success') }
  catch { ctx.ui?.toast?.('复制失败（浏览器拒绝剪贴板）', 'error') }
}
/** 标记未读（本地持久角标，打开会话时清除） */
function markUnread() {
  const c = menu.conv
  closeMenu()
  if (!c) return
  chat.markUnread(c.id)
}
/** 删除会话（本地隐藏，不删云端记录；二次确认防误触） */
async function delConv() {
  const c = menu.conv
  closeMenu()
  if (!c) return
  if (!(await ctx.ui.confirm('删除会话', `从列表删除「${c.name}」？\n（仅本地隐藏，聊天记录仍在云端）`, { danger: true }))) return
  chat.hideConv(c.id)
}

/** 点自己的头像 → 打开自己的详细资料 */
function openMe() {
  const u = auth.state.user
  if (u) ctx.group?.openProfile?.({ id: u.id, name: u.name, avatar: u.avatar })
}

/* ---------------- QQ 式「＋」菜单：创建群聊 / 加好友（复用 social 后端） ---------------- */
const plusOpen = ref(false)
// 点菜单外任意处关闭（与右键分组菜单同一套路）
const offPlus = () => { plusOpen.value = false }
watch(() => plusOpen.value, (v) => {
  if (v) setTimeout(() => document.addEventListener('click', offPlus), 0)
  else document.removeEventListener('click', offPlus)
})
onUnmounted(() => document.removeEventListener('click', offPlus))
const dlg = reactive({ kind: '' as '' | 'group' | 'friend', fid: '', msg: '', busy: false })
function plusPick(k: 'group' | 'friend') {
  plusOpen.value = false
  dlg.kind = k
}
function closeDlg() { dlg.kind = ''; dlg.fid = ''; dlg.msg = '' }
async function dlgOk() {
  if (dlg.busy) return
  dlg.busy = true
  try {
    if (dlg.kind === 'friend') {
      const id = dlg.fid.trim()
      if (!id) { ctx.ui?.toast?.('请填写对方 ID', 'warn'); return }
      await ctx.social?.apply?.(id, 1, dlg.msg.trim())
      ctx.ui?.toast?.('好友申请已发送', 'success')
    }
    closeDlg()
  } catch (e: any) {
    ctx.ui?.toast?.('操作失败：' + e.message, 'error')
  } finally { dlg.busy = false }
}
</script>

<template>
  <div class="sidebar">
    <div class="me">
      <img class="me-av" :src="auth.state.user?.avatar ? resUrl(auth.state.user.avatar) : fallbackAvatar(auth.state.user?.name)" alt=""
           title="查看我的资料" @click="openMe"
           @error="(e: any) => (e.target.src = fallbackAvatar(auth.state.user?.name))" />
      <div class="info">
        <div class="name">{{ auth.state.user?.name }}</div>
        <div class="sub">ID {{ auth.state.user?.id }}</div>
      </div>
      <!-- QQ 式「＋」：创建群聊 / 加好友（闪传文件无后端，不做） -->
      <div class="plus-wrap">
        <button class="plus-btn" title="创建群聊 / 加好友" @click.stop="plusOpen = !plusOpen">
          <Icon name="plus" :size="16" />
        </button>
        <div v-if="plusOpen" class="plus-menu" @click.stop>
          <button class="pm-item" @click="plusPick('group')"><Icon name="contacts" :size="15" /> 创建群聊</button>
          <button class="pm-item" @click="plusPick('friend')"><Icon name="user" :size="15" /> 加好友</button>
        </div>
      </div>
    </div>

    <!-- 创建群聊 / 加好友 对话框 -->
    <div v-if="dlg.kind" class="dlg-mask" @click.self="closeDlg" @keydown.esc="closeDlg">
      <div class="dlg-box" role="dialog" aria-modal="true" :aria-label="dlg.kind === 'group' ? '创建群聊' : '加好友'">
        <div class="dlg-title">{{ dlg.kind === 'group' ? '创建群聊' : '加好友' }}</div>
        <CreateGroupForm v-if="dlg.kind === 'group'" @created="closeDlg" @cancel="closeDlg" />
        <template v-else>
          <input v-model="dlg.fid" class="dlg-input" placeholder="对方 ID" autofocus />
          <textarea v-model="dlg.msg" class="dlg-input" placeholder="验证消息（可选）" rows="2"></textarea>
          <div class="dlg-foot">
          <button class="ghost tiny" @click="closeDlg">取消</button>
          <button class="primary tiny" :disabled="dlg.busy" @click="dlgOk">{{ dlg.busy ? '提交中…' : '确定' }}</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 插槽：chat-sidebar-top -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-sidebar-top') || []" :key="'st' + i"
               :is="sl.component" v-bind="sl.props || {}" />

    <div class="search">
      <input v-model="chat.state.keyword" placeholder="搜索会话…" @keyup.enter="globalSearch" />
      <!-- 全局搜索结果（/v1/search/home-search：人/群/机器人混合） -->
      <div v-if="gsResults.length" class="gs-pop">
        <button v-for="r in gsResults" :key="r.id + r.type" class="gs-item" @click="gsPick(r)">
          <img :src="r.avatar ? resUrl(r.avatar) : fallbackAvatar(r.name)" alt="" />
          <span>{{ r.name }}</span>
          <em class="dim small">{{ GS_TYPE[r.type] || '' }}</em>
        </button>
      </div>
    </div>

    <div v-if="chat.groups.pinMode === 'tabs' && !searching" class="pin-tabs" role="tablist" aria-label="置顶会话">
      <button id="pin-tab-unpinned" role="tab" :aria-selected="pinTab === 'unpinned'" aria-controls="conversation-list"
              :class="{ on: pinTab === 'unpinned' }" @click="pinTab = 'unpinned'">未置顶对话 <em>{{ list.length - pinnedCount }}</em></button>
      <button id="pin-tab-pinned" role="tab" :aria-selected="pinTab === 'pinned'" aria-controls="conversation-list"
              :class="{ on: pinTab === 'pinned' }" @click="pinTab = 'pinned'">置顶对话 <em>{{ pinnedCount }}</em></button>
    </div>

    <!-- 会话分组（本地）：有分组时按分组渲染，可折叠 -->
    <div v-if="sections.groups.length" class="grp-bar">
      <button v-for="g in sections.groups" :key="g.id" class="grp-chip"
              :class="{ on: !chat.isCollapsed(g.id) }" @click="chat.toggleCollapse(g.id)">
        {{ g.name }} <em>{{ g.items.length }}</em>
      </button>
    </div>

    <ul id="conversation-list" class="convs">
      <ConversationItem v-for="c in sections.pinned" :key="'pin:' + c.type + ':' + c.id" :c="c"
                        @open="open" @menu="openMenu" />
      <ConversationItem v-for="c in sections.active" :key="'active:' + c.type + ':' + c.id" :c="c"
                        @open="open" @menu="openMenu" />
      <template v-for="g in sections.groups" :key="g.id">
        <li class="grp-head" @click="chat.toggleCollapse(g.id)">
          <span class="tri">{{ chat.isCollapsed(g.id) ? '▸' : '▾' }}</span>{{ g.name }}
          <em>{{ g.items.length }}</em>
          <span class="grow"></span>
          <button class="ghost tiny" title="删除分组" @click.stop="chat.removeGroup(g.id)">×</button>
        </li>
        <template v-if="!chat.isCollapsed(g.id)">
          <ConversationItem v-for="c in g.items" :key="c.type + ':' + c.id" :c="c" @open="open" @menu="openMenu" />
        </template>
      </template>

      <ConversationItem v-for="c in sections.ungrouped" :key="c.type + ':' + c.id" :c="c" @open="open" @menu="openMenu" />
      <li v-if="!visibleCount" class="hint">
        {{ chat.state.loadingConvs ? '加载中…' : searching ? '没有匹配的会话' : chat.groups.pinMode === 'tabs' && pinTab === 'pinned' ? '暂无置顶对话' : '暂无会话' }}
      </li>
    </ul>

    <!-- 插槽：chat-sidebar-bottom -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-sidebar-bottom') || []" :key="'sb' + i"
               :is="sl.component" v-bind="sl.props || {}" />

    <!-- 右键菜单：置顶 / 免打扰 / 移动到分组 / 删除（建分组在侧栏「＋」里） -->
    <Teleport to="body">
      <div v-if="menu.open" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
        <button class="rm-item" @click="togglePin">
          <Icon name="pinUp" :size="14" /> {{ chat.isPinned(menu.conv?.id) ? '取消置顶' : '置顶' }}
        </button>
        <button class="rm-item" @click="toggleMute">
          <Icon :name="chat.isMuted(menu.conv?.id) ? 'bellOn' : 'bellOff'" :size="14" />
          {{ chat.isMuted(menu.conv?.id) ? '取消免打扰' : '免打扰' }}
        </button>
        <button class="rm-item" @click="copyId"><Icon name="copy" :size="14" /> 复制群号/ID</button>
        <button class="rm-item" @click="markUnread"><Icon name="chat" :size="14" /> 标记未读</button>
        <div class="rm-sep"></div>
        <button class="rm-item danger" @click="delConv"><Icon name="trash" :size="14" /> 删除会话</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pin-tabs { display: flex; gap: 4px; padding: 4px 10px 8px; }
.pin-tabs button { flex: 1; padding: 6px 4px; font-size: 12px; color: var(--fg2); background: transparent; border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0; }
.pin-tabs button:hover { color: var(--fg); background: var(--card2); }
.pin-tabs button.on { color: var(--fg); border-bottom-color: var(--acc); }
.pin-tabs em { font-style: normal; font-size: 11px; margin-left: 3px; }
</style>
