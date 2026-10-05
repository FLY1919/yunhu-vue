<script setup lang="ts">
/**
 * 多选工具栏（选中消息后浮在底部）。
 * 按钮不写死：来自 chat.menu('selection', [...]) 的插件注册，
 * 所以卸载 message-actions 后这整条就空了。
 */
import { inject, computed } from 'vue'

const ctx = inject<any>('ctx')
const chat = ctx.chat

const items = computed(() => chat.menuOf('selection'))
const count = computed(() => chat.state.selected.length)
const total = computed(() => chat.state.messages.length)
</script>

<template>
  <div class="selbar" v-if="chat.state.selecting">
    <span class="sel-count">已选 <b>{{ count }}</b> / {{ total }}</span>
    <div class="sel-actions">
      <button v-for="it in items" :key="it.id" class="ghost small"
              :class="{ danger: it.danger }" @click="chat.run(it.id, {})">
        {{ it.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.selbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 16px; background: var(--acc-soft); border-bottom: 1px solid var(--line);
  animation: sel-in .16s ease-out;
}
@keyframes sel-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.sel-count { font-size: 13px; color: var(--fg2); }
.sel-count b { color: var(--acc); }
.sel-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ghost.danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); }
.ghost.danger:hover { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }
</style>
