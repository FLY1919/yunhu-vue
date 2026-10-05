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

/* ---- 右键菜单状态 ---- */
/** 右上角「⋮」菜单 */
const moreOpen = ref(false)
const moreAll = ref(false)   // 「显示其他」是否展开
function pick(what: 'board' | 'members' | 'tags' | 'search' | 'info' | 'disk' | 'all' | 'settings' | 'chatbg') {
  moreOpen.value = false
  moreAll.value = false
  if (what === 'settings') { ctx.group?.toggle(); return }        // 群设置抽屉
  if (what === 'chatbg') { ctx.charbg?.openDialog?.(); return }   // 聊天背景（原来指向的主题页压根没实现）
  ctx.group?.setDockTab(what as any)                              // 其余都是全屏群界面里的页签
}
function closeMore() { moreOpen.value = false; moreAll.value = false }

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

/** 点引用跳到被引用的消息 */
function jumpTo(mid: string) {
  const el = document.querySelector(`[data-mid="${mid}"]`) as HTMLElement | null
  if (!el) { ctx.ui?.toast('被引用的消息不在当前已加载的记录里', 'warn'); return }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1200)
}

function toBottom() { nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight }) }
const off = ctx.on('chat/scroll-bottom', toBottom)
onUnmounted(() => off())
// 点空白关掉 ⋮ 菜单
const offDoc = () => closeMore()
watch(() => cur.value?.id, toBottom)
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
      <span class="dot wait"></span>
      <button class="ghost small" @click="ctx.ws.reconnect()">重连</button>
    </div>

    <!-- 插件插槽：其他插件可以往这里塞自己的组件 -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-header-extra') || []" :key="'h' + i"
               :is="sl.component" v-bind="sl.props || {}" />

    <!-- ⋮ 更多：看板 / 成员 / 群标签 / 记录 / 群设置 -->
    <div class="more-wrap" v-if="cur">
      <button class="ghost small more-btn" title="更多" @click.stop="moreOpen = !moreOpen">⋮</button>
      <div v-if="moreOpen" class="more-menu" @click.stop>
        <button class="more-item" @click="pick('board')"><Icon name="page" :size="14" /> 看板</button>
        <button class="more-item" v-if="cur.type === 2" @click="pick('members')"><Icon name="user" :size="14" /> 成员</button>
        <button class="more-item" @click="pick('search')"><Icon name="search" :size="14" /> 聊天记录</button>
        <!-- 「显示其他」：展开完整功能菜单（群文件等不用再靠特殊方法找） -->
        <button class="more-item" @click="moreAll = !moreAll">
          <Icon name="menu" :size="14" /> {{ moreAll ? '收起其他' : '显示其他…' }}
          <span class="grow"></span>
          <span class="dim small">{{ moreAll ? '▲' : '▼' }}</span>
        </button>
        <template v-if="moreAll">
          <button class="more-item" v-if="cur.type === 2" @click="pick('info')"><Icon name="page" :size="14" /> 群资料</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('disk')"><Icon name="folder" :size="14" /> 群文件</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('tags')"><Icon name="check" :size="14" /> 群标签</button>
          <button class="more-item" v-if="cur.type === 2" @click="pick('all')"><Icon name="search" :size="14" /> 全部看板</button>
          <button class="more-item" @click="pick('chatbg')"><Icon name="palette" :size="14" /> 聊天背景</button>
          <button class="more-item" @click="pick('settings')"><Icon name="settings" :size="14" /> {{ cur.type === 2 ? '群设置' : '会话设置' }}</button>
        </template>
      </div>
    </div>
  </header>

  <SelectionBar v-if="cur" />

  <div v-if="!cur" class="empty">
    <div>
      <div style="font-size: 30px">💬</div>
      <div>从左侧选择一个会话开始聊天</div>
      <div class="small dim" style="margin-top: 6px">右键消息可引用 / 转发 / 撤回 / 多选</div>
    </div>
  </div>

  <div v-else ref="box" class="messages" @click="closeMenu(); closeMore()">
    <div v-if="chat.state.hasMore" class="load-more">
      <button class="ghost small" :disabled="chat.state.loadingMore" @click="chat.loadMore()">
        {{ chat.state.loadingMore ? '加载中…' : '加载更多历史' }}
      </button>
    </div>
    <MessageItem v-for="m in chat.state.messages" :key="m.id" :msg="m" @menu="openMenu" @quote-jump="jumpTo" />
    <div v-if="chat.state.loadingMsgs" class="sys">加载中…</div>
  </div>

  <BoardDock v-if="cur" />

  <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-before-composer') || []" :key="'bc' + i"
             :is="sl.component" v-bind="sl.props || {}" />

  <Composer v-if="cur" />

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
  position: absolute; right: 0; top: 110%; z-index: 60; min-width: 148px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow); padding: 5px;
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
