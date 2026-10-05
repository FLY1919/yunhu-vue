<script setup lang="ts">
/**
 * 左侧会话列表（含本地分组）。
 *
 * 关键点：
 *   · 数据源是 chat.filtered() —— 注意它是**函数**，要调用；漏了括号会一条会话都不显示
 *   · 分组完全存本地 localStorage（云湖没有分组接口）
 *   · 「未读」样式走 .has-unread（名字加重 + 小圆点），不再用整块红底，减少颜色噪音
 *   · 点头像 = 看自己的资料（走 group.openProfile）
 */
import { inject, computed, ref } from 'vue'
import { fmtTime, fallbackAvatar } from '../core/util.js'
import { resUrl } from '../core/res.js'

const ctx = inject('ctx')
const auth = ctx.auth
const chat = ctx.chat

const list = computed(() => chat.filtered())
function open(c) { chat.open(c) }

/* ---------------- 会话分组（本地，存 localStorage） ---------------- */
const newGroup = ref('')
// 注意：filtered 是函数，必须调用 —— 之前少个括号导致侧栏一条会话都不显示
const sections = computed(() => chat.sections(chat.filtered()))
function addGroup() { chat.addGroup(newGroup.value); newGroup.value = '' }
/** 右键会话 → 选分组（用 prompt 选序号，简单可靠） */
function assign(c: any) {
  const gs = chat.groups.groups
  if (!gs.length) {
    const n = window.prompt('还没有分组，输入一个分组名给「' + c.name + '」：')
    if (n) { chat.addGroup(n); const g = chat.groups.groups.find((x: any) => x.name === n); if (g) chat.assignTo(c.id, g.id) }
    return
  }
  const cur = chat.groupOf(c.id)
  const menu = gs.map((g: any, i: number) => `${i + 1}. ${g.name}${g.id === cur ? '（当前）' : ''}`).join('\n')
  const ans = window.prompt(`把「${c.name}」放进哪个分组？\n0. 移出分组\n${menu}`, '')
  if (ans === null) return
  const n = Number(ans)
  if (!n) { chat.assignTo(c.id, ''); return }
  const g = gs[n - 1]
  if (g) chat.assignTo(c.id, g.id)
}
/** 点自己的头像 → 打开自己的详细资料 */
function openMe() {
  const u = auth.state.user
  if (u) ctx.group?.openProfile?.({ id: u.id, name: u.name, avatar: u.avatar })
}
</script>

<template>
  <div class="sidebar">
    <div class="me">
      <img class="me-av" :src="auth.state.user?.avatar ? resUrl(auth.state.user.avatar) : fallbackAvatar(auth.state.user?.name)" alt=""
           title="查看我的资料" @click="openMe"
           @error="e => (e.target.src = fallbackAvatar(auth.state.user?.name))" />
      <div class="info">
        <div class="name">{{ auth.state.user?.name }}</div>
        <div class="sub">ID {{ auth.state.user?.id }}</div>
      </div>
    </div>

    <!-- 插槽：chat-sidebar-top -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-sidebar-top') || []" :key="'st' + i"
               :is="sl.component" v-bind="sl.props || {}" />

    <div class="search">
      <input v-model="chat.state.keyword" placeholder="搜索会话…" />
    </div>

    <!-- 会话分组（本地）：有分组时按分组渲染，可折叠 -->
    <div v-if="sections.groups.length" class="grp-bar">
      <button v-for="g in sections.groups" :key="g.id" class="grp-chip"
              :class="{ on: !chat.isCollapsed(g.id) }" @click="chat.toggleCollapse(g.id)">
        {{ g.name }} <em>{{ g.items.length }}</em>
      </button>
    </div>

    <ul class="convs">
      <template v-for="g in sections.groups" :key="g.id">
        <li class="grp-head" @click="chat.toggleCollapse(g.id)">
          <span class="tri">{{ chat.isCollapsed(g.id) ? '▸' : '▾' }}</span>{{ g.name }}
          <em>{{ g.items.length }}</em>
          <span class="grow"></span>
          <button class="ghost tiny" title="删除分组" @click.stop="chat.removeGroup(g.id)">×</button>
        </li>
        <template v-if="!chat.isCollapsed(g.id)">
          <li v-for="c in g.items" :key="c.id" :class="{ active: chat.state.current?.id === c.id, 'has-unread': !!c.unread }"
              @click="open(c)" @contextmenu.prevent="assign(c)">
            <img :src="c.avatar ? resUrl(c.avatar) : fallbackAvatar(c.name)" alt=""
                 @error="e => (e.target.src = fallbackAvatar(c.name))" />
            <div class="mid">
              <div class="top"><span class="cname">{{ c.at ? '[有人@我] ' : '' }}{{ c.name }}</span><span class="time">{{ fmtTime(c.ts) }}</span></div>
              <div class="prev">{{ c.preview }}</div>
            </div>
            <span v-if="c.unread" class="badge">{{ c.unread > 99 ? '99+' : c.unread }}</span>
          </li>
        </template>
      </template>

      <li v-for="c in sections.ungrouped" :key="c.id" :class="{ active: chat.state.current?.id === c.id, 'has-unread': !!c.unread }"
          @click="open(c)" @contextmenu.prevent="assign(c)">
        <img :src="c.avatar ? resUrl(c.avatar) : fallbackAvatar(c.name)" alt=""
             @error="e => (e.target.src = fallbackAvatar(c.name))" />
        <div class="mid">
          <div class="top">
            <span class="cname">{{ c.at ? '[有人@我] ' : '' }}{{ c.name }}</span>
            <span class="time">{{ fmtTime(c.ts) }}</span>
          </div>
          <div class="prev">{{ c.preview }}</div>
        </div>
        <span v-if="c.unread" class="badge">{{ c.unread > 99 ? '99+' : c.unread }}</span>
      </li>
      <li v-if="!list.length" class="hint">
        {{ chat.state.loadingConvs ? '加载中…' : '暂无会话' }}
      </li>
    </ul>

    <!-- 新建分组 -->
    <div class="grp-new">
      <input v-model="newGroup" placeholder="新建分组…" @keyup.enter="addGroup" />
      <button class="ghost small" @click="addGroup">+</button>
    </div>

    <!-- 插槽：chat-sidebar-bottom -->
    <component v-for="(sl, i) in ctx.chat?.slotsOf?.('chat-sidebar-bottom') || []" :key="'sb' + i"
               :is="sl.component" v-bind="sl.props || {}" />
  </div>
</template>
