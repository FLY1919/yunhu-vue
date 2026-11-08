<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import ThemedSelect from './ThemedSelect.vue'
import { codeLanguageOptions, highlightCode } from '../core/editor/render'

const props = defineProps(nodeViewProps)
const language = computed(() => String(props.node.attrs.language || 'text'))
const code = computed(() => props.node.textContent)
const editing = ref(false)
const editable = ref(props.editor.isEditable)
const paint = ref('')
const copyLabel = ref('复制')
let timer: ReturnType<typeof setTimeout>
let revision = 0

function updateSelection() {
  editable.value = props.editor.isEditable
  const start = props.getPos()
  const { from, to } = props.editor.state.selection
  editing.value = props.editor.isFocused && typeof start === 'number'
    && to > start && from < start + props.node.nodeSize
}
function paintCode() {
  clearTimeout(timer)
  const current = ++revision
  if (editing.value || !code.value) { paint.value = ''; return }
  timer = setTimeout(async () => {
    const html = await highlightCode(code.value, language.value)
    if (current === revision) paint.value = html
  }, 150)
}
function setLanguage(value: string | number) {
  const start = props.getPos()
  const selection = props.editor.state.selection
  props.updateAttributes({ language: value === 'text' ? null : String(value) })
  if (typeof start === 'number' && (selection.from <= start || selection.to >= start + props.node.nodeSize)) {
    props.editor.commands.focus(start + 1, { scrollIntoView: false })
  } else props.editor.commands.focus(undefined, { scrollIntoView: false })
}
async function copy() {
  try { await navigator.clipboard.writeText(code.value); copyLabel.value = '已复制' }
  catch { copyLabel.value = '复制失败' }
}
watch([code, language, editing], paintCode, { immediate: true })
watch(code, () => { copyLabel.value = '复制' })
onMounted(() => {
  for (const event of ['selectionUpdate', 'focus', 'blur', 'transaction'] as const) props.editor.on(event, updateSelection)
  window.addEventListener('yh-editor-theme', paintCode)
  updateSelection()
})
onBeforeUnmount(() => {
  for (const event of ['selectionUpdate', 'focus', 'blur', 'transaction'] as const) props.editor.off(event, updateSelection)
  window.removeEventListener('yh-editor-theme', paintCode)
  clearTimeout(timer)
  revision++
})
</script>

<template>
  <NodeViewWrapper class="rich-code" :class="{ painted: paint && !editing }">
    <div class="code-actions" contenteditable="false">
      <ThemedSelect label="代码语言" :model-value="language" :options="codeLanguageOptions" :disabled="!editable"
        custom @update:model-value="setLanguage" />
      <button type="button" class="code-copy" @click="copy">{{ copyLabel }}</button>
    </div>
    <div class="code-stack">
      <pre v-show="paint && !editing" class="code-paint" contenteditable="false" aria-hidden="true"><code v-html="paint" /></pre>
      <pre class="code-input"><NodeViewContent as="code" /></pre>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.rich-code { background:var(--card2); border-radius:8px; padding:10px 14px; margin:1em 0; }
.code-actions { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; font-size:12px; }
.code-copy { border:0; border-radius:5px; padding:4px 8px; background:transparent; color:var(--fg2); }
.code-copy:hover { background:var(--acc-soft); color:var(--fg); }
.code-stack { position:relative; }
.rich-code .code-stack pre { display:block; background:transparent; border:0; padding:0; margin:0; min-height:1.7em;
  font:13px/1.7 ui-monospace,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; font-variant-ligatures:none; tab-size:4; }
.rich-code .code-stack code { display:block; min-height:inherit; font:inherit; background:transparent; padding:0; white-space:inherit; }
.code-input { position:relative; color:var(--fg); caret-color:var(--fg); }
.code-paint { position:absolute; inset:0; pointer-events:none; color:var(--fg); }
.painted .code-input { color:transparent; }
/* Pointer selection starts before ProseMirror reports focus. Keep its text visible during that handoff. */
.painted:active .code-input { color:var(--fg); }
.painted:active .code-paint { visibility:hidden; }
</style>
