<script setup lang="ts">
import { inject } from 'vue'
import ChatView from './ChatView.vue'
import FloatingVideoPlayer from './FloatingVideoPlayer.vue'
import Toasts from './Toasts.vue'
import ConfirmDialog from '../console/components/ConfirmDialog.vue'
const ctx = inject<any>('ctx')
</script>

<template>
  <div class="detached-conversation chat-main" :style="ctx.charbg?.bgStyleOf?.(ctx.chat.state.current?.id)">
    <ChatView detached />
    <Toasts />
    <FloatingVideoPlayer />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.detached-conversation { display:flex; flex-direction:column; height:100dvh; width:100%; min-width:0; overflow:hidden; }
</style>
