<script setup lang="ts">
/**
 * 控制台外壳（对标 Koishi Console）
 *   左侧导航栏按「已注册页面」动态生成 —— 插件装载/卸载，导航项即时增减
 */
import { inject, computed, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import KSlot from './components/KSlot.vue'

const ctx = inject('ctx')
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

/**
 * 当前页对象。
 * ⚠️ current 存的是**路径字符串**，pages 里是**页面对象** ——
 *    之前写 `pages.includes(current)` 永远 false，于是每次都回落到第一个页面（聊天），
 *    表现就是「点导航/调 goto 都没反应」。必须按 path 找。
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
</script>

<template>
  <div class="console">
    <nav class="rail">
      <div class="rail-logo" title="云湖第三方客户端">云</div>
      <div class="rail-items">
        <button v-for="p in pages" :key="p.path"
                class="rail-btn" :class="{ on: active === p }"
                :title="p.name" @click="current = p.path">
          <Icon :name="p.icon" />
        </button>
      </div>
      <div class="rail-foot">
        <button class="rail-btn" :title="ui.state.theme === 'dark' ? '切换到浅色' : '切换到深色'"
                @click="ui.toggleTheme()">
          <Icon :name="ui.state.theme === 'dark' ? 'sun' : 'moon'" />
        </button>
      </div>
    </nav>

    <main class="page-area">
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
  </div>
</template>
