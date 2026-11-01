<script setup lang="ts">
import { inject } from 'vue'
import { fmtTime, fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
import Icon from '../console/components/Icon.vue'

defineProps<{ c: any }>()
const emit = defineEmits<{
  (e: 'open', c: any): void
  (e: 'menu', c: any, event: MouseEvent): void
}>()
const chat = inject<any>('ctx').chat
</script>

<template>
  <li :class="{ active: chat.state.current?.id === c.id && chat.state.current?.type === c.type, 'has-unread': !!c.unread, muted: chat.isMuted(c.id) }"
      @click="emit('open', c)" @contextmenu.prevent="emit('menu', c, $event)">
    <img :src="c.avatar ? resUrl(c.avatar) : fallbackAvatar(c.name)" alt=""
         @error="(e: any) => (e.target.src = fallbackAvatar(c.name))" />
    <div class="mid">
      <div class="top">
        <span class="cname">{{ c.at ? '[有人@我] ' : '' }}{{ c.name }}</span>
        <Icon v-if="chat.isMuted(c.id)" name="bellOff" :size="12" class="mute-ico" title="免打扰" />
        <span class="time">{{ fmtTime(c.ts) }}</span>
      </div>
      <div class="prev">{{ c.preview }}</div>
    </div>
    <span v-if="c.unread" class="badge" :class="{ 'muted-unread': chat.isMuted(c.id) }"
          :aria-label="`${c.unread} 条未读${chat.isMuted(c.id) ? '（免打扰）' : ''}`"
          :title="`${c.unread} 条未读${chat.isMuted(c.id) ? ' · 免打扰' : ''}`">{{ c.unread > 99 ? '99+' : c.unread }}</span>
    <Icon v-if="chat.isPinned(c.id)" name="pinUp" :size="13" class="pin-ico" role="img" aria-label="已置顶" />
  </li>
</template>
