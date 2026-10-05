<script setup lang="ts">
/**
 * 全局轻提示。
 * 数据来自 ui 服务的 state.toasts；任何插件调 ctx.ui.toast(...) 都会到这里，
 * 所以它必须挂在最外层（App.vue），不能放在某个页面里。
 */
import { inject } from 'vue'

const ctx = inject('ctx')
const ui = ctx.ui
</script>

<template>
  <div class="toasts">
    <div v-for="t in ui.state.toasts" :key="t.id" class="toast" :class="t.type" @click="ui.dismiss(t.id)">
      {{ t.text }}
    </div>
  </div>
</template>
