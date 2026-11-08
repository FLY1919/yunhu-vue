<script setup lang="ts">
import { inject, shallowRef, watch } from 'vue'
import Icon from '../console/components/Icon.vue'
import type { GroupVoiceRoom } from '../core/yunhu-calls'

const props = defineProps<{ groupId: string }>()
const ctx = inject<any>('ctx')
const rooms = shallowRef<GroupVoiceRoom[]>([])

watch([() => props.groupId, () => ctx.auth?.state?.user?.id, () => ctx.auth?.state?.status, () => !!ctx.lock?.isLocked],
  ([groupId, account, status, locked], _, cleanup) => {
    rooms.value = []
    if (!groupId || !account || status !== 'ready' || locked) return
    const scope = new AbortController()
    let pending = false
    async function refresh() {
      if (pending || document.hidden || scope.signal.aborted) return
      pending = true
      try {
        const result = await ctx.api.groupVoiceRooms(groupId, scope.signal)
        if (!scope.signal.aborted) rooms.value = result
      } catch { /* Keep the last successful list through transient failures. */ }
      finally { pending = false }
    }
    const timer = setInterval(refresh, 15_000)
    document.addEventListener('visibilitychange', refresh)
    cleanup(() => {
      scope.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    })
    void refresh()
  }, { immediate: true })

function join(room: GroupVoiceRoom) {
  if (!rooms.value.includes(room)) return
  void ctx.calls.joinVoiceRoom(props.groupId, room)
}
</script>

<template>
  <section v-if="rooms.length" class="group-voice-rooms" aria-label="正在进行的群语音房">
    <div v-for="room in rooms" :key="room.id" class="group-voice-row">
      <span class="group-voice-icon"><Icon name="callVoice" :size="16" aria-hidden="true" /></span>
      <div class="group-voice-text">
        <strong :title="room.title">{{ room.title }}</strong>
        <small>{{ room.count }} 人在房间<span v-if="room.host"> · {{ room.host }}发起</span></small>
      </div>
      <button type="button" class="ghost small" :disabled="!!ctx.calls.state.session || !ctx.calls.ready()"
              @click="join(room)">{{ ctx.calls.state.session?.room === room.id ? '已在房间' : '加入语音房' }}</button>
    </div>
  </section>
</template>

<style scoped>
.group-voice-rooms { flex: 0 0 auto; max-height: 128px; overflow: auto; border-bottom: 1px solid var(--line); background: var(--card); }
.group-voice-row { display: flex; align-items: center; gap: 10px; padding: 7px 14px; }
.group-voice-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; border-radius: 8px; background: var(--acc-soft); color: var(--acc); }
.group-voice-text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.group-voice-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-voice-text strong { font-size: 13px; }
.group-voice-text small { color: var(--fg2); }
.group-voice-row button { flex: 0 0 auto; white-space: nowrap; }
</style>
