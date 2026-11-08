<script setup lang="ts">
/** A headless ProseMirror surface: one editable document, Markdown stays the storage format. */
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { MathInline, MathBlock, EditorCodeBlock } from '../core/editor/rich-nodes'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { resUrl } from '../core/res'
import { markdownAction } from '../core/editor/core'
import { markdownCompletionRange, useMarkdownCompletion } from '../core/editor/completion'
import MarkdownCompletion from './MarkdownCompletion.vue'
const props = defineProps<{ modelValue: string; disabled?: boolean; active?: boolean; zoom?: number; fontSize?: number }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'history', value: { undo: boolean; redo: boolean }): void; (e: 'image', file: File): void }>()
let lastOutput = props.modelValue
const renderImage = Image.extend({
  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.src || '')
    const allowed = /^(https?:\/\/|\/res\/|blob:)/i.test(raw)
    return ['img', { ...HTMLAttributes, src: allowed ? resUrl(raw) : undefined, loading: 'lazy' }]
  },
})
function syncCodeSelection(view: EditorView, event: Event) {
  if (view.composing || (event as KeyboardEvent).isComposing) return false
  const selection = view.dom.ownerDocument.getSelection()
  const anchor = selection?.anchorNode, head = selection?.focusNode
  if (!anchor || !head || !view.dom.contains(anchor) || !view.dom.contains(head)) return false
  const inCode = (node: globalThis.Node) => (node instanceof Element ? node : node.parentElement)?.closest('.code-input code')
  if (!inCode(anchor) && !inCode(head)) return false
  // The DOM caret can move before Chromium's selectionchange reaches ProseMirror.
  // Enter and Backspace must use the visible caret, including after a mouse click or Home/End.
  const { doc, selection: current } = view.state
  const from = view.posAtDOM(anchor, selection.anchorOffset)
  const to = view.posAtDOM(head, selection.focusOffset)
  if (from < 0 || to < 0 || (current.anchor === from && current.head === to)) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(from), doc.resolve(to))).setMeta('addToHistory', false))
  return false
}
const completion = useMarkdownCompletion((id, { from, to }) => {
  const ed = editor.value
  if (!ed) return
  const seed = ['h1','h2','quote','bullet','ordered','task'].includes(id) ? '填写内容' : ''
  const snippet = markdownAction(seed, { start: 0, end: seed.length }, id).text.trim()
  ed.chain().focus().insertContentAt({ from, to }, snippet, { contentType: 'markdown' }).run()
})
function completionRange(view: EditorView, manual = false) {
  const { empty, $from } = view.state.selection
  if (!empty || view.composing || $from.parent.type.spec.code || props.disabled || props.active === false) return null
  if (!manual && $from.parentOffset !== $from.parent.content.size) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  return markdownCompletionRange(before, $from.pos, manual)
}
const editor = useEditor({
  extensions: [StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }), Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    EditorCodeBlock, MathInline, MathBlock, renderImage, TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }), Highlight.extend({ renderMarkdown: (node, helpers) => '<mark>' + helpers.renderChildren(node) + '</mark>' })],
  content: props.modelValue, contentType: 'markdown', editable: !props.disabled,
  editorProps: {
    handleKeyDown: (view, event) => completion.key(event, () => completionRange(view, true)),
    handleDOMEvents: { blur: () => { completion.close(); return false }, keydown: syncCodeSelection, compositionstart: syncCodeSelection, paste: syncCodeSelection },
    attributes: { role: 'textbox', 'aria-label': '文章正文', 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': '开始写作，或输入 # 标题、> 引用、- 列表…' },
    handleDrop(_view,event) { const files=Array.from(event.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){for(const file of files)emit('image',file);return true}return false },
    handlePaste(view, event) {
      if (view.state.selection.$from.parent.type.spec.code) return false
      const files=Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){for(const file of files)emit('image',file);return true}
      // Clipboard Markdown is parsed as Markdown; rich HTML remains schema filtered by ProseMirror.
      const plain = event.clipboardData?.getData('text/plain') || ''
      if (!event.clipboardData?.getData('text/html') && /(^|\n)(#{1,6} |```|> |[-*] |\d+\. )|\*\*[^*]+\*\*/.test(plain)) {
        editor.value?.commands.insertContent(plain, { contentType: 'markdown' }); return true
      }
      return false
    },
  },
  onUpdate({ editor: ed, transaction }) { if (!transaction.docChanged) return; completion.update(completionRange(ed.view)); const value = ed.getMarkdown(); if (value === lastOutput) return; lastOutput = value; emit('update:modelValue', value) },
  onSelectionUpdate({ editor: ed }) { completion.update(completionRange(ed.view)) },
  onTransaction({ editor: ed }) { emit('history', { undo: ed.can().undo(), redo: ed.can().redo() }) },
})
watch(() => props.modelValue, value => {
  if (!editor.value || props.active === false || value === lastOutput) return
  lastOutput = value
  editor.value.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
})
watch(() => [props.disabled, props.active], () => { completion.close(); const ed=editor.value;if(!ed)return;ed.setEditable(!props.disabled && props.active!==false,false);if(props.active!==false&&props.modelValue!==lastOutput){lastOutput=props.modelValue;ed.commands.setContent(lastOutput,{contentType:'markdown',emitUpdate:false})} })
let themeObserver: MutationObserver
onMounted(()=>{themeObserver=new MutationObserver(()=>{if(props.active!==false)window.dispatchEvent(new Event('yh-editor-theme'))});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','data-theme']})})
onBeforeUnmount(()=>themeObserver?.disconnect())
function format(before: string) {
  const ed = editor.value; if (!ed || props.disabled) return
  const chain = ed.chain().focus()
  if (/^#{1,6} $/.test(before)) chain.toggleHeading({ level: before.trim().length as 1|2|3|4|5|6 }).run()
  else if (before === '**') chain.toggleBold().run()
  else if (before === '*') chain.toggleItalic().run()
  else if (before === '~~') chain.toggleStrike().run()
  else if (before === '<u>') chain.toggleUnderline().run()
  else if (before === '<mark>') chain.toggleHighlight().run()
  else if (before.includes('> ')) chain.toggleBlockquote().run()
  else if (before.includes('- [ ]')) chain.toggleTaskList().run()
  else if (before.trim() === '-') chain.toggleBulletList().run()
  else if (before.includes('1. ')) chain.toggleOrderedList().run()
  else if (before.includes('```')) chain.toggleCodeBlock().run()
  else if (before === '`') chain.toggleCode().run()
  else if (before.includes('| 列一')) chain.setTextSelection(ed.state.selection.to).insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()
  else if (before.includes('---')) chain.setHorizontalRule().run()
}
function link(url: string, text: string, image: boolean) {
  const ed = editor.value; if (!ed || props.disabled) return
  if (image) ed.chain().focus().setImage({ src: url, alt: text || '图片' }).run()
  else if (ed.state.selection.empty) ed.chain().focus().insertContent({ type: 'text', text: text || url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
  else ed.chain().focus().setLink({ href: url }).run()
}
function findNext(text: string) {
  const ed = editor.value; if (!ed || !text) return
  const found: { from: number; to: number }[] = []
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    let at = node.text.indexOf(text)
    while (at >= 0) { found.push({ from: pos + at, to: pos + at + text.length }); at = node.text.indexOf(text, at + text.length) }
  })
  const next = found.find(hit => hit.from >= ed.state.selection.to) || found[0]
  if (next) ed.chain().focus().setTextSelection(next).scrollIntoView().run()
}
function replaceAll(text: string, replacement: string) {
  const ed = editor.value; if (!ed || !text || props.disabled) return
  const hits: { from: number; to: number; marks: any }[] = []
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    let at = node.text.indexOf(text)
    while (at >= 0) { hits.push({ from: pos + at, to: pos + at + text.length, marks: node.marks }); at = node.text.indexOf(text, at + text.length) }
  })
  const tr = ed.state.tr
  for (const hit of hits.reverse()) {
    if (replacement) tr.replaceWith(hit.from, hit.to, ed.schema.text(replacement, hit.marks))
    else tr.delete(hit.from, hit.to)
  }
  if (hits.length) ed.view.dispatch(tr)
}
function gotoHeading(index: number) {
  const ed = editor.value; if (!ed) return
  let count = 0
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && count++ === index) ed.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
  })
}
function table(action:string){const ed=editor.value;if(!ed||props.disabled)return;const commands:any=ed.chain().focus();if(typeof commands[action]==='function')commands[action]().run()}
function formula(latex:string,block=false){const ed=editor.value;if(props.disabled||!ed)return;if(block&&ed.isActive('table')){const position=ed.state.selection.$from;for(let depth=position.depth;depth>0;depth--)if(position.node(depth).type.name==='table'){const after=position.after(depth);ed.view.dispatch(ed.state.tr.insert(after,ed.schema.nodes.mathBlock.create({latex})));ed.commands.focus();return}}ed.chain().focus().insertContent({type:block?'mathBlock':'mathInline',attrs:{latex}}).run()}
function offset(){const ed=editor.value;if(!ed)return 0;const before=ed.state.selection.$from.parent.textBetween(0,ed.state.selection.$from.parentOffset);const hint=ed.state.selection.from/Math.max(1,ed.state.doc.content.size)*props.modelValue.length;let best=0,distance=Infinity;if(before){let at=props.modelValue.indexOf(before);while(at>=0){if(Math.abs(at-hint)<distance){best=at+before.length;distance=Math.abs(at-hint)}at=props.modelValue.indexOf(before,at+1)}}return best}
function selectOffset(value:number){const ed=editor.value;if(!ed)return;const before=props.modelValue.slice(0,value).split('\n').at(-1)?.replace(/^(?:#{1,6} |[-*+] |\d+\. |> )/,'').replace(/[*_~`]/g,'')||'';let found=1;ed.state.doc.descendants((node,pos)=>{if(before&&node.isText&&node.text?.includes(before))found=pos+node.text.indexOf(before)+before.length});ed.chain().focus().setTextSelection(Math.min(found,ed.state.doc.content.size)).scrollIntoView().run()}
defineExpose({ offset, selectOffset, format, link, findNext, replaceAll, gotoHeading, table, formula, isTable:()=>editor.value?.isActive('table'), focus:()=>editor.value?.commands.focus(), undo: () => editor.value?.chain().focus().undo().run(), redo: () => editor.value?.chain().focus().redo().run(), selectionText: () => { const ed = editor.value; return ed ? ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to) : '' } })
</script>
<template><div class="markdown-canvas-wrap">
  <div class="markdown-canvas" :style="{fontSize:((fontSize||15)*(zoom||100)/100)+'px'}" @dragover.prevent><EditorContent :editor="editor" /></div>
  <MarkdownCompletion :entries="completion.entries.value" :selected="completion.selected.value" @choose="completion.choose" />
</div></template>
<style scoped>
.markdown-canvas-wrap { position:relative; display:flex; flex:1; min-width:0; min-height:0; }
.markdown-canvas { flex:1; min-width:0; overflow:auto; padding:22px 24px 72px; font-size:15px; line-height:1.85; color:var(--fg); background:var(--card); scroll-behavior:smooth; }
.markdown-canvas :deep(.tiptap) { outline:none; min-height:280px; max-width:900px; margin-inline:auto; overflow-wrap:anywhere; white-space:pre-wrap; }
.markdown-canvas :deep(.tiptap > :first-child) { margin-top:0; }.markdown-canvas :deep(p) { margin:0 0 .8em; }
.markdown-canvas :deep(.tiptap > p:only-child:has(br.ProseMirror-trailingBreak)::before) { content:attr(data-placeholder); color:var(--fg2); pointer-events:none; float:left; height:0; }
.markdown-canvas :deep(h1),.markdown-canvas :deep(h2),.markdown-canvas :deep(h3) { line-height:1.4; margin:1.4em 0 .7em; font-weight:650; }.markdown-canvas :deep(h1) { font-size:1.9em; }.markdown-canvas :deep(h2) { font-size:1.5em; }.markdown-canvas :deep(h3) { font-size:1.25em; }
.markdown-canvas :deep(blockquote) { border-left:3px solid var(--link,var(--fg)); margin:1em 0; padding:10px 18px; background:var(--card2); border-radius:0 8px 8px 0; }.markdown-canvas :deep(blockquote p:last-child) { margin:0; }
.markdown-canvas :deep(a) { color:var(--link,var(--fg)); text-decoration:underline; }.markdown-canvas :deep(img) { max-width:100%; height:auto; border-radius:8px; }.markdown-canvas :deep(.ProseMirror-selectednode) { outline:2px solid var(--link,var(--fg)); }
.markdown-canvas :deep(pre) { background:var(--card2); border:1px solid var(--line); border-radius:10px; padding:16px; overflow:auto; white-space:pre; font:13px/1.7 ui-monospace,Consolas,monospace; }.markdown-canvas :deep(code) { background:var(--card2); padding:2px 4px; border-radius:4px; font-size:.9em; }.markdown-canvas :deep(pre code) { padding:0; background:none; }
.markdown-canvas :deep(mark) { background:var(--acc-soft); color:var(--fg); }.markdown-canvas :deep(ul),.markdown-canvas :deep(ol) { padding-left:1.6em; }.markdown-canvas :deep(li p) { margin:.2em 0; }.markdown-canvas :deep(ul[data-type=taskList]) { list-style:none; padding:0; }.markdown-canvas :deep(ul[data-type=taskList] > li) { display:flex; align-items:baseline; gap:10px; }.markdown-canvas :deep(ul[data-type=taskList] > li > div) { min-width:0; flex:1; }.markdown-canvas :deep(ul[data-type=taskList] > li input) { accent-color:var(--acc); }
.markdown-canvas :deep(.tableWrapper) { max-width:100%; overflow:auto; }.markdown-canvas :deep(table) { border-collapse:collapse; table-layout:fixed; width:100%; margin:1em 0; }.markdown-canvas :deep(td),.markdown-canvas :deep(th) { border:1px solid var(--line); padding:8px 10px; min-width:70px; position:relative; }.markdown-canvas :deep(th) { background:var(--card2); }.markdown-canvas :deep(.selectedCell) { background:var(--acc-soft); }.markdown-canvas :deep(hr) { border:0; border-top:1px solid var(--line); margin:2em 0; }
@media(max-width:650px) { .markdown-canvas { padding:20px 17px 60px; font-size:14px; } }
@media(prefers-reduced-motion:reduce) { .markdown-canvas { scroll-behavior:auto; } }
.markdown-canvas :deep(.rich-math){border-radius:5px;cursor:text;max-width:100%;overflow:auto}.markdown-canvas :deep(.rich-math input){font:14px ui-monospace,monospace;color:var(--fg);background:var(--card2);border:1px solid var(--line);max-width:100%}.markdown-canvas :deep(.katex-display){overflow:auto}
</style>
