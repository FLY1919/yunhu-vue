<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { routeMediaOutput } from '../core/media-devices'

const props = defineProps<{ stream: MediaStream; speaker: string }>()
const element = ref<HTMLAudioElement>()
const blocked = ref(false)
const tracks = computed(() => props.stream.getAudioTracks())
async function play() {
  const media = element.value, stream = media?.srcObject
  if (!media || !stream) return
  try { await media.play(); if (media.srcObject === stream) blocked.value = false }
  catch { if (media.srcObject === stream) blocked.value = true }
}
watch([element, tracks], ([media, audio]) => {
  if (!media) return
  const current = media.srcObject as MediaStream | null
  if (current?.getAudioTracks().length === audio.length && audio.every(track => current.getTrackById(track.id) === track)) return
  blocked.value = false
  media.srcObject = audio.length ? new MediaStream(audio) : null
  if (!audio.length) return
  void routeMediaOutput(media, props.speaker).catch(() => {})
  void play()
}, { flush: 'post' })
onBeforeUnmount(() => { if (element.value) element.value.srcObject = null })
watch(() => props.speaker, speaker => {
  if (element.value) void routeMediaOutput(element.value, speaker).catch(() => {})
})
</script>
<template>
  <audio ref="element" autoplay></audio>
  <button v-if="blocked" type="button" class="ghost small" @click="play">播放通话声音</button>
</template>
