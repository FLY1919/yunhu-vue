<script setup lang="ts">
/**
 * 聊天标题栏的「指令」入口（commands 插件通过 chat.slot 注入）
 * 点一下打开指令面板；有可用指令时会显示数量。
 */
import { inject, computed } from 'vue'

const ctx = inject<any>('ctx')
const cm = ctx.commands

const count = computed(() => (cm?.state?.list || []).length)
</script>

<template>
  <button class="ghost small cmd-btn" title="机器人指令（输入 / 也能唤起）" @click="cm?.open?.()">
    指令<span v-if="count" class="n">{{ count }}</span>
  </button>
</template>

<style scoped>
.cmd-btn { display: inline-flex; align-items: center; gap: 4px; }
.cmd-btn .n { font-size: 10.5px; opacity: .65; }
</style>
