<script setup lang="ts">
/**
 * 插槽示例组件：多选按钮
 * 它不属于任何页面，而是由 message-actions 插件通过
 *   ctx.chat.slot({ type: 'chat-header-extra', component: SelectAllButton })
 * 注入到聊天标题栏右侧 —— 用来演示「其他插件也能改这个页面」。
 */
import { inject } from 'vue'

const ctx = inject<any>('ctx')
const chat = ctx.chat
</script>

<template>
  <button class="ghost small" title="进入多选" @click="chat.startSelecting()"
          style="display:inline-flex;align-items:center;gap:4px">
    多选
  </button>
</template>
