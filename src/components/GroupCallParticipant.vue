<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../console/components/Icon.vue'
import CommunityAvatar from '../console/components/CommunityAvatar.vue'
import type { GroupCallPeer } from '../core/group-call-room'

const props = defineProps<{
  participant: GroupCallPeer; avatar?: string; stage?: boolean; selected?: boolean; local?: boolean;
}>()
const emit = defineEmits<{ focus: [] }>()
const video = ref<HTMLVideoElement>()
const size = ref('')
const name = computed(() => props.local ? props.participant.name + '（你）' : props.participant.name)
const kind = computed(() => props.participant.sharing ? '共享屏幕' : '摄像头')
const quality = computed(() => ({ excellent: '网络良好', good: '网络稳定', poor: '网络较弱', lost: '连接中断' }[props.participant.quality || '']))
watch([video, () => props.participant.stream], ([element, stream], _, cleanup) => {
  size.value = ''
  if (!element) return
  element.srcObject = stream
  void element.play().catch(() => {})
  cleanup(() => { if (element.srcObject === stream) element.srcObject = null })
}, { flush: 'post' })

function updateSize() {
  const { videoWidth, videoHeight } = video.value || {}
  size.value = videoWidth && videoHeight ? videoWidth + ' × ' + videoHeight : ''
}
function toggleFullscreen() {
  const element = video.value?.parentElement
  if (!element) return
  const owner = element.ownerDocument
  if (owner.fullscreenElement) void owner.exitFullscreen().catch(() => emit('focus'))
  else if (element.requestFullscreen) void element.requestFullscreen().catch(() => emit('focus'))
  else emit('focus')
}
</script>

<template>
  <article class="room-member" :class="{ stage, speaking: participant.speaking, selected }" :aria-label="name">
    <div class="room-member-picture" :class="{ moving: participant.hasVideo && !selected }" @dblclick="stage ? toggleFullscreen() : participant.hasVideo && emit('focus')">
      <video v-if="participant.hasVideo && !selected" ref="video" autoplay playsinline muted
        :aria-label="name + '的画面'" @resize="updateSize" />
      <CommunityAvatar v-else :name="name" :src="avatar" />
      <span v-if="stage" class="room-member-source"><Icon :name="participant.sharing ? 'screen' : 'video'" :size="14" />{{ kind }}<small v-if="size">{{ size }}</small></span>
      <button v-if="participant.hasVideo" type="button" class="room-member-expand" :aria-label="stage ? '全屏观看' : '放大' + name + '的画面'"
        :aria-pressed="stage ? undefined : !!selected" @click="stage ? toggleFullscreen() : emit('focus')">
        <Icon name="expand" :size="16" aria-hidden="true" />
      </button>
    </div>
    <footer>
      <strong :title="name">{{ name }}</strong>
      <span v-if="participant.speaking" class="room-speaking">正在说话</span>
      <span v-else-if="!stage && participant.hasVideo" class="room-media-label">{{ participant.sharing ? '共享中' : '视频' }}</span>
      <span class="room-member-mic" :class="{ muted: !participant.microphone }"
        :title="participant.microphone ? '麦克风开启' : '麦克风关闭'" :aria-label="participant.microphone ? '麦克风开启' : '麦克风关闭'">
        <Icon name="mic" :size="14" aria-hidden="true" />
      </span>
      <span v-if="quality" class="room-quality" :class="participant.quality" :title="quality" :aria-label="quality"></span>
    </footer>
  </article>
</template>

<style scoped>
.room-member { display:grid; grid-template-rows:minmax(0,1fr) auto; min-width:0; min-height:0; overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--card2); color:var(--fg); transition:border-color 150ms ease-out; }
.room-member.selected,.room-member.speaking { border-color:var(--acc); }
.room-member-picture { position:relative; display:grid; place-items:center; min-height:74px; isolation:isolate; }
.room-member-picture.moving { background:#111218; overflow:hidden; }
.room-member-picture video { display:block; width:100%; height:100%; min-height:0; object-fit:contain; }
.room-member-picture:fullscreen { background:#090a0e; }
.room-member-picture:fullscreen video { width:100%; height:100%; }
.room-member.stage .room-member-picture { min-height:0; }
.room-member-expand,.room-member-source { position:absolute; z-index:1; top:8px; display:inline-flex; align-items:center; gap:5px; color:#fff; background:#171820e8; border:1px solid #ffffff34; border-radius:8px; }
.room-member-expand { right:8px; justify-content:center; width:32px; height:32px; padding:0; }
.room-member-expand:hover { background:#353746; }
.room-member-source { left:8px; padding:5px 7px; font-size:11px; pointer-events:none; }
.room-member-source small { color:#dedee9; margin-left:3px; }
.room-member footer { min-width:0; display:flex; align-items:center; gap:6px; padding:6px 8px; font-size:11px; }
.room-member.stage footer { padding:8px 10px; font-size:12px; }
.room-member footer strong { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.room-speaking,.room-media-label { color:var(--fg2); white-space:nowrap; }
.room-member-mic { display:grid; place-items:center; position:relative; color:var(--acc); }
.room-member-mic.muted { color:var(--fg2); }
.room-member-mic.muted::after { content:""; position:absolute; width:15px; height:1px; background:currentColor; transform:rotate(-45deg); box-shadow:0 1px var(--card2); }
.room-quality { width:6px; height:6px; border-radius:50%; background:#39a879; }
.room-quality.poor { background:#d58a2e; }.room-quality.lost { background:#dd5361; }.room-quality.unknown { background:var(--fg2); }
@media (prefers-reduced-motion:reduce) { .room-member { transition:none; } }
</style>
