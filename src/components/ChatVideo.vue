<script setup lang="ts">
import { routeChatMedia } from '../core/media-devices'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { videoPoster } from '../core/video-posters'
import { toggleVideoPip } from '../core/video-pip'
import Icon from '../console/components/Icon.vue'

const props = defineProps<{ src: string; poster?: string; width?: number; height?: number }>()
const emit = defineEmits<{ expand: [time: number] }>()
const ctx = inject<any>('ctx', null)
const pip = ref(false)
const card = ref<HTMLElement>()
const player = ref<HTMLVideoElement>()
const poster = ref('')
const inline = ref(false)
const failed = ref(false)
const near = ref(false)
const ratio = computed(() => props.width && props.height ? String(Math.min(2.4, Math.max(1, props.width / props.height))) : '16/9')
let observer: IntersectionObserver | undefined
let request: AbortController | undefined
let failedPoster = ''

function preview() {
  request?.abort()
  if (!near.value || document.hidden || inline.value || poster.value || !props.src || (props.poster && props.poster !== failedPoster)) return
  const controller = request = new AbortController()
  void videoPoster(props.src, controller.signal).then(url => {
    if (!controller.signal.aborted) poster.value = url
  })
}
function badPoster() { failedPoster = props.poster || ''; poster.value = ''; preview() }
function expand() {
  const time = player.value?.currentTime || 0
  player.value?.pause()
  emit('expand', time)
}
async function smallWindow() {
  if (!player.value) return
  try { await toggleVideoPip(player.value) }
  catch { ctx?.ui?.toast('视频小窗暂不可用，请稍后重试', 'warn') }
}
function release() {
  if (player.value && document.pictureInPictureElement === player.value) void document.exitPictureInPicture().catch(() => {})
  pip.value = false
  request?.abort()
  player.value?.pause()
  if (player.value) {
    player.value.removeAttribute('src')
    player.value.load()
  }
}
watch(() => [props.src, props.poster], () => {
  release()
  inline.value = false; failed.value = false; failedPoster = ''
  poster.value = near.value ? props.poster || '' : ''
  preview()
})
watch(inline, preview)
onMounted(() => {
  if (typeof IntersectionObserver === 'function' && card.value) {
    observer = new IntersectionObserver(([entry]) => {
      if (near.value === entry.isIntersecting) return
      near.value = entry.isIntersecting
      if (near.value && props.poster && props.poster !== failedPoster) poster.value = props.poster
      preview()
    }, { root: card.value.closest('.messages'), rootMargin: '120px 0px' })
    observer.observe(card.value)
  } else { near.value = true; poster.value = props.poster || ''; preview() }
  document.addEventListener('visibilitychange', preview)
})
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', preview); release() })
</script>

<template>
  <div ref="card" class="chat-video" :style="{ aspectRatio: ratio }">
    <video v-if="inline && !failed" ref="player" :src="src" :poster="poster || undefined" controls controlslist="nofullscreen"
      playsinline autoplay @play="routeChatMedia" @enterpictureinpicture="pip = true" @leavepictureinpicture="pip = false" @error="failed = true" />
    <button v-else type="button" class="video-preview" :aria-label="failed ? '重试播放视频' : '播放视频'"
      @click.stop="inline = true; failed = false">
      <img v-if="poster" :src="poster" alt="" decoding="async" @error="badPoster" />
      <span class="play-badge"><Icon name="play" :size="21" /></span>
      <span v-if="failed" class="video-error">播放失败，点击重试</span>
    </button>
    <button v-if="inline && !failed" type="button" class="video-expand video-pip" :aria-pressed="pip"
      :aria-label="pip ? '退出小窗播放' : '小窗播放'" :title="pip ? '退出小窗播放' : '小窗播放'" @click.stop="smallWindow">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="6" height="5" rx="1"/></svg>
    </button>
    <button type="button" class="video-expand" title="在软件内全屏" aria-label="在软件内全屏" @click.stop="expand">
      <Icon name="expand" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.chat-video { position:relative; width:100%; max-height:320px; background:var(--card2); border-radius:9px; overflow:hidden; }
.chat-video video,.video-preview,.video-preview img { display:block; width:100%; height:100%; object-fit:contain; }
.chat-video video { background:#000; }
.chat-video video::-webkit-media-controls-fullscreen-button { display:none; }
.video-preview { position:relative; padding:0; border:0; background:var(--card2); color:var(--fg); cursor:pointer; }
.play-badge,.video-expand { display:grid; place-items:center; border:0; border-radius:50%; background:#17171cc9; color:#fff; }
.play-badge { position:absolute; inset:50% auto auto 50%; transform:translate(-50%,-50%); width:42px; height:42px; }
.video-expand { position:absolute; inset:7px 7px auto auto; width:30px; height:30px; cursor:pointer; }
.video-pip { right:43px; }
.video-preview:hover .play-badge,.video-expand:hover { background:var(--acc); color:var(--on-acc,#fff); }
.video-error { position:absolute; inset:auto 0 6px; text-align:center; font-size:12px; }
.video-preview:focus-visible,.video-expand:focus-visible { outline:2px solid var(--link,var(--acc)); outline-offset:-2px; }
</style>
