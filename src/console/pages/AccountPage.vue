<script setup lang="ts">
/** 账号页 */
import { inject, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res.js'
import { fallbackAvatar } from '../../core/util.js'

const ctx = inject('ctx')
const auth = ctx.auth
const api = ctx.api
const ws = ctx.ws
const ui = ctx.ui

const user = computed(() => auth.state.user || {})
const wsText = computed(() => ({
  online: '实时在线', connecting: '连接中', retry: '重连中', closed: '已断开', idle: '未连接',
}[ws?.state.status] || '—'))
</script>

<template>
  <KLayout ns="account" title="账号" desc="登录态、连接与外观">
    <KCard>
      <div class="account">
        <img :src="user.avatar ? resUrl(user.avatar) : fallbackAvatar(user.name)"
             @error="e => (e.target.src = fallbackAvatar(user.name))" alt="" />
        <div class="acc-main">
          <div class="acc-name">{{ user.name }} <em v-if="user.vip">VIP</em></div>
          <div class="dim small">ID {{ user.id }} · 🪙 {{ Math.round(user.coin || 0) }}</div>
          <div class="dim small">{{ user.email }}</div>
        </div>
        <button class="ghost" @click="auth.logout()">退出登录</button>
      </div>
    </KCard>

    <KCard title="连接" class="mt">
      <div class="kv"><span class="k">API 基址</span><code>{{ api.base }}</code></div>
      <div class="kv">
        <span class="k">WebSocket</span>
        <span>
          <span class="dot" :class="ws?.state.status === 'online' ? 'on' : 'wait'"></span>
          {{ wsText }}
          <code class="dim">{{ ws?.state.url || '—' }}</code>
        </span>
      </div>
      <div class="kv" v-if="ws?.state.error"><span class="k">最近错误</span><span class="err">{{ ws.state.error }}</span></div>
      <button class="ghost small mt-sm" @click="ws?.reconnect()">重新连接</button>
    </KCard>

    <KCard title="外观" class="mt">
      <div class="kv">
        <span class="k">主题</span>
        <button class="ghost small" @click="ui.toggleTheme()">
          {{ ui.state.theme === 'dark' ? '深色 → 浅色' : '浅色 → 深色' }}
        </button>
      </div>
    </KCard>

    <KCard title="关于" class="mt">
      <p class="dim small">
        云湖第三方客户端 · Vue 3 + 自研 Cordis 风格插件内核。<br />
        接口来自社区公开整理（yh-Tpdev/yhchatAPI、yhwiki），仅供学习交流，请勿用于违规用途。<br />
        资源经本站 <code>/res</code> 代理补 Referer 防盗链头后加载。
      </p>
    </KCard>
  </KLayout>
</template>
