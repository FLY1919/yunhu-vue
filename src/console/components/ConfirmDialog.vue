<script setup lang="ts">
/**
 * ConfirmDialog —— 统一 web 确认框（替代 window.confirm，避免原生框与 web UI 割裂）
 * 用法：const ok = await ctx.ui.confirm('标题', '正文')
 * 全局单例，通过 Teleport 放在资料面板与消息菜单之上。
 */
import { inject, computed } from 'vue'
import Icon from './Icon.vue'

const ctx = inject<any>('ctx')
const ui = ctx.ui

const req = computed(() => ui?.state?.confirmReq || null)

function answer(ok: boolean) {
  ui?.resolveConfirm?.(ok)
}
</script>

<template>
  <Teleport to="body">
  <div v-if="req" class="cf-mask" @click.self="answer(false)">
    <div class="cf-box" role="dialog" aria-modal="true" :aria-label="req.title">
      <div class="cf-title">{{ req.title }}</div>
      <div v-if="req.message" class="cf-msg">{{ req.message }}</div>
      <div class="cf-row">
        <button class="cf-btn" @click="answer(false)">{{ req.cancelText || '取消' }}</button>
        <button class="cf-btn ok" :class="{ danger: req.danger }" @click="answer(true)">
          {{ req.okText || '确定' }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.cf-mask {
  position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, .45);
  display: grid; place-items: center; backdrop-filter: blur(3px);
}
.cf-box {
  width: min(360px, 90vw); background: var(--card); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: 0 18px 50px rgba(0, 0, 0, .5); padding: 20px;
  display: flex; flex-direction: column; gap: 10px;
}
.cf-title { font-size: 15px; font-weight: 600; }
.cf-msg { font-size: 13px; color: var(--fg2); line-height: 1.7; white-space: pre-wrap; }
.cf-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.cf-btn {
  padding: 7px 18px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--card2); color: var(--fg); font-size: 13px; cursor: pointer;
}
.cf-btn:hover { background: var(--line); }
.cf-btn.ok { background: var(--acc); border-color: transparent; color: #fff; }
.cf-btn.ok:hover { filter: brightness(1.1); }
.cf-btn.ok.danger { background: var(--err); }
</style>
