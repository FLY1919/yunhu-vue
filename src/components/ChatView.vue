<script setup lang="ts">
/**
 * 聊天主区域：标题栏 + 消息列表 + 输入区。
 *
 * 标题栏右侧的按钮来自：
 *   · chat.slot('chat-header-extra')  —— 插件插槽（如 commands 的「指令」入口）
 *   · ⋮ 菜单 —— 看板 / 成员 / 记录 / 显示其他…（展开后是完整功能表）
 *
 * ⚠️ 消息菜单的定位交给 MessageMenu 自己算（优先弹在消息上方并夹回视口），
 *    这里只传锚点矩形，不要自己算 left/top，算错过一次（菜单跑到屏幕外）。
 */
import { inject, ref, onUnmounted, nextTick, watch, computed, reactive } from 'vue'
import { CHAT_TYPE_LABEL } from '../core/util'
import { showMessage } from '../core/recall-display'
import MessageItem from './MessageItem.vue'
import MessageMenu from './MessageMenu.vue'
import SelectionBar from './SelectionBar.vue'
import Composer from './Composer.vue'
import BoardDock from './BoardDock.vue'
import Icon from '../console/components/Icon.vue'

const ctx = inject<any>('ctx')
const chat = ctx.chat
const box = ref<HTMLElement | null>(null)
const emit = defineEmits<{ (e: 'toggle-sidebar'): void }>()

const cur = computed(() => chat.state.current)

/** 消息流：相邻消息间隔 > 5 分钟时插入时间分隔胶囊（QQ 式） */
const flow = computed(() => {
  const out: Array<{ t: 'div'; ts: number; id: string } | { t: 'msg'; msg: any }> = []
  let last = 0
  for (const m of chat.state.messages || []) {
    // With local retention enabled, an unmatched recall has no retained message to display.
    if (!showMessage(m, chat.preferences.antiRecall)) continue
    if (m.ts && (!last || m.ts - last > 5 * 60 * 1000)) out.push({ t: 'div', ts: m.ts, id: 'div-' + m.id })
    out.push({ t: 'msg', msg: m })
    if (m.ts) last = m.ts
  }
  return out
})

/* ---- 右键菜单状态 ---- */
/** 右上角「⋮」菜单 */
const moreOpen = ref(false)
// ⋮ 菜单已全展开，无需折叠态
const moreBtn = ref<HTMLElement | null>(null)
/** ⋮ 菜单 fixed 定位：贴在按钮左下，夹回视口内（Teleport 到 body 后不再被 dock 压住） */
const morePos = ref<Record<string, string>>({})
function toggleMore() {
  if (moreOpen.value) { closeMore(); return }
  const r = moreBtn.value?.getBoundingClientRect()
  if (r) {
    const w = 170
    morePos.value = {
      top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 400)) + 'px',
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px',
    }
  }
  moreOpen.value = true
}
function pick(what: 'board' | 'members' | 'tags' | 'search' | 'info' | 'disk' | 'all' | 'settings' | 'chatbg') {
  moreOpen.value = false
  if (what === 'settings') { ctx.group?.toggle(); return }        // 群设置抽屉
  if (what === 'chatbg') { ctx.charbg?.openDialog?.(); return }   // 聊天背景（原来指向的主题页压根没实现）
  ctx.group?.setDockTab(what as any)                              // 其余都是全屏群界面里的页签
}
function closeMore() { moreOpen.value = false }

const menu = reactive({ open: false, x: 0, y: 0, msg: null as any, items: [] as any[], anchor: null as any })

/**
 * 打开消息菜单。
 * anchor 是消息（或右键点）的矩形，交给 MessageMenu 决定弹在上方还是下方、
 * 以及怎么夹回视口里 —— 避免直接在左侧弹出被切掉。
 */
function openMenu(p: { msg: any; x: number; y: number; anchor?: any }) {
  menu.msg = p.msg; menu.x = p.x; menu.y = p.y
  menu.anchor = p.anchor || null
  menu.items = chat.menuOf('message', { msg: p.msg })
  menu.open = true
}
function closeMenu() { menu.open = false }

async function pickMenu(item: any) {
  // ⚠️ menu 是 reactive 对象不是 ref！之前写成 menu.value.msg 拿到的是 undefined，
  //    导致所有消息菜单动作（撤回/引用/转发/编辑/复制）全都拿着空 msg 去执行 → 全废。
  const msg = menu.msg
  closeMenu()
  try { await chat.run(item.id, { msg, chat: chat.state.current, ids: chat.state.selected.slice() }) }
  catch (e: any) { ctx.ui?.toast('操作失败：' + e.message, 'error') }
}

/** 引用和通知共用 chat.locate；这里只负责等 DOM 就绪并高亮。 */
function jumpTo(mid: string) {
  if (cur.value && mid) chat.locate(cur.value, mid)
}
function seekLocated(mid: string) {
  clearFlash()
  const current = chat.state.current
  const request = ++jumpRequest
  const seek = (tries = 12) => {
    if (unmounted || request !== jumpRequest || chat.state.current !== current || chat.state.locateId !== mid) return
    const el = box.value?.querySelector(`[data-mid="${CSS.escape(mid)}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
      el.classList.add('flash')
      flashed = el
      flashTimer = setTimeout(clearFlash, 2000)
      return
    }
    if (tries > 0) setTimeout(() => seek(tries - 1), 80)
    else ctx.ui?.toast?.('没能定位到这条消息（可能已删除或过旧）', 'warn')
  }
  nextTick(() => seek())
}

function toBottom() {
  const current = chat.state.current
  // A sent message supersedes a pending history-page position restoration.
  scrollIntent++
  nextTick(() => {
    if (box.value && chat.state.current === current && !chat.state.jumpedAway) {
      box.value.scrollTop = box.value.scrollHeight
      chat.setAtBottom?.(true)
      showJump.value = false
    }
  })
}

/** 搜索跳转历史后一键回最新：重载最新消息并滚到底 */
async function backLatest() {
  const current = chat.state.current
  chat.state.jumpedAway = false
  showJump.value = false
  await chat.loadMessages()
  if (chat.state.current === current) toBottom()
}

/** 滚动时上报「是否贴底」：新消息/轮询刷新只在贴底时自动滚，翻历史不被打断 */
let loadingTop = false
let scrollIntent = 0
const showJump = ref(false)   // 离开底部时显示「回最新」箭头
function onScroll() {
  const el = box.value
  if (!el) return
  // 打开会话时 DOM 会先显示缓存/加载占位；其滚动事件不能触发历史分页或覆盖贴底意图。
  if (chat.state.loadingMsgs && !chat.state.jumpedAway) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  ctx.chat?.setAtBottom?.(atBottom)
  showJump.value = !atBottom
  // 历史消息自动加载：滚到顶部即拉上一页（QQ 式，不再需要点按钮），并保持阅读位置
  if (el.scrollTop < 40 && chat.state.hasMore && !chat.state.loadingMore && !loadingTop) {
    loadingTop = true
    const current = chat.state.current
    const prevH = el.scrollHeight
    const topBefore = el.scrollTop
    const intent = scrollIntent
    Promise.resolve(chat.loadMore()).finally(() => {
      nextTick(() => {
        if (!unmounted && chat.state.current === current && box.value === el) {
          if (intent === scrollIntent) el.scrollTop = el.scrollHeight - prevH + topBefore
          else if (chat.atBottom?.() && !chat.state.jumpedAway) toBottom()
        }
        loadingTop = false
      })
    })
  }
}

/** 时间分隔胶囊文案：今天/昨天/日期 + 时分 */
function fmtDiv(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now.getTime() - 86400000)
  if (sameDay) return hm
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}
const off = ctx.on('chat/scroll-bottom', toBottom)
// Composer expansion, its fade animation and attachment decoding can resize the viewport
// after the first nextTick. Follow only while the reader still intends to stay at the bottom.
let sizeObserver: ResizeObserver | undefined
watch(box, (element) => {
  sizeObserver?.disconnect()
  if (element && typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(() => {
      if (chat.atBottom?.() && !chat.state.jumpedAway && !loadingTop) toBottom()
    })
    sizeObserver.observe(element)
  }
}, { flush: 'post' })
const offLocate = ctx.on('chat/locate', seekLocated)
let unmounted = false
let jumpRequest = 0
let flashed: HTMLElement | null = null
let flashTimer: ReturnType<typeof setTimeout> | undefined
function clearFlash() {
  clearTimeout(flashTimer)
  flashed?.classList.remove('flash')
  flashed = null
}
function dismissLocate(event?: Event) {
  if (event?.target instanceof Element && event.target.closest('.row.locate')) return
  jumpRequest++
  chat.state.locateId = null
  clearFlash()
}
const offDoc = () => closeMore()
const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeMore(); closeMenu(); dismissLocate() } }
// 捕获阶段执行：引用块、头像和侧栏按钮即使 stopPropagation 也不会漏掉。
// 先清旧定位再由本次引用点击建立新定位，避免刚跳转就被同一次点击清除。
document.addEventListener('click', dismissLocate, { capture: true })
document.addEventListener('click', offDoc)
document.addEventListener('keydown', onEscape)
onUnmounted(() => {
  unmounted = true
  sizeObserver?.disconnect()
  off()
  offLocate()
  clearFlash()
  document.removeEventListener('click', dismissLocate, { capture: true })
  document.removeEventListener('click', offDoc)
  document.removeEventListener('keydown', onEscape)
})
watch(cur, () => { jumpRequest++; clearFlash(); closeMore(); closeMenu(); showJump.value = false; toBottom() })
watch(() => chat.state.locateId, (mid) => { if (mid) seekLocated(mid) }, { immediate: true, flush: 'post' })
</script>

<template>
  <header class="chat-header">
    <button class="ghost small only-mobile" title="会话列表" @click="emit('toggle-sidebar')">
      <Icon name="menu" :size="17" />
    </button>
    <div class="head-main">
      <div class="t">
        <span class="nm">{{ cur?.name || '未选择会话' }}</span>
        <span class="s" v-if="cur">{{ CHAT_TYPE_LABEL[cur.type] }} · {{ cur.id }}</span>
      </div>
    </div>
    <div class="head-side" v-if="ctx.ws && ctx.ws.state.status !== 'online'">
      <!-- 重连中只给一个小黄点 + 悬浮提示，不再占按钮位刷屏（点击可手动重连） -->
      <span class="dot wait" :title="'连接状态：' + ctx.ws.state.status + '（点击重连）'"
            style="cursor:pointer" @click="ctx.ws.reconnect()"></span>
    </div>
    <!-- 搜索跳转到历史后：顶栏常驻「回到最新」入口（滚不动也能回） -->
    <button v-if="chat.state.jumpedAway" class="ghost small back-latest" @click="backLatest">
      <Icon name="down" :size="13" /> 回到最新
    </button>

    <!-- 云湖公开接口没有通话/投屏端点 —— 按「无后端即砍」原则不放占位按钮 -->

    <!-- 插件插槽：其他插件可以往这里塞自己的组件 -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-header-extra') || []" :key="'h' + i"
               :is="sl.component" v-bind="sl.props || {}" />

    <!-- ⋮ 更多：看板 / 成员 / 群标签 / 记录 / 群设置
         Teleport 到 body + fixed 定位：dock 抽屉(z75)打开时菜单不再被压住 -->
    <div class="more-wrap" v-if="cur">
      <button ref="moreBtn" class="ghost small more-btn" title="更多" @click.stop="toggleMore">⋮</button>
      <Teleport to="body">
        <div v-if="moreOpen" class="more-menu" :style="morePos" @click.stop>
          <button class="more-item" @click="pick('board')"><Icon name="page" :size="14" /> 看板</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('members')"><Icon name="user" :size="14" /> 成员</button>
          <button class="more-item" @click="pick('search')"><Icon name="search" :size="14" /> 聊天记录</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('info')"><Icon name="page" :size="14" /> 群资料</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('disk')"><Icon name="folder" :size="14" /> 群文件</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('tags')"><Icon name="check" :size="14" /> 群标签</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('all')"><Icon name="search" :size="14" /> 全部看板</button>
          <button class="more-item" @click="pick('chatbg')"><Icon name="palette" :size="14" /> 聊天背景</button>
          <button v-if="ctx.userbot" class="more-item" @click="closeMore(); ctx.userbot.open(cur)"><Icon name="robot" :size="14" /> 用户 Bot / AI 设置</button>
          <button class="more-item" @click="pick('settings')"><Icon name="settings" :size="14" /> {{ cur.type === 2 ? '群设置' : '会话设置' }}</button>
        </div>
      </Teleport>
    </div>
  </header>

  <SelectionBar v-if="cur" />

  <div v-if="!cur" class="empty">
    <div>
      <Icon name="chat" :size="30" aria-hidden="true" />
      <div>从左侧选择一个会话开始聊天</div>
      <div class="small dim" style="margin-top: 6px">右键消息可引用 / 转发 / 撤回 / 多选</div>
    </div>
  </div>

  <div v-else ref="box" class="messages" @click="closeMenu(); closeMore()" @scroll="onScroll">
    <!-- 往上翻后右下角出现「回最新」箭头（QQ 式） -->
    <button v-if="showJump" class="jump-latest" title="回到最新" @click="chat.state.jumpedAway ? backLatest() : toBottom()">
      <Icon name="down" :size="16" />
    </button>
    <div v-if="chat.state.hasMore && chat.state.loadingMore" class="load-more">
      <span class="sys">加载历史中…</span>
    </div>
    <template v-for="f in flow" :key="f.t === 'div' ? f.id : f.msg.id">
      <div v-if="f.t === 'div'" class="sys time-div"><span>{{ fmtDiv(f.ts) }}</span></div>
      <MessageItem v-else :msg="f.msg" @menu="openMenu" @quote-jump="jumpTo" />
    </template>
    <div v-if="chat.state.loadingMsgs" class="sys">加载中…</div>
  </div>

  <BoardDock v-if="cur" />

  <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-before-composer') || []" :key="'bc' + i"
             :is="sl.component" v-bind="sl.props || {}" />

  <Composer v-if="cur" :key="cur.type + ':' + cur.id" />

  <component v-for="(sl, i) in ctx.chat?.slotsOf?.('global') || []" :key="'g' + i"
             :is="sl.component" v-bind="sl.props || {}" />

  <MessageMenu v-if="menu.open" :items="menu.items" :x="menu.x" :y="menu.y" :anchor="menu.anchor"
                 @pick="pickMenu" @close="closeMenu" />
</template>

<style scoped>
.head-main { flex: 1; min-width: 0; }
.head-main .t { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: nowrap; }
.head-main .t .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.head-main .t .s { flex: 0 0 auto; white-space: nowrap; }
.head-side { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--fg2); }
.load-more { display: flex; justify-content: center; padding-bottom: 6px; }
.more-wrap { position: relative; }
.more-btn {
  font-size: 17px; line-height: 1; padding: 0; width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 30px; border-radius: 8px;
}
.more-menu {
  /* Teleport 到 body：fixed 定位 + z 78（高于 dock 抽屉 75，低于对话框 80+） */
  position: fixed; z-index: 78; min-width: 170px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow); padding: 5px;
  max-height: calc(100vh - 16px); overflow-y: auto;
}
.more-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: transparent; color: var(--fg); font-weight: 400; font-size: 13px;
  padding: 7px 10px; border-radius: 7px;
}
.more-item:hover { background: var(--card2); }
.chat-header button { font-size: 12px; }
/* 多选态下不要因为点击消息而关掉菜单 */
.messages { position: relative; }
</style>
