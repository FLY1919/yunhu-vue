<script setup lang="ts">
import { routeChatMedia } from '../core/media-devices'
import { inject, ref, watch } from 'vue'
import { floatingVideo } from '../core/video-pip'
import Icon from '../console/components/Icon.vue'

const ctx = inject<any>('ctx')
const position = ref<{ x: number; y: number }>()
watch(() => [ctx.lock?.isLocked, ctx.auth?.state.status], ([locked, status]) => {
  if (locked || status !== 'ready') floatingVideo.value = null
  if (locked && document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
})
function restore(event: Event) {
  const video = event.currentTarget as HTMLVideoElement
  const item = floatingVideo.value
  if (!item) return
  video.currentTime = Math.min(item.time, Number.isFinite(video.duration) ? video.duration : item.time)
  video.volume = item.volume
  video.muted = item.muted
  video.playbackRate = item.rate
  if (item.playing) void video.play().catch(() => {})
}
let offset: { x: number; y: number } | undefined
function beginDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const header = event.currentTarget as HTMLElement
  const rect = header.getBoundingClientRect()
  offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  header.setPointerCapture(event.pointerId)
}
function drag(event: PointerEvent) {
  if (!offset) return
  const header = event.currentTarget as HTMLElement
  position.value = {
    x: Math.max(0, Math.min(innerWidth - header.offsetWidth, event.clientX - offset.x)),
    y: Math.max(0, Math.min(innerHeight - (header.parentElement?.offsetHeight || 200), event.clientY - offset.y)),
  }
}
function finishDrag() { offset = undefined }
</script>

<template>
  <Teleport to="body">
    <Transition name="video-float">
      <section v-if="floatingVideo" class="floating-video-player" aria-label="视频小窗"
        :style="position ? { left: 'min(' + position.x + 'px, max(0px, calc(100vw - 332px)))', top: 'min(' + position.y + 'px, max(0px, calc(100dvh - min(221px, 38dvh))))', right: 'auto', bottom: 'auto' } : undefined">
        <header @pointerdown="beginDrag" @pointermove="drag" @pointerup="finishDrag" @pointercancel="finishDrag" @lostpointercapture="finishDrag">
          <span>小窗播放</span>
          <button type="button" aria-label="关闭视频小窗" @click="floatingVideo = null"><Icon name="close" :size="16" /></button>
        </header>
        <video :key="floatingVideo.src" :src="floatingVideo.src" controls playsinline @play="routeChatMedia" @loadedmetadata="restore" />
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.floating-video-player { position:fixed; z-index:85; right:14px; bottom:18px; width:min(330px,calc(100vw - 22px)); border:1px solid var(--line); border-radius:12px; background:var(--card); box-shadow:0 10px 30px #0005; overflow:hidden; color:var(--fg); }
.floating-video-player header { display:flex; align-items:center; justify-content:space-between; padding:4px 6px 4px 11px; font-size:12px; cursor:grab; touch-action:none; user-select:none; }
.floating-video-player header button { display:grid; place-items:center; padding:5px; color:var(--fg); background:transparent; }
.floating-video-player header button:hover { background:var(--acc-soft); }
.floating-video-player video { display:block; width:100%; aspect-ratio:16/9; max-height:32dvh; background:#000; object-fit:contain; }
.video-float-enter-active,.video-float-leave-active { transition:opacity 160ms,transform 160ms cubic-bezier(.23,1,.32,1); }
.video-float-enter-from,.video-float-leave-to { opacity:0; transform:translateY(5px); }
@media(prefers-reduced-motion:reduce) { .video-float-enter-active,.video-float-leave-active { transition:none; } }
</style>
