<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ entries: { id: string; label: string; syntax: string }[]; selected: number }>()
const emit = defineEmits<{ choose: [index: number] }>()
const list = ref<HTMLElement>()
watch(() => props.selected, () => {
  const container = list.value
  const row = container?.querySelector<HTMLElement>('.suggested')
  if (!row || !container) return
  const offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top
  if (offset < 0) container.scrollTop += offset
  else if (offset + row.offsetHeight > container.clientHeight) container.scrollTop += offset + row.offsetHeight - container.clientHeight
}, { flush: 'post' })
</script>

<template>
  <Transition name="completion">
    <div v-if="entries.length" class="md-completion" aria-label="Markdown 自动补全">
      <header><strong>插入 Markdown</strong><small>↑ ↓ 选择 · Tab / Enter 插入</small></header>
      <ul ref="list">
        <li v-for="(entry, i) in entries" :key="entry.id">
          <button type="button" :class="{ suggested: i === selected }" @pointerdown.prevent @click="emit('choose', i)">
            <span>{{ entry.label }}</span><code>{{ entry.syntax }}</code>
          </button>
        </li>
      </ul>
    </div>
  </Transition>
</template>

<style scoped>
.md-completion { position:absolute; z-index:20; inset:auto auto 12px 12px; width:min(265px,calc(100% - 24px)); border:1px solid var(--line); border-radius:12px; background:var(--card); color:var(--fg); box-shadow:0 8px 22px #0003; }
.md-completion header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:3px; padding:8px 9px; font-size:12px; }
.md-completion small { color:var(--fg2); font-size:10px; }
.md-completion ul { max-height:min(214px,28vh); overflow:auto; padding:0 4px 4px; margin:0; list-style:none; }
.md-completion button { width:100%; display:flex; align-items:center; justify-content:space-between; padding:6px; border:0; border-radius:6px; color:var(--fg); background:transparent; font-size:12px; }
.md-completion button.suggested,.md-completion button:hover { background:var(--acc-soft); }
.md-completion code { color:var(--fg2); font-size:11px; }
.completion-enter-active,.completion-leave-active { transition:opacity 140ms,transform 140ms cubic-bezier(.23,1,.32,1); }
.completion-leave-active { pointer-events:none; }
.completion-enter-from,.completion-leave-to { opacity:0; transform:translateY(4px); }
@media (prefers-reduced-motion:reduce) { .completion-enter-active,.completion-leave-active { transition:none; } }
</style>
