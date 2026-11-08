<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from '../console/components/Icon.vue'
const props = defineProps<{ busy?: boolean; error?: string; hasDraft?: boolean; management?: boolean }>()
const emit = defineEmits<{ submit: [value: { instruction: string; useDraft: boolean }]; close: [] }>()
const instruction = ref(''), useDraft = ref(true), box = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>()
const presets = computed(() => props.management ? ['检查管理权限', '总结群内情况', '按群规提出处理建议'] : ['简短一点', '更自然些', '正式一点', '委婉拒绝', '总结重点', '翻译成英文'])
const previous = document.activeElement as HTMLElement | null
onMounted(() => input.value?.focus())
onBeforeUnmount(() => previous?.isConnected && previous.focus())
function add(value: string) { instruction.value = [instruction.value.trim(), value].filter(Boolean).join('；'); input.value?.focus() }
function trap(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const items = Array.from(box.value?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled)') || [])
  const first = items[0], last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
}
</script>
<template>
  <Teleport to="body">
    <div class="ai-command-mask" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')" @keydown="trap">
      <form ref="box" class="ai-command-dialog" role="dialog" aria-modal="true" aria-label="AI 快捷指令" @submit.prevent="!busy && instruction.trim() && emit('submit', { instruction: instruction.trim(), useDraft })">
        <header><div><strong>给 AI 一条指令</strong><p>{{ management ? '输入明确目标 ID 和操作，按 Bot 审核设置确认与执行。' : '结合当前会话生成回复，仅本次生效。' }}</p></div><button type="button" class="ghost" aria-label="关闭快捷指令" @click="emit('close')"><Icon name="close" :size="18" /></button></header>
        <div class="ai-command-presets"><button v-for="preset in presets" :key="preset" type="button" :disabled="busy" @click="add(preset)">{{ preset }}</button></div>
        <textarea ref="input" v-model="instruction" aria-label="给 AI 的本次指令" placeholder="例如：帮我委婉拒绝，控制在两句话以内。" rows="4" maxlength="2000" :disabled="busy" @keydown.ctrl.enter.stop.prevent="!busy && instruction.trim() && emit('submit', { instruction: instruction.trim(), useDraft })"></textarea>
        <label v-if="hasDraft" class="ai-command-check"><input v-model="useDraft" type="checkbox" :disabled="busy" /> 在当前 AI 草稿上修改</label>
        <p v-if="error" class="ai-command-error" role="alert">{{ error }}</p>
        <p v-if="busy" class="ai-command-wait" role="status">AI 正在按指令生成回复…</p>
        <footer><span>Ctrl + Enter 生成</span><button type="button" class="ghost" @click="emit('close')">关闭</button><button type="submit" :disabled="busy || !instruction.trim()">{{ busy ? '生成中…' : '按指令生成' }}</button></footer>
      </form>
    </div>
  </Teleport>
</template>
<style scoped>
.ai-command-mask{position:fixed;inset:0;z-index:120;background:#0006;backdrop-filter:blur(4px);display:grid;place-items:center;padding:18px;animation:command-fade .16s ease}
.ai-command-dialog{box-sizing:border-box;width:min(460px,100%);max-height:calc(100dvh - 36px);overflow:auto;padding:20px;border:1px solid var(--line);border-radius:20px;background:var(--card);color:var(--fg);box-shadow:0 24px 80px #0004;display:flex;flex-direction:column;gap:14px;animation:command-appear .2s ease}
header,footer{display:flex;align-items:center;gap:10px}header{justify-content:space-between}header strong{font-size:16px}header p{font-size:12px;color:var(--fg2);margin:6px 0 0}header button{padding:7px}
.ai-command-presets{display:flex;flex-wrap:wrap;gap:7px}.ai-command-presets button{font-size:12px;border-radius:20px;padding:6px 10px;background:var(--card2);color:var(--fg);border:1px solid var(--line)}
textarea{box-sizing:border-box;width:100%;min-height:112px;resize:vertical;background:var(--card2);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;font-size:13px;line-height:1.7}textarea:focus{outline:2px solid var(--acc);outline-offset:2px}
.ai-command-check{display:flex;align-items:center;gap:8px;font-size:12px}.ai-command-error{color:var(--danger,#d85865);font-size:12px;margin:0;overflow-wrap:anywhere}.ai-command-wait{font-size:12px;color:var(--fg2);margin:0}footer{justify-content:flex-end}footer span{margin-right:auto;color:var(--fg2);font-size:11px}footer button{font-size:12px;white-space:nowrap}
@keyframes command-fade{from{opacity:0}to{opacity:1}}@keyframes command-appear{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.ai-command-mask,.ai-command-dialog{animation:none}}
</style>
