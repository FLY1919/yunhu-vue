<script setup lang="ts">
/**
 * 控制台外壳（对标 Koishi Console + QQ 客户端导航语义）
 *   · 导航栏按「已注册页面」动态生成 —— 插件装载/卸载，导航项即时增减
 *   · 顶部头像 = 我的资料（QQ 语义）；底部 ☰ = 全局菜单
 *     （收藏/文件/调色盘/检查更新/帮助/锁定/更多功能/退出账号）
 */
import { inject, computed, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import KSlot from './components/KSlot.vue'
import MorePanel from './MorePanel.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { resUrl } from '../core/res'
import { fallbackAvatar } from '../core/util'
import { morePins, toggleMorePin, moveMorePin } from '../core/morePins'

const ctx = inject<any>('ctx')
const console_ = ctx.console
const ui = ctx.ui
const ws = ctx.ws
const auth = ctx.auth

// 当前页：既支持本组件里点导航栏切换，也支持插件调 ctx.console.goto(path) 跳页
const current = computed({
  get: () => console_.state.currentPage || null,
  set: (v: any) => { console_.state.currentPage = v },
})
const pages = computed(() => console_.pages || [])

/** 主导航只留「消息 / 通讯录」两项（QQ 语义），其余全部进左下 ☰ 菜单 */
const MAIN_PATHS = ['/', '/contacts']
/** 固定菜单项已覆盖的页面路径，动态列表里去重，避免同页两项 */
const COVERED_PATHS = ['/account', '/config', '/theme', '/logs', '/settings-user', '/plugins', '/about']
const railPages = computed(() => pages.value.filter((p: any) => MAIN_PATHS.includes(p.path)))
/** 「更多功能」宫格展示的插件页（≡ 菜单不再一锅端堆插件页） */
const morePages = computed(() => pages.value.filter((p: any) => !MAIN_PATHS.includes(p.path) && !COVERED_PATHS.includes(p.path)))
/** 常驻状态共享给 Sidebar（core/morePins）：侧栏常驻列表与宫格管理同一份数据 */
const pinnedPages = computed(() => morePages.value.filter((p: any) => morePins.paths.includes(p.path)))
/** 宫格里展示的（未常驻的） */
const gridPages = computed(() => morePages.value.filter((p: any) => !morePins.paths.includes(p.path)))
const moreOpen2 = ref(false)
/** rail 常驻图标拖拽排序 */
const dragPin = ref('')
function dropPin(target: string) {
  if (dragPin.value && dragPin.value !== target) moveMorePin(dragPin.value, target)
  dragPin.value = ''
}

/** 总未读（QQ 式角标，挂在「消息」导航上；免打扰会话不计入） */
const totalUnread = computed(() =>
  (ctx.chat?.state?.conversations || []).reduce((n: number, c: any) =>
    n + (ctx.chat?.isMuted?.(c.id) ? 0 : (c.unread || 0)), 0))
const mutedUnread = computed(() => (ctx.chat?.state?.conversations || []).reduce((n: number, c: any) =>
  n + (ctx.chat?.isMuted?.(c.id) ? (c.unread || 0) : 0), 0))

/**
 * 当前页对象。
 * ⚠️ current 存的是**路径字符串**，pages 里是**页面对象** —— 必须按 path 找。
 */
const active = computed(() => {
  const list = pages.value
  return list.find((p: any) => p.path === current.value) || list[0] || null
})

watch(pages, (list) => {
  if (!list.some((p: any) => p.path === current.value)) current.value = list[0]?.path || ''
}, { immediate: true })

const wsText = computed(() => ({
  online: '实时在线', connecting: '连接中', retry: '重连中', closed: '已断开', idle: '未连接',
}[ws?.state.status] || '—'))

/* ---------------- QQ 式全局菜单 ---------------- */
const menuOpen = ref(false)
function closeMenu() { menuOpen.value = false }
function go(path: string) { current.value = path; closeMenu() }
/** 按路径找已注册页面；插件没装载时菜单项置灰 */
const has = (path: string) => pages.value.some((p: any) => p.path === path)

function openMe() {
  closeMenu()
  const u = auth?.state.user
  if (u) ctx.group?.openProfile?.({ id: u.id, name: u.name, avatar: u.avatar })
}
function pick(what: string) {
  switch (what) {
    case 'files': ctx.group?.setDockTab?.('disk'); break     // 文件 → 当前会话群文件 dock
    case 'palette': go('/theme'); break                      // 调色盘 → 主题页（用户设置已并入其底部）
    case 'updates': checkUpdate(); break                     // 检查更新 → 真实版本比对
    case 'help': go('/plugins'); break                       // 帮助 → 插件清单页（能力总览）
    case 'lock': ctx.emit('app/lock'); break                 // 锁定 → lock 插件监听
    case 'more': moreOpen2.value = true; break               // 更多功能宫格
    case 'logout': auth?.logout?.(); break                   // 退出账号
  }
  closeMenu()
}

/** 检查更新：走本地 server 的 /update-check（代理 GitHub Releases），dev 下回退提示 */
async function checkUpdate() {
  ui?.toast?.('正在检查更新…', 'info')
  try {
    const r = await fetch('/update-check')
    if (!r.ok) { ui?.toast?.('暂时无法检查更新（服务未就绪）', 'warn'); return }
    const j = await r.json()
    const cur = ctx.app?.version || '1.0.3'
    if (!j.ok) { ui?.toast?.('暂时无法检查更新（' + (j.msg || '网络') + '）', 'warn'); return }
    const tag = String(j.tag || '').replace(/^v/, '')
    // semver 比较：只有远端**更高**才提示新版本（相同/更低都算最新）
    const cmp = (a: string, b: string) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
      return 0
    }
    if (tag && cmp(tag, cur) > 0) {
      // 有更新：弹窗让用户选「去 Release 更新（加速链接）」或「暂不更新」
      const go = await ui?.confirm?.('发现新版本', `当前 v${cur}，最新 v${tag}。\n是否前往 Release 页更新？`, {
        okText: '去 Release 更新', cancelText: '暂不更新',
      })
      if (go) window.open(j.urlFast || j.url, '_blank')
    } else {
      ui?.toast?.(`已是最新版本（牢大版 v${cur}）`, 'info')
    }
  } catch (e: any) {
    ui?.toast?.('检查更新失败：' + e.message, 'error')
  }
}
</script>

<template>
  <div class="console">
    <nav class="rail">
      <img class="rail-av" :src="auth?.state.user?.avatar ? resUrl(auth.state.user.avatar) : fallbackAvatar(auth?.state.user?.name)"
           alt="我的资料" title="我的资料" @click="openMe"
           @error="(e: any) => (e.target.src = fallbackAvatar(auth?.state.user?.name))" />
      <div class="rail-items">
        <button v-for="p in railPages" :key="p.path"
                class="rail-btn" :class="{ on: active === p }"
                :title="p.name" @click="current = p.path">
          <Icon :name="p.icon" />
          <span v-if="p.path === '/' && (totalUnread || mutedUnread)" class="badge rail-badge" :class="{ 'unread-dot': !totalUnread }"
            :aria-label="`${totalUnread + mutedUnread} 条未读消息`">{{ totalUnread ? (totalUnread > 99 ? '99+' : totalUnread) : '' }}</span>
        </button>
        <!-- 常驻功能项（更多功能里自定义）：图标进 rail，群聊(通讯录)下方 -->
        <button v-for="p in pinnedPages" :key="p.path"
                class="rail-btn" :class="{ on: active?.path === p.path }"
                :title="p.name + '（可拖拽排序）'" draggable="true"
                @click="current = p.path"
                @dragstart="dragPin = p.path"
                @dragover.prevent
                @drop.prevent="dropPin(p.path)">
          <Icon :name="p.icon || 'page'" />
        </button>
        <!-- 更多功能入口：群聊图标下方 -->
        <button class="rail-btn" :class="{ on: moreOpen2 }" title="更多功能" @click.stop="moreOpen2 = !moreOpen2">
          <Icon name="grid" />
        </button>
      </div>
      <div class="rail-foot">
        <button v-if="has('/account') || has('/config')" class="rail-btn"
                :class="{ on: current === '/account' || current === '/config' }"
                title="账号与配置" aria-label="账号与配置"
                @click="go(has('/account') ? '/account' : '/config')">
          <Icon name="settings" />
        </button>
        <button class="rail-btn" :title="ui.state.theme === 'auto' ? '跟随系统（当前' + ui.effectiveTheme + '）' : (ui.effectiveTheme === 'dark' ? '切换到浅色' : '切换到深色')"
                @click="ui.toggleTheme()">
          <Icon :name="ui.effectiveTheme === 'dark' ? 'moon' : 'sun'" />
        </button>
        <div class="rail-menu-wrap">
          <button class="rail-btn" title="菜单" @click.stop="menuOpen = !menuOpen">
            <Icon name="menu" />
          </button>
          <div v-if="menuOpen" class="rail-menu" @click.stop>
            <button class="rm-item" @click="pick('files')"><Icon name="folder" :size="15" /> 文件</button>
            <button class="rm-item" :disabled="!has('/theme')" @click="pick('palette')"><Icon name="palette" :size="15" /> 调色盘</button>
            <div class="rm-sep"></div>
            <button class="rm-item" @click="pick('updates')"><Icon name="download" :size="15" /> 检查更新</button>
            <button class="rm-item" :disabled="!has('/plugins')" @click="pick('help')"><Icon name="help" :size="15" /> 帮助</button>
            <button class="rm-item" :disabled="!has('/about')" @click="go('/about')"><Icon name="star" :size="15" /> 关于</button>
            <button class="rm-item" @click="pick('lock')"><Icon name="lock" :size="15" /> 锁定</button>
            <div class="rm-sep"></div>
            <button class="rm-item danger" @click="pick('logout')"><Icon name="logout" :size="15" /> 退出账号</button>
          </div>
        </div>
      </div>
    </nav>

    <main class="page-area" @click="closeMenu">
      <component v-if="active" :is="active.component" :key="active.path" />
      <div v-else class="page-empty">
        <Icon name="page" :size="34" />
        <p>还没有任何页面。装载一个插件试试。</p>
      </div>
    </main>

    <footer class="statusbar">
      <div class="sb-left">
        <KSlot name="status-left" />
      </div>
      <div class="sb-right">
        <span class="dot" :class="ws && ws.state.status === 'online' ? 'on' : 'wait'"></span>
        <span>{{ wsText }}</span>
        <span v-if="auth?.state.user" class="sb-user">
          · {{ auth.state.user.name }}
          <em v-if="auth.state.user.vip">VIP</em>
        </span>
      </div>
    </footer>

    <KSlot name="global" />

    <!-- 统一 web 确认框（替代 window.confirm，z-index 最高档） -->
    <ConfirmDialog />

    <!-- 更多功能宫格（仿 QQ 截图 3，含常驻管理） -->
    <MorePanel v-if="moreOpen2" :pages="gridPages" :pinned="pinnedPages"
               @go="(p: string) => { go(p); moreOpen2 = false }"
               @manage="go('/plugins'); moreOpen2 = false"
               @pin="(p: string) => toggleMorePin(p)"
               @close="moreOpen2 = false" />
  </div>
</template>
