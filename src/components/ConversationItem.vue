<script setup lang="ts">
import { inject } from 'vue'
import { fmtTime, fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
import Icon from '../console/components/Icon.vue'

defineProps<{ c: any }>()
const emit = defineEmits<{
  (e: 'open', c: any): void
  (e: 'drag', c: any, event: PointerEvent): void
  (e: 'menu', c: any, event: MouseEvent): void
}>()
const chat = inject<any>('ctx').chat
const muted = (c: any) => c.noDisturb ?? chat.isMuted(c.id)
const pinned = (c: any) => c.pinned ?? chat.isPinned(c.id)
</script>

<template>
  <li class="conversation-item" :class="{ active: chat.state.current?.id === c.id && chat.state.current?.type === c.type, 'has-unread': !!c.unread, muted: muted(c) }"
      @click="emit('open', c)" @pointerdown="emit('drag', c, $event)" @contextmenu.prevent="emit('menu', c, $event)">
    <img :src="c.avatar ? resUrl(c.avatar) : fallbackAvatar(c.name)" alt="" draggable="false" loading="lazy" decoding="async"
         @error="(e: any) => (e.target.src = fallbackAvatar(c.name))" />
    <div class="mid">
      <div class="top">
        <span class="cname">{{ c.at ? '[有人@我] ' : '' }}{{ c.name }}</span>
        <Icon v-if="muted(c)" name="bellOff" :size="12" class="mute-ico" title="免打扰" />
        <span class="time">{{ fmtTime(c.ts) }}</span>
      </div>
      <div class="prev">{{ c.preview }}</div>
    </div>
    <span v-if="c.unread" class="badge" :class="{ 'muted-unread': muted(c) }"
          :aria-label="`${c.unread} 条未读${muted(c) ? '（免打扰）' : ''}`"
          :title="`${c.unread} 条未读${muted(c) ? ' · 免打扰' : ''}`">{{ c.unread > 99 ? '99+' : c.unread }}</span>
    <Icon v-if="pinned(c)" name="pinUp" :size="13" class="pin-ico" role="img" aria-label="已置顶" />
  </li>
</template>

<style scoped>
.conversation-item { content-visibility:auto; contain-intrinsic-block-size:auto 36px; }
</style>
