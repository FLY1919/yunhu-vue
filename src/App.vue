<script setup lang="ts">
/**
 * 应用外壳：只做两件事
 *   1) 未登录 → 渲染 Login；已登录 → 渲染 Console（控制台）
 *   2) 全局挂一个 Toasts（toast 由 ui 服务驱动，不依赖具体页面）
 * 真正的页面/导航全部由插件的 console 入口动态注册，这里不写死任何业务页面。
 */
import { inject } from 'vue'
import Login from './components/Login.vue'
import Console from './console/Console.vue'
import FloatingVideoPlayer from './components/FloatingVideoPlayer.vue'
import PrivateCallPanel from './components/PrivateCallPanel.vue'
import Toasts from './components/Toasts.vue'
import CommunityEditorHost from './components/CommunityEditorHost.vue'

const ctx = inject<any>('ctx')
</script>

<template>
  <div v-if="ctx.auth?.state.status === 'switching'" class="login-wrap" role="status" aria-live="polite">正在切换账号，重新连接中…</div>
  <div v-else-if="!ctx.auth || ctx.auth.state.status !== 'ready'" class="login-wrap">
    <Login />
  </div>
  <Console v-else />
  <Toasts />
  <FloatingVideoPlayer />
  <PrivateCallPanel v-if="ctx.calls?.state.enabled" />
  <CommunityEditorHost v-if="ctx.community" />
</template>
