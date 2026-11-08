<script setup lang="ts">
import { shallowRef, ref, watch, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { previewBlocks, renderMath, highlightCode, codeLanguageOptions } from '../core/editor/render'
import { fixResourceUrls } from '../core/res'
import ThemedSelect from './ThemedSelect.vue'

const props = defineProps<{ content: string; active?: boolean; zoom?: number; fontSize?: number }>()
const emit = defineEmits(['scroll', 'edit', 'language', 'task'])
const blocks = shallowRef<ReturnType<typeof previewBlocks>>([])
const root = ref<HTMLElement>()
let timer: ReturnType<typeof setTimeout>, generation = 0, observer: MutationObserver
async function paint() {
  const seq = ++generation
  await nextTick()
  if (!root.value || props.active === false || seq !== generation) return
  for (const code of root.value.querySelectorAll<HTMLElement>('pre > code')) {
    const text = code.textContent || ''
    const language = code.dataset.language || code.className.match(/language-([^\s]+)/)?.[1] || 'text'
    void highlightCode(text, language).then(html => {
      if (seq === generation && code.isConnected) code.innerHTML = html
    })
  }
}
async function enrich() {
  await nextTick()
  if (!root.value || props.active === false) return
  fixResourceUrls(root.value)
  for (const el of root.value.querySelectorAll<HTMLImageElement>('img')) el.loading = 'lazy'
  for (const el of root.value.querySelectorAll<HTMLElement>('[data-latex]')) void renderMath(el, el.dataset.latex || '', el.dataset.display === 'true')
  for (const box of root.value.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
    box.disabled = false
    box.onchange = () => {
      const block = box.closest<HTMLElement>('[data-source-start]')!
      emit('task', { start: Number(block.dataset.sourceStart), index: [...block.querySelectorAll('input[type=checkbox]')].indexOf(box), checked: box.checked })
    }
  }
  void paint()
}
function update() {
  clearTimeout(timer)
  generation++
  if (props.active === false) return
  timer = setTimeout(() => { blocks.value = previewBlocks(props.content); void enrich() }, 180)
}
watch(() => [props.content, props.active], update, { immediate: true })
function scroll() {
  const el = root.value!
  emit('scroll', el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
}
function setScroll(ratio: number) {
  if (root.value) root.value.scrollTop = ratio * Math.max(0, root.value.scrollHeight - root.value.clientHeight)
}
async function copy(event: MouseEvent, text: string) {
  const button = event.currentTarget as HTMLButtonElement
  try { await navigator.clipboard.writeText(text); button.textContent = '已复制' }
  catch { button.textContent = '复制失败' }
}
onMounted(() => {
  observer = new MutationObserver(() => void paint())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
})
onBeforeUnmount(() => { clearTimeout(timer); generation++; observer?.disconnect() })
defineExpose({ setScroll })
</script>

<template>
  <article ref="root" class="editor-preview" aria-label="文章预览" :style="{ fontSize:((fontSize||15)*(zoom||100)/100)+'px' }" @scroll="scroll">
    <div v-for="block in blocks" :key="block.key" :data-source-start="block.start"
      @dblclick="e => { if (!(e.target as HTMLElement).closest('button,input,a')) emit('edit', block.start) }">
      <div v-if="block.code" class="preview-code">
        <div class="code-actions">
          <ThemedSelect label="代码语言" :model-value="block.code.language" :options="codeLanguageOptions" custom
            @update:model-value="emit('language', { start: block.start, language: String($event) })" />
          <button type="button" @click="copy($event, block.code.text)">复制</button>
        </div>
        <pre><code :data-language="block.code.language" v-text="block.code.text"></code></pre>
      </div>
      <div v-else v-html="block.html"></div>
    </div>
    <p v-if="!content" class="empty-preview">正文实时预览</p>
  </article>
</template>

<style scoped>
.editor-preview{flex:1;min-width:0;min-height:0;overflow:auto;padding:22px 28px 80px;color:var(--fg);background:var(--card);line-height:1.85;overflow-wrap:anywhere}
.editor-preview :deep(img){max-width:100%;height:auto;border-radius:7px}
.editor-preview :deep(pre),.preview-code{overflow:auto;background:var(--card2);padding:12px 16px;border-radius:8px;font-size:13px;white-space:pre}
.preview-code { margin:1em 0; }
.preview-code pre { margin:0;padding:0; }
.code-actions{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}
.code-actions > button:not(.themed-select){border:0;background:transparent;color:var(--fg2);padding:3px 5px;border-radius:4px}
.code-actions > button:not(.themed-select):hover{background:var(--acc-soft);color:var(--fg)}
.editor-preview :deep(table){border-collapse:collapse;display:block;overflow:auto;max-width:100%}
.editor-preview :deep(td),.editor-preview :deep(th){padding:8px 10px;border:1px solid var(--line)}
.editor-preview :deep(blockquote){border-left:3px solid var(--link,var(--fg));padding:8px 16px;margin-left:0;background:var(--card2);border-radius:0 6px 6px 0}
.editor-preview :deep(a){color:var(--link,var(--fg))}
.editor-preview :deep(.katex-display){overflow-x:auto;overflow-y:hidden}
.empty-preview{color:var(--fg2)}.editor-preview :deep(input[type=checkbox]){accent-color:var(--acc)}
</style>
