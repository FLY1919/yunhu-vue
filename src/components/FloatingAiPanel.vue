<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Icon from '../console/components/Icon.vue'
import AiInstructionDialog from './AiInstructionDialog.vue'
import { PANEL_COLORS, newPanelId } from '../core/ai-panel'

const props = defineProps<{ sessionId: string }>()
const view = new URLSearchParams(location.search).get('ai-view') || ''
const bus = new BroadcastChannel('yh-ai-panel-' + props.sessionId)
const state = reactive<any>({ available: false, active: false, status: '正在连接主窗口…', draft: '', channel: null, revision: -1, key: '' })
const instruction = ref(''), error = ref(''), pending = ref(''), commandOpen = ref(false), pinned = ref(false)
const messages = ref<{ role: 'user' | 'assistant'; text: string }[]>([])
const scroll = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>()
let lastSeen = Date.now(), lastDraft = '', lastRevision = -1
const active = computed(() => state.active || !!pending.value)
const native = !!(window as any).__TAURI_INTERNALS__
const invoke = (action: string) => (window as any).__TAURI__.core.invoke('ai_panel_action', { action })
function command(action: string, extra: any = {}) {
  const id = newPanelId()
  bus.postMessage({ type: 'command', id, action, view, key: state.key, revision: state.revision, ...extra })
  return id
}
function generate(value?: { instruction: string; useDraft: boolean }) {
  if (!state.available || state.useAI === false || active.value) return
  const text = (value?.instruction ?? instruction.value).trim()
  error.value = ''
  pending.value = command('generate', { instruction: text, useDraft: value?.useDraft ?? !!state.draft })
  messages.value.push({ role: 'user', text: text || '根据当前会话生成回复' }); scrollBottom()
}
async function windowAction(action: string) {
  if (action === 'dock') { command('dock'); return }
  try {
    if (native) await invoke(action)
    else if (action === 'close') { command('dock'); window.close() }
    if (action === 'pin' && native) pinned.value = !pinned.value
  } catch (e: any) { error.value = e?.message || '窗口操作失败' }
}
function drag(e: PointerEvent) { if (e.button === 0 && native && !(e.target as HTMLElement).closest('button')) void windowAction('drag') }
function scrollBottom() { void nextTick(() => { if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight }) }
bus.onmessage = ({ data }) => {
  if (data?.view !== view) return
  if (data?.type === 'docked') { window.close(); return }
  if (data?.type === 'snapshot') {
    lastSeen = Date.now()
    if (lastRevision !== data.revision || !data.available) {
      messages.value = []; instruction.value = ''; error.value = ''; pending.value = ''; lastDraft = ''; commandOpen.value = false
      lastRevision = data.revision
    }
    Object.assign(state, data)
    document.documentElement.dataset.theme = data.theme
    for (const key of PANEL_COLORS) if (typeof data.colors?.[key] === 'string') document.documentElement.style.setProperty(key, data.colors[key])
    if (data.available && data.draft && data.draft !== lastDraft && !pending.value) {
      lastDraft = data.draft
      messages.value.push({ role: 'assistant', text: data.draft })
      messages.value = messages.value.slice(-30); scrollBottom()
    }
  } else if (data?.type === 'result') {
    if (data.id === pending.value) {
      pending.value = ''
      if (data.error) error.value = data.error
      else {
        if (typeof data.draft === 'string' && data.draft) { lastDraft = data.draft; messages.value.push({ role: 'assistant', text: data.draft }); messages.value = messages.value.slice(-30); scrollBottom() }
        instruction.value = ''; commandOpen.value = false
      }
    } else if (data.error) error.value = data.error
  }
}
function disconnect() { bus.postMessage({ type: 'closed', view }) }
const timer = setInterval(() => {
  bus.postMessage({ type: 'ping', view })
  if (Date.now() - lastSeen > 10000) {
    state.available = false; state.draft = ''; state.status = '主窗口未连接'; messages.value = []; pending.value = ''; instruction.value = ''; commandOpen.value = false
  }
}, 1000)
onMounted(() => { bus.postMessage({ type: 'ready', view }); input.value?.focus(); window.addEventListener('beforeunload', disconnect) })
onBeforeUnmount(() => { disconnect(); clearInterval(timer); bus.close(); window.removeEventListener('beforeunload', disconnect) })
</script>

<template>
  <main class="floating-ai">
    <header class="floating-ai-header" @pointerdown="drag">
      <div class="floating-title"><Icon name="robot" :size="17" /><span>{{ state.channel?.name || 'AI 回复' }}</span></div>
      <div class="floating-window-actions">
        <button v-if="native" :class="{ on: pinned }" title="置顶浮窗" aria-label="置顶浮窗" @click="windowAction('pin')"><Icon name="pinUp" :size="15" /></button>
        <button title="嵌回聊天框" aria-label="嵌回聊天框" @click="windowAction('dock')"><Icon name="copy" :size="15" /></button>
        <button v-if="native" title="最小化" aria-label="最小化" @click="windowAction('minimize')">−</button>
        <button title="关闭浮窗" aria-label="关闭浮窗" @click="windowAction('close')"><Icon name="close" :size="16" /></button>
      </div>
    </header>
    <label v-if="state.channel?.type === 2" class="floating-mode">工作模式 <select aria-label="AI 工作模式" :value="state.workMode" :disabled="active" @change="command('mode', { mode: ($event.target as HTMLSelectElement).value })"><option value="conversation">对话模式</option><option value="management">管理模式</option></select></label>
    <section ref="scroll" class="floating-ai-history" aria-label="AI 指令和回复">
      <div v-if="!messages.length" class="floating-ai-empty"><Icon name="robot" :size="34" /><h2>想怎么回复？</h2><p>{{ state.available ? (state.useAI === false ? '当前会话使用规则自动化，请在会话设置中配置触发方式与动作。' : '给 AI 一条指令，或直接结合当前会话生成。') : state.status }}</p><button :disabled="!state.available || state.useAI === false || active" @click="generate({ instruction: '', useDraft: false })">根据会话生成回复</button></div>
      <article v-for="(message, i) in messages" :key="i" :class="['floating-ai-message', message.role]" :aria-label="message.role === 'user' ? '你的指令' : 'AI 回复'">{{ message.text }}</article>
    </section>
    <div class="floating-ai-bottom">
      <div v-if="active" class="floating-progress" role="progressbar" aria-label="AI 回复进度"><span></span></div>
      <p class="floating-ai-status" role="status">{{ active && !state.active ? '正在处理指令…' : state.status }}</p>
      <p v-if="error" class="floating-ai-error" role="alert">{{ error }}</p>
      <button v-if="state.draft" class="floating-use" :disabled="active || !state.available" @click="command('use')">填入聊天框</button>
      <form class="floating-ai-input" @submit.prevent="generate()">
        <textarea ref="input" v-model="instruction" aria-label="给 AI 发出指令" placeholder="给 AI 发出指令…" rows="2" maxlength="2000" :disabled="!state.available || state.useAI === false || active" @keydown.enter.exact.stop.prevent="!$event.isComposing && generate()"></textarea>
        <div class="floating-input-actions"><button type="button" class="ghost" title="快捷指令" aria-label="快捷指令" :disabled="!state.available || state.useAI === false || active" @click="error = ''; commandOpen = true"><Icon name="plus" :size="18" /></button><span>{{ state.workMode === 'management' ? '操作按审核设置执行' : '仅生成草稿' }}</span><button type="submit" class="floating-send" aria-label="按指令生成" :disabled="!state.available || state.useAI === false || active || !instruction.trim()">↑</button></div>
      </form>
    </div>
    <AiInstructionDialog :management="state.workMode === 'management'" v-if="commandOpen" :busy="!!pending" :error="error" :has-draft="!!state.draft" @submit="generate" @close="commandOpen = false" />
  </main>
</template>

<style scoped>
.floating-mode { display:flex; align-items:center; gap:8px; padding:8px 15px; font-size:12px; }.floating-mode select { background:var(--card2); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:6px; }
.floating-ai{height:100dvh;display:flex;flex-direction:column;background:var(--card);color:var(--fg);overflow:hidden;border:1px solid var(--line);box-sizing:border-box;border-radius:12px}
.floating-ai-header{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 15px;gap:10px;flex-shrink:0;cursor:grab;user-select:none}.floating-title{display:flex;align-items:center;gap:9px;min-width:0;color:var(--fg2);font-size:13px}.floating-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.floating-window-actions{display:flex;gap:2px}.floating-window-actions button{display:grid;place-items:center;background:transparent;border:0;color:var(--fg2);width:30px;height:30px;padding:4px;border-radius:8px;font-size:18px}.floating-window-actions button:hover,.floating-window-actions button.on{background:var(--acc-soft);color:var(--acc)}
.floating-ai-history{flex:1;min-height:0;overflow:auto;padding:18px 18px 10px;display:flex;flex-direction:column;gap:18px}.floating-ai-empty{margin:auto;text-align:center;color:var(--fg2);font-size:13px;max-width:280px;line-height:1.7}.floating-ai-empty h2{font-size:19px;color:var(--fg);margin:14px 0 4px}.floating-ai-empty button{font-size:12px;margin-top:12px}.floating-ai-message{font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.floating-ai-message.user{align-self:flex-end;max-width:85%;padding:10px 14px;border-radius:18px;background:var(--card2)}.floating-ai-message.assistant{padding:0 2px}
.floating-ai-bottom{flex-shrink:0;padding:0 14px 14px}.floating-ai-status{font-size:11px;color:var(--fg2);margin:8px 3px;overflow-wrap:anywhere}.floating-ai-error{font-size:12px;color:var(--danger,#df7777);margin:8px 0;overflow-wrap:anywhere}.floating-use{display:block;margin:8px 0 10px auto;font-size:12px;background:var(--acc-soft);color:var(--acc);border:1px solid var(--line)}
.floating-ai-input{border:1px solid var(--line);border-radius:22px;padding:10px;background:var(--card2)}.floating-ai-input textarea{width:100%;box-sizing:border-box;border:0;resize:none;max-height:160px;min-height:42px;background:transparent;color:var(--fg);font:inherit;font-size:13px;line-height:1.6;padding:3px 6px;outline:none}.floating-input-actions{display:flex;align-items:center;gap:8px}.floating-input-actions .ghost{display:grid;place-items:center;padding:5px;border:0}.floating-input-actions span{font-size:11px;color:var(--fg2);margin-right:auto}.floating-send{width:32px;height:32px;border-radius:50%;font-size:20px;padding:0;border:0;background:var(--fg);color:var(--card)}button:disabled{opacity:.45;cursor:default}
.floating-progress{height:3px;overflow:hidden;background:var(--acc-soft);border-radius:3px}.floating-progress span{display:block;width:35%;height:100%;background:var(--acc);animation:floating-progress 1.4s ease-in-out infinite}@keyframes floating-progress{from{transform:translateX(-100%)}to{transform:translateX(385%)}}@media(prefers-reduced-motion:reduce){.floating-progress span{animation:none}}
</style>
