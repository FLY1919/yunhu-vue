<script setup lang="ts">
import Icon from '../console/components/Icon.vue'
import type { CallKind } from '../core/yunhu-calls'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ call: [kind: CallKind] }>()
</script>

<template>
  <div class="composer-calls" role="group" aria-label="通话">
    <button type="button" class="ghost tiny icon-btn" :disabled="busy" title="发起语音通话" aria-label="发起语音通话" @click="emit('call', 'voice')">
      <Icon name="callVoice" :size="17" aria-hidden="true" />
    </button>
    <button type="button" class="ghost tiny icon-btn" :disabled="busy" title="发起视频通话" aria-label="发起视频通话" @click="emit('call', 'video')">
      <Icon name="callVideo" :size="17" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.composer-calls { display:inline-flex; flex-shrink:0; gap:3px; }
.composer-calls button { display:grid; place-items:center; width:29px; height:29px; padding:5px; border:0; border-radius:6px; color:var(--fg); background:transparent; transition:background .13s, transform .12s; }
.composer-calls button:hover:not(:disabled) { background:var(--acc-soft); }
.composer-calls button:active:not(:disabled) { transform:translateY(1px); }
.composer-calls button:disabled { opacity:.45; }
@media (max-width:650px) { .composer-calls { gap:1px; } .composer-calls button { width:27px; } }
@media (prefers-reduced-motion:reduce) { .composer-calls button { transition:none; } }
</style>
