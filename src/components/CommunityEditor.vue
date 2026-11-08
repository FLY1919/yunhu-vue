<script setup lang="ts">
import ThemedSelect from './ThemedSelect.vue'
import { computed, ref, nextTick, defineAsyncComponent, watch, onBeforeUnmount, inject, shallowRef } from 'vue'
import Icon from '../console/components/Icon.vue'
import EditorToolbar from './EditorToolbar.vue'
import MarkdownSource from './MarkdownSource.vue'
import { markdownFontSizeKey, minMarkdownFontSize, maxMarkdownFontSize, parseMarkdownFontSize } from '../core/editor/font-size'
import { createTextHistory, editorStats, downloadDocument, escapeHtml, type EditAction } from '../core/editor/core'
const EditorPreview = defineAsyncComponent(() => import('./EditorPreview.vue'))
import { type CommunityDraft } from '../core/community-drafts'
const MarkdownCanvas = defineAsyncComponent(() => import('./MarkdownCanvas.vue'))
const canvas = ref<any>(), richHistory = ref({ undo: false, redo: false })
const props = defineProps<{ draft: CommunityDraft; busy?: boolean; saving?: boolean; error?: string; savedAt?: number; detached?: boolean; expanded?: boolean; uploading?: boolean }>()
const emit = defineEmits(['change', 'save', 'publish', 'close', 'detach', 'expand', 'upload'])
const source = ref<any>(), outlineOpen = ref(false), mode = ref(props.draft.contentType===1||props.draft.content.length>50000?'source':'rich'), richReady=ref(props.draft.content.length<=50000), sourceReady = ref(props.draft.content.length>50000), toolbarVisible = ref(true), documentMenu = ref(false), tableOpen = ref(false), formulaOpen = ref(false), latex = ref('a^2 + b^2 = c^2'), displayMath = ref(false), lineNumbers = ref(false), zoom = ref(100), preview = ref<any>(), split = ref(50), workspace = ref<HTMLElement>(), ctx = inject<any>('ctx')
const markdownFontSize = ref(parseMarkdownFontSize(localStorage.getItem(markdownFontSizeKey)))
function setFontSize(event: Event) {
  const field = event.target as HTMLInputElement
  if (field.value && field.validity.valid) {
    markdownFontSize.value = parseMarkdownFontSize(field.value)
    localStorage.setItem(markdownFontSizeKey, String(markdownFontSize.value))
  }
  field.value = String(markdownFontSize.value)
}
function syncFontSize(event: StorageEvent) {
  if (event.key === markdownFontSizeKey) markdownFontSize.value = parseMarkdownFontSize(event.newValue)
}
window.addEventListener('storage', syncFontSize)
onBeforeUnmount(() => window.removeEventListener('storage', syncFontSize))
const textHistory = createTextHistory(props.draft.content), historyVersion = ref(0), stats = shallowRef(editorStats(props.draft.content))
const undoState = computed(()=>{historyVersion.value;return {undo:textHistory.canUndo,redo:textHistory.canRedo}})
let statsTimer: ReturnType<typeof setTimeout>, stopSplit:(()=>void)|undefined, syncFrame=0, scrolling = ''
watch(()=>props.draft.content,value=>{textHistory.record(value);historyVersion.value++;clearTimeout(statsTimer);statsTimer=setTimeout(()=>{stats.value=editorStats(value)},180)})
watch(mode,value=>{if(value!=='rich')sourceReady.value=true})
onBeforeUnmount(()=>{clearTimeout(statsTimer);stopSplit?.();cancelAnimationFrame(syncFrame)})
const findOpen = ref(false), find = ref(''), replacement = ref(''), linkOpen = ref(false), linkUrl = ref('https://'), linkLabel = ref(''), linkImage = ref(false)
const headings = computed(() => props.draft.content.split('\n').map((line, index) => ({ line, index, match: /^(#{1,6})\s+(.+)/.exec(line) })).filter(x => x.match).slice(0, 100))
const matches = computed(() => find.value ? props.draft.content.split(find.value).length - 1 : 0)
let selected = { start: 0, end: 0 }
function remember() { if (source.value && mode.value !== 'rich') selected = source.value.selection() }
function change(content: string, record = true) {
  if(content.length>200000){ctx?.ui?.toast?.('正文最多 20 万字，原内容已保留','error');return}
  if(content.length>50000&&mode.value==='rich'){mode.value='source';sourceReady.value=true}
  if (record) textHistory.record(content)
  historyVersion.value++
  emit('change', { content })
}
function edit(before: string, _after = '', _placeholder = '文字') { if (!props.busy) canvas.value?.format(before) }
function action(id: EditAction) {
  if (props.busy) return
  textHistory.record(props.draft.content,false)
  if (id === 'math' || id === 'mathblock') { displayMath.value = id==='mathblock'; formulaOpen.value=true; return }
  if (id==='link' || id==='image') { openLink(id==='image'); return }
  if (mode.value!=='rich' || props.draft.contentType===1) { source.value?.action(id); return }
  const map:Record<string,string>={bold:'**',italic:'*',strike:'~~',underline:'<u>',highlight:'<mark>',quote:'\n> ',bullet:'\n- ',ordered:'\n1. ',task:'\n- [ ] ',code:'`',codeblock:'\n```text\n',table:'\n| 列一',rule:'\n---\n'}
  if(id==='table') {tableOpen.value=true;if(canvas.value?.isTable?.())return}
  if(id==='footnote') {void setMode('source').then(()=>source.value?.action('footnote'));return}
  edit(/^h[1-6]$/.test(id)?'#'.repeat(Number(id.slice(1)))+' ':map[id]||'')
}
function undo(redo = false) { if(props.busy)return;const content=redo?textHistory.redo():textHistory.undo();historyVersion.value++;change(content,false) }
async function setMode(value:string){const previous=mode.value;const at=previous==='rich'?canvas.value?.offset?.()||0:source.value?.selection?.().start||0;mode.value=value;if(value!=='rich')sourceReady.value=true;else richReady.value=true;await nextTick();if(previous!==value){if(value==='rich')canvas.value?.selectOffset?.(at);else source.value?.select(at)}}
function sync(side:string,ratio:number){if(mode.value!=='split'||scrolling&&scrolling!==side)return;scrolling=side;if(side==='source')preview.value?.setScroll(ratio);else source.value?.setScroll(ratio);cancelAnimationFrame(syncFrame);syncFrame=requestAnimationFrame(()=>{scrolling=''})}
function resizeSplit(e:PointerEvent){if(e.button!==0)return;stopSplit?.();const area=workspace.value!,el=e.currentTarget as HTMLElement;el.setPointerCapture(e.pointerId);const move=(ev:PointerEvent)=>{const rect=area.getBoundingClientRect();split.value=Math.max(25,Math.min(75,(ev.clientX-rect.left)/rect.width*100))};const stop=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',stop);el.removeEventListener('pointercancel',stop);if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);stopSplit=undefined};stopSplit=stop;el.addEventListener('pointermove',move);el.addEventListener('pointerup',stop);el.addEventListener('pointercancel',stop)}
function insertFormula(){if(mode.value==='rich')canvas.value?.formula(latex.value,displayMath.value);else {remember();const marker=displayMath.value?'$$':'$';const value=props.draft.content.slice(0,selected.start)+(displayMath.value?'\n':'')+marker+(displayMath.value?'\n':'')+latex.value+(displayMath.value?'\n':'')+marker+props.draft.content.slice(selected.end);change(value)}formulaOpen.value=false}
function codeLanguage(value:{start:number;language:string}){const before=props.draft.content.slice(0,value.start),after=props.draft.content.slice(value.start).replace(/^([ \t]{0,3}(?:`{3,}|~{3,}))[^\n]*/,(_m,fence)=>fence+(value.language==='text'?'':value.language));change(before+after)}
function task(value:{start:number;index:number;checked:boolean}){const before=props.draft.content.slice(0,value.start);let index=0;change(before+props.draft.content.slice(value.start).replace(/([-*+] \[)[ xX](\])/g,(m,a,b)=>index++===value.index?a+(value.checked?'x':' ')+b:m))}
async function exportHtml(print=false){
  const {renderExportBody}=await import('../core/editor/render');const rendered=await renderExportBody(props.draft.content)
  const html='<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(props.draft.title)+'</title><style>body{font:16px/1.8 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 30px;color:#202124;background:white}img{max-width:100%}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}blockquote{border-left:3px solid #666;padding-left:16px}@media print{body{margin:0;padding:0}pre,table,figure{break-inside:avoid}}</style></head><body><h1>'+escapeHtml(props.draft.title)+'</h1>'+rendered+'</body></html>'
  if(!print){downloadDocument(props.draft.title,html,'text/html;charset=utf-8','html');return}
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:900px;height:1000px;border:0';frame.title='导出 PDF';frame.srcdoc=html;frame.onload=()=>{frame.contentWindow?.focus();frame.contentWindow?.print();setTimeout(()=>frame.remove(),1000)};document.body.append(frame);documentMenu.value=false
}
async function copyRich(){try{const {renderExportBody}=await import('../core/editor/render');const html=await renderExportBody(props.draft.content);if(typeof ClipboardItem==='function')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([props.draft.content],{type:'text/plain'})})]);else await navigator.clipboard.writeText(props.draft.content);ctx?.ui?.toast?.('已复制文章','success')}catch{ctx?.ui?.toast?.('剪贴板暂不可用','error')}}
function key(e: KeyboardEvent) {
  if (e.isComposing) return
  // Preserve normal selection, search and undo in title/link/search input fields.
  const target = e.target as HTMLElement
  const inBody = !!target.closest('.editor-workspace') && !target.closest('input, button, [contenteditable="false"]')
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 's') { e.preventDefault(); if (!props.busy) emit('save'); return }
  if (k === 'enter') { e.preventDefault(); if (!props.busy && !props.uploading) emit('publish'); return }
  if (!inBody) return
  remember()
  if (['b', 'i', 'f', 'h', 'z', 'y', 'k'].includes(k)) e.preventDefault()
  if (k === 'b') {e.stopImmediatePropagation();action('bold')}
  if (k === 'i') {e.stopImmediatePropagation();action('italic')}
  if (k === 'f' || k === 'h') findOpen.value = !findOpen.value
  if (k === 'z') {e.stopImmediatePropagation();undo(e.shiftKey)}
  if (k === 'y') {e.stopImmediatePropagation();undo(true)}
  if (k === 'k' && props.draft.contentType !== 1) openLink(false)
}
function openLink(image: boolean) {remember();linkImage.value = image;linkLabel.value = mode.value==='rich'?canvas.value?.selectionText()||'':props.draft.content.slice(selected.start,selected.end);linkOpen.value=true}
function insertLink() {
  if (props.busy) return
  try {
    const url = new URL(linkUrl.value)
    if (!['https:', 'http:'].includes(url.protocol)) return
    const label = linkLabel.value.replace(/[\[\]\n]/g, '') || (linkImage.value ? '图片' : '链接')
    if(mode.value==='rich')canvas.value?.link(url.href,label,linkImage.value);else change(props.draft.content.slice(0,selected.start)+(linkImage.value?'!':'')+'['+label+']('+url.href.replace(/\)/g,'%29')+')'+props.draft.content.slice(selected.end));linkOpen.value=false
  } catch { /* Invalid URL remains editable. */ }
}
function replaceAll() { if (props.busy) return; if (mode.value==='rich' && props.draft.contentType !== 1) canvas.value?.replaceAll(find.value, replacement.value); else if (find.value) change(props.draft.content.split(find.value).join(replacement.value)) }
function selectText(offset: number, length = 0) { source.value?.focus(); source.value?.select(offset, offset + length); remember() }
function findNext() {
  if (!find.value) return
  if (mode.value==='rich' && props.draft.contentType !== 1) { canvas.value?.findNext(find.value); return }
  remember();const from = selected.end || 0
  let index = props.draft.content.indexOf(find.value, from)
  if (index < 0) index = props.draft.content.indexOf(find.value)
  if (index >= 0) selectText(index, find.value.length)
}
function gotoLine(line: number) {
  if (mode.value==='rich' && props.draft.contentType !== 1) { canvas.value?.gotoHeading(headings.value.findIndex(h => h.index === line)); return }
  selectText(props.draft.content.split('\n').slice(0, line).reduce((sum, value) => sum + value.length + 1, 0))
  if (source.value) source.value.scrollTop = line * 26
}
function exportMd() {
  const blob = new Blob([props.draft.title + '\n\n' + props.draft.content], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = (props.draft.title || '未命名文章').replace(/[\\/:*?"<>|]/g, '_') + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importMd(ev: Event) {
  const input = ev.target as HTMLInputElement, file = input.files?.[0]
  if (file && file.size <= 800000 && !props.busy) change(await file.text())
  input.value = ''
}
function upload(ev: Event) { const el = ev.target as HTMLInputElement; if (el.files?.[0]) emit('upload', el.files[0]); el.value = '' }
</script>

<template>
  <section class="community-editor" aria-label="文章编辑器" @keydown.capture="key">
    <header class="editor-top">
      <div class="editor-context"><Icon name="pencil" :size="17" /><span>{{ draft.postId ? '编辑文章' : '撰写文章' }}</span><span class="editor-board" :title="draft.boardName">{{ draft.boardName || '未关联板块' }}</span></div>
      <div class="editor-buttons">
        <button type="button" title="文档设置与导出" aria-label="文档菜单" @click="documentMenu=!documentMenu"><Icon name="more" :size="17"/></button><button type="button" title="导出 Markdown 文件" aria-label="导出 Markdown" @click="exportMd"><Icon name="download" :size="16" /><span class="file-action-text">导出</span></button>
        <button v-if="!detached" type="button" :title="expanded ? '恢复窗口内编辑器大小' : '填满当前软件窗口'" :aria-label="expanded ? '还原编辑器大小' : '窗口内展开'" :aria-pressed="!!expanded" @click="emit('expand')"><Icon :name="expanded ? 'collapse' : 'expand'" :size="16" /><span>{{ expanded ? '还原大小' : '窗口内展开' }}</span></button>
        <button type="button" :title="detached ? '移回主窗口继续编辑' : '在独立窗口继续编辑，可移至软件外'" :aria-label="detached ? '返回主窗口编辑' : '在独立窗口编辑'" :disabled="busy" @click="emit('detach')"><Icon name="windowOut" :size="16" /><span>{{ detached ? '返回主窗口' : '独立窗口' }}</span></button>
        <button type="button" class="editor-close" title="关闭编辑器" aria-label="关闭编辑器" :disabled="busy||saving" @click="emit('close')"><Icon name="close" :size="18" /></button>
      </div>
    </header>
    <input class="editor-title" :value="draft.title" aria-label="文章标题" placeholder="文章标题" maxlength="200" :disabled="busy" @input="emit('change', { title: ($event.target as HTMLInputElement).value })" />
    <Transition name="editor-bar"><div v-if="documentMenu" class="editor-document-menu" aria-label="文档设置">
      <label><input type="checkbox" v-model="toolbarVisible"/>显示工具栏</label><label><input type="checkbox" v-model="lineNumbers"/>源文行号</label><button @click="exportHtml()">导出 HTML</button><button @click="exportHtml(true)">导出 PDF</button><button @click="copyRich">复制为富文本</button><button v-if="ctx?.theme" @click="ctx.ui?.toggleTheme?.()">切换主题</button>
    </div></Transition>
    <div class="editor-mode-row"><nav aria-label="编辑模式"><button v-for="item in [{id:'rich',label:'实时写作'},{id:'split',label:'双栏'},{id:'source',label:'源文'}]" :key="item.id" :aria-pressed="mode===item.id" @click="setMode(item.id)">{{item.label}}</button></nav><button aria-label="折叠格式工具栏" :aria-expanded="toolbarVisible" @click="toolbarVisible=!toolbarVisible"><Icon name="collapse" :size="15"/></button><button aria-label="文章大纲" :aria-pressed="outlineOpen" @click="outlineOpen=!outlineOpen"><Icon name="menu" :size="16"/>大纲</button><label class="editor-file">导入 .md<input type="file" accept=".md,.txt,.markdown" hidden aria-label="导入 Markdown" :disabled="busy" @change="importMd"/></label><label class="editor-file"><Icon name="image" :size="15"/>图片<input type="file" accept="image/*" hidden aria-label="上传文章图片" :disabled="busy||uploading" @change="upload"/></label><button aria-label="查找替换" title="查找替换 Ctrl+F" @click="findOpen=!findOpen"><Icon name="search" :size="16"/></button></div>
    <Transition name="editor-bar"><div v-show="toolbarVisible" class="editor-toolbar"><EditorToolbar :disabled="busy" :undo="undoState.undo" :redo="undoState.redo" @action="action" @undo="undo()" @redo="undo(true)"/></div></Transition>
    <Transition name="editor-bar"><form v-if="formulaOpen" class="editor-find" @submit.prevent="insertFormula"><input v-model="latex" aria-label="数学公式" placeholder="LaTeX 公式"/><label><input type="checkbox" v-model="displayMath"/>独立公式</label><button type="submit">插入公式</button><button type="button" @click="formulaOpen=false">取消</button></form></Transition>
    <Transition name="editor-bar"><div v-if="tableOpen&&mode==='rich'" class="table-tools" aria-label="表格编辑"><button v-for="item in [{id:'addRowBefore',label:'上方插入行'},{id:'addRowAfter',label:'下方插入行'},{id:'addColumnBefore',label:'左侧插入列'},{id:'addColumnAfter',label:'右侧插入列'},{id:'deleteRow',label:'删除行'},{id:'deleteColumn',label:'删除列'},{id:'deleteTable',label:'删除表格'}]" :key="item.id" :disabled="busy" @pointerdown.prevent @click="canvas?.table(item.id)">{{item.label}}</button><button aria-label="关闭表格工具" @click="tableOpen=false">×</button></div></Transition>
    <Transition name="editor-bar"><form v-if="linkOpen" class="editor-find" @submit.prevent="insertLink"><input v-model="linkLabel" aria-label="链接文字" placeholder="文字或图片说明" /><input v-model="linkUrl" aria-label="链接地址" type="url" required placeholder="https://" /><button type="submit">插入</button><button type="button" @click="linkOpen = false">取消</button></form></Transition>
    <Transition name="editor-bar"><div v-if="findOpen" class="editor-find"><input v-model="find" aria-label="查找文字" placeholder="查找文字" /><input v-model="replacement" aria-label="替换文字" placeholder="替换为" /><small>{{ matches }} 处</small><button type="button" @click="findNext">下一处</button><button type="button" :disabled="!find || busy" @click="replaceAll">全部替换</button><button type="button" aria-label="关闭查找" @click="findOpen = false">×</button></div></Transition>
    <div ref="workspace" class="editor-workspace" :class="'mode-'+mode">
      <Transition name="editor-outline"><aside v-if="outlineOpen" class="editor-outline" aria-label="文章大纲"><strong>大纲</strong><button v-for="h in headings" :key="h.index" :style="{ paddingLeft: (h.match![1].length - 1) * 10 + 6 + 'px' }" @click="gotoLine(h.index)">{{ h.match![2] }}</button><p v-if="!headings.length">使用标题组织文章</p></aside></Transition>
      <MarkdownCanvas v-if="richReady&&draft.contentType!==1" v-show="mode==='rich'" ref="canvas" :active="mode==='rich'" :zoom="zoom" :font-size="markdownFontSize" :model-value="draft.content" :disabled="busy" @update:model-value="change" @history="richHistory=$event" @image="file=>emit('upload',file)"/>
      <div v-if="sourceReady||draft.contentType===1" v-show="mode!=='rich'||draft.contentType===1" class="source-pane" :style="{flexBasis:mode==='split'?'calc((100% - '+(outlineOpen?170:0)+'px - 7px) * '+split/100+')':'100%'}"><MarkdownSource ref="source" :model-value="draft.content" :disabled="busy" :active="mode!=='rich'||draft.contentType===1" :line-numbers="lineNumbers" :zoom="zoom" :font-size="draft.contentType === 1 ? undefined : markdownFontSize" :completion-enabled="draft.contentType !== 1" @update:model-value="change" @undo="undo()" @redo="undo(true)" @image="file=>emit('upload',file)" @scroll="ratio=>sync('source',ratio)"/></div>
      <div v-if="sourceReady" v-show="mode==='split'" class="split-handle" role="separator" aria-label="调整编辑预览比例" aria-orientation="vertical" tabindex="0" :aria-valuenow="split" aria-valuemin="25" aria-valuemax="75" @pointerdown.prevent="resizeSplit" @keydown.left.prevent="split=Math.max(25,split-5)" @keydown.right.prevent="split=Math.min(75,split+5)"></div>
      <EditorPreview v-if="sourceReady" v-show="mode==='split'" ref="preview" :content="draft.content" :active="mode==='split'" :zoom="zoom" :font-size="markdownFontSize" @scroll="ratio=>sync('preview',ratio)" @edit="async offset=>{await setMode('source');source?.select(offset)}" @language="codeLanguage" @task="task"/>

    </div>
    <footer class="editor-bottom"><div class="editor-save-status"><span>{{stats.words}} 字 · {{stats.chars}} 字符 · {{stats.lines}} 行 · 约 {{stats.minutes}} 分钟</span><label v-if="draft.contentType !== 1" class="editor-font-size">字号 <input type="number" aria-label="Markdown 编辑器字号" :min="minMarkdownFontSize" :max="maxMarkdownFontSize" step="1" :value="markdownFontSize" @change="setFontSize" @keydown.enter.stop.prevent="setFontSize" /> px</label><div class="editor-zoom">缩放 <ThemedSelect label="编辑器缩放" :model-value="zoom" :options="[75,90,100,110,125,150,200].map(n => ({value:n,label:n+'%'}))" @update:model-value="zoom=Number($event)" /></div><span role="status">{{ uploading ? '正在上传图片…' : saving ? '正在保存到云端…' : savedAt ? '云端草稿已保存 ' + new Date(savedAt).toLocaleTimeString() : '等待自动保存' }}</span></div><div class="editor-submit"><button type="button" class="secondary" :disabled="busy||saving" @click="emit('save')">保存草稿</button><button type="button" :disabled="busy || saving || uploading || !draft.title.trim() || !draft.content.trim()" @click="emit('publish')">{{ busy ? '发布中…' : draft.postId ? '更新文章' : '发布文章' }}</button></div></footer>
    <Transition name="editor-bar"><p v-if="error" class="editor-error" role="alert">{{ error }}</p></Transition>
  </section>
</template>

<style scoped>
.community-editor { display:flex; flex-direction:column; width:100%; height:100%; min-height:0; color:var(--fg); background:var(--card); font-size:13px; }
.community-editor button,.editor-file,.community-editor select { background:var(--card2); color:var(--fg); border:1px solid var(--line); border-radius:7px; padding:6px 9px; font:inherit; cursor:pointer; transition:background .16s,color .16s,border-color .16s,box-shadow .16s,transform .16s; }
.community-editor button:hover,.editor-file:hover { background:var(--acc-soft); color:var(--fg); border-color:var(--acc); }.community-editor button:active { transform:translateY(1px); }.community-editor button:disabled { opacity:.45; cursor:default; }.community-editor button:focus-visible,.editor-file:focus-within { outline:2px solid var(--acc); outline-offset:2px; }
.editor-top { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 18px; border-bottom:1px solid var(--line); min-width:0; }
.editor-context { display:flex; align-items:center; gap:8px; min-width:0; font-weight:600; }.editor-context > svg { flex-shrink:0; color:var(--fg2); }.editor-context > span { white-space:nowrap; }.editor-context .editor-board { min-width:0; max-width:220px; overflow:hidden; text-overflow:ellipsis; color:var(--fg2); font-size:12px; font-weight:400; padding-left:10px; border-left:1px solid var(--line); }
.editor-buttons { display:flex; gap:6px; flex-shrink:0; }.editor-buttons button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:30px; padding:5px 8px; background:transparent; font-size:11px; white-space:nowrap; }.editor-buttons .editor-close { border-color:transparent; }.editor-buttons .editor-close:hover { color:var(--err); }
.editor-title { flex-shrink:0; height:57px; padding:12px 24px; font-size:23px; line-height:1.35; font-weight:650; color:var(--fg); border:0; border-radius:0; width:100%; background:transparent; box-sizing:border-box; outline:0; transition:background .18s; }.editor-title::placeholder { color:var(--fg2); }.editor-title:focus { background:color-mix(in srgb,var(--acc) 3%,var(--card)); }
.editor-toolbar { flex-shrink:0; display:flex; flex-wrap:wrap; align-items:center; gap:3px; padding:6px 14px; border-block:1px solid var(--line); background:var(--card); }.editor-toolbar button { gap:5px; min-width:29px; height:29px; padding:4px 7px; display:inline-flex; align-items:center; justify-content:center; border-color:transparent; background:transparent; font-size:12px; }.editor-toolbar button[aria-pressed=true] { background:var(--acc-soft); border-color:var(--line); }.editor-toolbar select { padding:3px; max-width:65px; }.editor-file { display:inline-flex; gap:4px; align-items:center; font-size:11px; padding:5px 7px; background:transparent; }.tool-separator { align-self:stretch; border-left:1px solid var(--line); margin:4px; }
.editor-workspace { display:flex; flex:1; min-height:0; overflow:hidden; }.editor-source { flex:1; min-width:0; resize:none; border:0; border-radius:0; background:var(--card); color:var(--fg); padding:22px 24px; font-family:inherit; font-size:15px; line-height:1.85; outline:0; tab-size:2; }
.editor-outline { width:170px; flex-shrink:0; box-sizing:border-box; overflow:auto; padding:15px 10px; border-right:1px solid var(--line); background:var(--card2); }.editor-outline strong { display:block; padding:5px; }.editor-outline button { display:block; width:100%; text-align:left; font-size:12px; background:transparent; border:0; overflow-wrap:anywhere; }.editor-outline p { color:var(--fg2); font-size:11px; }
.editor-find { flex-shrink:0; display:flex; gap:6px; align-items:center; padding:8px 18px; flex-wrap:wrap; overflow:hidden; box-sizing:border-box; }.editor-find input { flex:1; width:80px; min-width:60px; background:var(--bg); color:var(--fg); border:1px solid var(--line); padding:7px; border-radius:7px; }
.editor-bottom { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 18px; flex-wrap:wrap; border-top:1px solid var(--line); }.editor-save-status { display:flex; flex-wrap:wrap; align-items:center; gap:10px; font-size:11px; color:var(--fg2); }.editor-submit { display:flex; gap:7px; margin-left:auto; }.editor-submit button:last-child { background:var(--acc); color:var(--on-acc,#202020); }.editor-error { flex-shrink:0; color:var(--err); font-size:12px; margin:0; padding:10px 20px; background:var(--card2); }
.editor-bar-enter-active,.editor-bar-leave-active { transition:opacity .18s,transform .18s,max-height .18s,padding .18s; max-height:180px; }.editor-bar-enter-from,.editor-bar-leave-to { opacity:0; transform:translateY(-5px); max-height:0; padding-block:0; }
.editor-outline-enter-active,.editor-outline-leave-active { transition:width .22s,padding .22s,opacity .18s,transform .22s; }.editor-outline-enter-from,.editor-outline-leave-to { width:0; padding-inline:0; opacity:0; transform:translateX(-8px); }
@media(max-width:760px) { .editor-top { flex-wrap:wrap; gap:7px; padding:9px 12px; }.editor-context { flex:1; }.editor-context .editor-board { max-width:140px; }.editor-buttons { margin-left:auto; flex-wrap:wrap; }.editor-buttons button { padding:5px 6px; }.file-action-text { display:none; } }
@media(max-width:480px) { .editor-top { gap:6px; }.editor-context { flex-basis:100%; }.editor-buttons { width:100%; margin:0; }.editor-buttons .editor-close { margin-left:auto; }.editor-title { padding:10px 16px; height:49px; font-size:21px; }.editor-toolbar { padding:5px 8px; gap:2px; max-height:98px; overflow:auto; }.editor-toolbar button { padding:4px 6px; }.editor-source { padding:16px; }.editor-outline { width:110px; }.editor-bottom { padding:9px 10px; gap:8px; }.editor-save-status { gap:7px; } }
@media(prefers-reduced-motion:reduce) { * { transition:none !important; } }
.editor-mode-row{display:flex;align-items:center;gap:5px;padding:5px 14px;color:var(--fg2);min-height:32px}.editor-mode-row nav{display:flex;gap:2px;margin-right:auto}.editor-mode-row button{display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:11px;padding:5px 7px;border-color:transparent;background:transparent;white-space:nowrap}.editor-mode-row button[aria-pressed=true]{background:var(--acc-soft);color:var(--fg)}.editor-mode-row .editor-file{padding:4px 7px}.editor-toolbar{border-top:0;padding-block:3px;overflow:visible}.editor-workspace>.source-pane{display:flex;min-width:0;min-height:0;flex-shrink:0;flex-grow:1}.mode-split>.source-pane{flex-grow:0}.split-handle{width:7px;flex-shrink:0;cursor:col-resize;background:var(--card2);touch-action:none;transition:background .12s}.split-handle:hover,.split-handle:focus-visible{background:var(--acc-soft);outline:1px solid var(--link)}.editor-workspace{transition:background .2s}.editor-document-menu,.table-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 18px;background:var(--card2);font-size:11px}.editor-document-menu label{display:flex;align-items:center;gap:4px;margin-right:8px}.editor-document-menu button,.table-tools button{font-size:11px;padding:4px 7px}.editor-save-status select{font-size:10px;padding:2px}.editor-find label{display:flex;align-items:center;white-space:nowrap}.editor-find label input{width:auto;min-width:0}.editor-top .editor-buttons button{background:transparent}@media(max-width:650px){.editor-mode-row{flex-wrap:wrap;padding-inline:8px}.editor-mode-row .editor-file{font-size:10px}.mode-split{flex-wrap:wrap;overflow:auto}.mode-split>.source-pane{flex-basis:100%!important;height:50%;min-height:210px}.mode-split>.editor-preview{flex-basis:100%;height:50%;min-height:210px}.mode-split>.split-handle{display:none}.editor-save-status{font-size:10px}}
.mode-rich>.markdown-canvas,.mode-source>.source-pane,.mode-split>.source-pane,.mode-split>.editor-preview{animation:editor-pane-in .18s ease-out}@keyframes editor-pane-in{from{opacity:.35;transform:translateY(3px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.editor-workspace>*{animation:none!important;transition:none!important}}
.editor-font-size{display:inline-flex;gap:4px;align-items:center;white-space:nowrap}.editor-font-size input{width:4.3em;padding:3px 5px;border:1px solid var(--line);border-radius:5px;background:var(--card2);color:var(--fg);font:inherit}
</style>
