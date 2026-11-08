<script setup lang="ts">
import { computed, inject, shallowRef, watch } from 'vue'
import Icon from '../console/components/Icon.vue'
import GroupCallParticipant from './GroupCallParticipant.vue'
import type { GroupCallPeer } from '../core/group-call-room'

const props = defineProps<{
  peers: GroupCallPeer[]; room: string; phase: string; local: MediaStream; camera: boolean; microphone: boolean; sharing: boolean;
  featured: string; wide: boolean;
}>()
const emit = defineEmits<{ feature: [id: string]; fullscreen: [id: string] }>()
const self = '__local__'
const ctx = inject<any>('ctx')
const me = computed(() => ctx.auth.state.user)
const local = computed<GroupCallPeer>(() => ({
  id: self, name: me.value?.name || me.value?.nickname || '本机', stream: props.local,
  hasVideo: (props.camera || props.sharing) && props.local.getVideoTracks().some(track => track.readyState === 'live'),
  microphone: props.microphone && props.local.getAudioTracks().some(track => track.readyState === 'live'),
  sharing: props.sharing,
}))
const profiles = shallowRef(new Map<string, { name: string; avatar: string }>())
const members = computed(() => [...props.peers.map(peer => {
  const profile = profiles.value.get(peer.id)
  return profile?.name && peer.name === peer.id ? { ...peer, name: profile.name } : peer
}), local.value])
const stage = computed(() => members.value.find(peer => peer.id === props.featured && props.featured && peer.hasVideo)
  || members.value.find(peer => peer.sharing && peer.hasVideo)
  || members.value.find(peer => peer.hasVideo))
const profileIds = computed(() => props.peers.map(peer => peer.id).filter(id => /^\d{1,20}$/.test(id)).sort().join(','))
watch(() => props.room, (room, _, cleanup) => {
  profiles.value = new Map()
  if (!room || !ctx.api.getUser) return
  const controller = new AbortController()
  const pending = new Set<string>()
  const attempted = new Set<string>()
  let running = 0
  function drain() {
    while (running < 4 && pending.size && !controller.signal.aborted) {
      const id = pending.values().next().value!
      pending.delete(id)
      attempted.add(id)
      running++
      void ctx.api.getUser(id, { timeout: 6000, signal: controller.signal }).then(profile => {
        if (controller.signal.aborted || !pendingIds.has(id)) return
        profiles.value = new Map(profiles.value).set(id, profile)
      }).catch(() => {}).finally(() => { running--; drain() })
    }
  }
  let pendingIds = new Set<string>()
  const stop = watch(profileIds, ids => {
    pendingIds = new Set(ids ? ids.split(',') : [])
    for (const id of pending) if (!pendingIds.has(id)) pending.delete(id)
    const retained = new Map([...profiles.value].filter(([id]) => pendingIds.has(id)))
    if (retained.size !== profiles.value.size) profiles.value = retained
    for (const id of attempted) if (!pendingIds.has(id)) attempted.delete(id)
    for (const id of pendingIds) if (!attempted.has(id)) pending.add(id)
    drain()
  }, { immediate: true })
  cleanup(() => { stop(); controller.abort(); pending.clear() })
}, { immediate: true })
const avatar = (id: string) => id === self ? me.value?.avatar : profiles.value.get(id)?.avatar
</script>

<template>
  <div class="room-layout" :class="{ wide, 'has-stage': !!stage }" aria-label="语音房画面与成员">
    <GroupCallParticipant v-if="stage" :key="stage.id" class="room-stage" :participant="stage"
      :avatar="avatar(stage.id)" stage :local="stage.id === self" @focus="emit('fullscreen', stage.id)" />
    <section class="room-roster" aria-label="房间成员">
      <header class="roster-header">
        <Icon name="user" :size="16" aria-hidden="true" />
        <strong>房间成员</strong><span>{{ members.length }} 人</span>
        <button v-if="featured" class="ghost small" type="button" @click="emit('feature', '')">取消聚焦</button>
      </header>
      <p v-if="phase === 'connecting' && !peers.length" class="room-empty" role="status">正在同步房间成员…</p>
      <p v-else-if="phase === 'connected' && !peers.length" class="room-empty">等待其他群成员加入</p>
      <div class="roster-list">
        <GroupCallParticipant v-for="participant in members" :key="participant.id" :participant="participant"
          :avatar="avatar(participant.id)" :local="participant.id === self" :selected="stage?.id === participant.id"
          @focus="emit('feature', participant.id)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.room-layout { display:grid; min-width:0; min-height:0; gap:12px; }
.room-stage { min-height:0; aspect-ratio:16/10; }
.room-roster { display:flex; flex-direction:column; gap:8px; min-width:0; min-height:0; overflow:hidden; }
.roster-header { display:flex; align-items:center; gap:6px; min-height:27px; font-size:12px; color:var(--fg); }
.roster-header span,.room-empty { color:var(--fg2); }
.roster-header button { margin-left:auto; }
.room-empty { margin:0; font-size:12px; }
.roster-list { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(112px, 31%); gap:7px; overflow:auto; padding:0 0 4px; }
.roster-list :deep(.room-member-picture) { aspect-ratio:16/10; }
.room-layout.wide { overflow:auto; }
.room-layout.wide .room-stage { aspect-ratio:auto; min-height:min(250px,42dvh); }
.room-layout.wide:not(.has-stage) .roster-list { grid-auto-flow:row; grid-template-columns:repeat(auto-fill,minmax(128px,1fr)); }
@container (min-width:690px) {
  .room-layout.wide.has-stage { grid-template-columns:minmax(0,1fr) minmax(160px,22%); }
  .room-layout.wide.has-stage .roster-list { grid-auto-flow:row; grid-auto-columns:auto; grid-template-columns:minmax(0,1fr); }
  .room-layout.wide.has-stage .room-stage { height:100%; }
}
</style>
