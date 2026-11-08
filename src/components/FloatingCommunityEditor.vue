<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import CommunityEditor from './CommunityEditor.vue'
const props = defineProps<{ sessionId: string }>()
const bus = new BroadcastChannel('yh-community-editor-' + props.sessionId), state = ref<any>(null)
let seq = 0, lastSeen = Date.now()
function command(action: string, value: any = {}) { bus.postMessage({ type: 'command', seq: ++seq, action, ...value }) }
bus.onmessage = ({ data }) => {
  if (data?.type === 'dock') { state.value = null; window.close(); return }
  if (data?.type !== 'snapshot' || data.ack < seq) return
  lastSeen = Date.now()
  document.documentElement.dataset.theme = data.theme || 'dark'
  for (const [k, v] of Object.entries(data.colors || {})) if (k.startsWith('--') && typeof v === 'string') document.documentElement.style.setProperty(k, v)
  state.value = data.locked || !data.draft ? null : data
}
const timer = setInterval(() => { bus.postMessage({ type: 'ready' }); if (Date.now() - lastSeen > 12000) state.value = null }, 3000)
bus.postMessage({ type: 'ready' })
onBeforeUnmount(() => { clearInterval(timer); bus.close() })
</script>
<template><div class="floating-editor"><CommunityEditor v-if="state?.draft" :key="state.draft.id" :draft="state.draft" :busy="state.busy" :saving="state.saving" :error="state.error" :saved-at="state.savedAt" :uploading="state.uploading" detached @change="patch => { Object.assign(state.draft, patch); command('change', { patch }) }" @save="command('save')" @publish="command('publish')" @upload="file => command('upload', { file })" @close="command('close')" @detach="command('detach')" /><p v-else role="status">正在连接主窗口，或当前账号已锁定/退出。</p></div></template>
<style scoped>.floating-editor { height:100dvh; width:100%; background:var(--card); color:var(--fg); overflow:hidden; }.floating-editor > p { padding:25px; }</style>
