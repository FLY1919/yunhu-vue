<script setup lang="ts">
/**
 * 全局轻提示。
 * 数据来自 ui 服务的 state.toasts；任何插件调 ctx.ui.toast(...) 都会到这里，
 * 所以它必须挂在最外层（App.vue），不能放在某个页面里。
 */
import { inject } from 'vue'
import { resUrl } from '../core/res'

const ctx = inject<any>('ctx')
const ui = ctx.ui
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toasts" aria-live="polite" aria-relevant="additions text">
    <div v-for="t in ui.state.toasts" :key="t.id" class="toast" :class="t.type">
      <img v-if="t.avatar" class="toast-avatar" :src="resUrl(t.avatar)" alt="" @error="(e: any) => e.target.style.display = 'none'" />
      <button v-if="t.onClick" class="toast-action" @click="ui.activate(t.id)">
        <strong v-if="t.title">{{ t.title }}</strong>
        <span>{{ t.text }}</span>
        <small>点击查看消息</small>
      </button>
      <span v-else class="toast-text" @click="ui.dismiss(t.id)">{{ t.text }}</span>
      <button class="toast-close" title="关闭通知" aria-label="关闭通知" @click="ui.dismiss(t.id)">×</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts { width: min(360px, calc(100vw - 32px)); pointer-events: none; }
.toast { display: flex; align-items: flex-start; gap: 8px; min-width: 0; max-width: 100%; pointer-events: auto; }
.toast-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; flex: 0 0 38px; }
.toast-action { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 0;
  background: none; color: inherit; text-align: left; font-weight: 400; border: 0; }
.toast-action:hover { background: none; filter: none; }
.toast-action strong, .toast-action span, .toast-text { overflow-wrap: anywhere; }
.toast-action span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.toast-action small { color: var(--acc); }
.toast-close { flex-shrink: 0; padding: 0; width: 24px; height: 24px; border: 0;
  background: none; color: var(--fg2); font-size: 18px; }
.toast-action:focus-visible, .toast-close:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; }
.toast-enter-active, .toast-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(12px); }
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active, .toast-leave-active { transition: none; }
}
</style>
