<script setup lang="ts">
/**
 * 输入区上方的「正在引用」提示条。
 * 引用态存在 chat.state.reply，发送时作为 quoteId 带上；点 × 清掉。
 */
import { inject } from 'vue'

const ctx = inject<any>('ctx')
const chat = ctx.chat
</script>

<template>
  <div class="quotebar" v-if="chat.state.reply">
    <span class="qb-ico">↩</span>
    <div class="qb-main">
      <b>{{ chat.state.reply.sender }}</b>
      <span class="qb-text">{{ chat.state.reply.preview }}</span>
    </div>
    <button class="qb-x" title="取消引用" @click="chat.clearReply()">×</button>
  </div>
</template>

<style scoped>
.quotebar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  padding: 7px 12px; border-radius: 9px; background: var(--card2);
  border-left: 3px solid var(--acc);
}
.qb-ico { color: var(--acc); font-size: 15px; }
.qb-main { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; }
.qb-text { color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-x { background: transparent; color: var(--fg2); padding: 0 6px; font-size: 16px; line-height: 1; }
.qb-x:hover { color: var(--err); background: transparent; }
</style>
