<script setup lang="ts">
import { ref,computed,watch,nextTick,onBeforeUnmount } from 'vue'
import MarkdownCompletion from './MarkdownCompletion.vue'
import { markdownCompletionRange, useMarkdownCompletion } from '../core/editor/completion'
import { markdownAction,markdownEnter,indentMarkdown,escapeHtml,type EditAction } from '../core/editor/core'
const props=defineProps<{modelValue:string;disabled?:boolean;active?:boolean;lineNumbers?:boolean;zoom?:number;fontSize?:number;completionEnabled?:boolean}>(),emit=defineEmits(['update:modelValue','undo','redo','image','scroll'])
const input=ref<HTMLTextAreaElement>(),paint=ref<HTMLElement>(),gutter=ref<HTMLElement>(),highlight=ref(''),numbers=ref('1')
// Large source documents use native text painting; a full highlighted overlay
// would rebuild thousands of DOM spans on each input pause.
const highlighted=computed(()=>props.modelValue.length<=50000)
let selection={start:0,end:0},timer:ReturnType<typeof setTimeout>
function remember(){if(input.value)selection={start:input.value.selectionStart,end:input.value.selectionEnd}}
function refresh(){clearTimeout(timer);if(props.active===false)return;timer=setTimeout(()=>{const value=props.modelValue;highlight.value=highlighted.value?value.split('\n').map(line=>{const escaped=escapeHtml(line);return /^(#{1,6}\s|&gt;|\s*(?:[-*+] |\d+\. )|```|\$\$)/.test(escaped)?'<span class="md-marker">'+escaped+'</span>':escaped.replace(/(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$|\[[^\]]+\]\([^)]*\))/g,'<span class="md-token">$1</span>')}).join('\n')+'\n':'';numbers.value=props.lineNumbers?Array.from({length:value.split('\n').length},(_,i)=>i+1).join('\n'):''},120)}
watch(()=>[props.modelValue,props.active,props.lineNumbers],refresh,{immediate:true})
function update(value:string,start?:number,end=start){emit('update:modelValue',value);if(start!=null)void nextTick(()=>{input.value?.focus();input.value?.setSelectionRange(start,end!);remember()})}
function action(id:EditAction){rememberIfFocused();const value=markdownAction(props.modelValue,selection,id);update(value.text,value.start,value.end)}
function rememberIfFocused(){if(document.activeElement===input.value)remember()}
const completion = useMarkdownCompletion((id, { from, to }) => {
  const text = props.modelValue.slice(0, from) + props.modelValue.slice(to)
  const result = markdownAction(text, { start: from, end: from }, id)
  update(result.text, result.start, result.end)
})
function completionRange(manual = false) {
  const field = input.value
  if (props.completionEnabled === false || !field || field.selectionStart !== field.selectionEnd) return null
  const end = field.selectionStart
  const line = field.value.slice(field.value.lastIndexOf('\n', end - 1) + 1, end)
  if (!manual && !/^(?:[ \t]*(?:\n|$))/.test(field.value.slice(end))) return null
  return markdownCompletionRange(line, end, manual)
}
function onSourceInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  remember()
  if (!(event as InputEvent).isComposing) completion.update(completionRange())
}
watch(() => [props.active, props.disabled], () => completion.close())
function key(e:KeyboardEvent){if(e.isComposing||props.disabled)return;remember();if(props.completionEnabled!==false&&completion.key(e,()=>completionRange(true)))return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))completion.close();if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();emit(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');return}if(e.key==='Tab'){e.preventDefault();const v=indentMarkdown(props.modelValue,selection,e.shiftKey);update(v.text,v.start,v.end)}else if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();const v=markdownEnter(props.modelValue,selection);update(v.text,v.start)}}
function scroll(){const el=input.value;if(!el)return;if(paint.value){paint.value.scrollTop=el.scrollTop;paint.value.scrollLeft=el.scrollLeft}if(gutter.value)gutter.value.scrollTop=el.scrollTop;emit('scroll',el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight))}
function setScroll(ratio:number){const el=input.value;if(el){el.scrollTop=ratio*Math.max(0,el.scrollHeight-el.clientHeight);scroll()}}
function paste(e:ClipboardEvent){const files=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();for(const f of files)emit('image',f)}}
function drop(e:DragEvent){const files=Array.from(e.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();for(const f of files)emit('image',f)}}
function select(start:number,end=start){selection={start,end};void nextTick(()=>{input.value?.focus();input.value?.setSelectionRange(start,end);if(input.value){const line=props.modelValue.slice(0,start).split('\n').length-1;input.value.scrollTop=Math.max(0,line*parseFloat(getComputedStyle(input.value).lineHeight)-input.value.clientHeight/3);scroll()}})}
defineExpose({action,select,setScroll,focus:()=>input.value?.focus(),selection:()=>{rememberIfFocused();return selection}})
onBeforeUnmount(()=>clearTimeout(timer))
</script>
<template><div class="markdown-source" :style="{'--editor-scale':(zoom||100)/100,'--editor-font':(fontSize||14)+'px'}" @dragover.prevent @drop="drop"><pre v-if="lineNumbers" ref="gutter" class="source-gutter" aria-hidden="true">{{numbers}}</pre><div class="source-stack"><pre v-if="highlighted" ref="paint" class="source-paint" aria-hidden="true" v-html="highlight"></pre><textarea ref="input" class="source-input" :class="{highlighted}" aria-label="Markdown 源文" :value="modelValue" :disabled="disabled" spellcheck="false" maxlength="200000" placeholder="开始写作…" @input="onSourceInput" @select="remember" @click="remember(); completion.close()" @keyup="remember" @blur="remember(); completion.close()" @compositionend="completion.update(completionRange())" @keydown="key" @scroll="scroll" @paste="paste"></textarea><MarkdownCompletion :entries="completion.entries.value" :selected="completion.selected.value" @choose="completion.choose" /></div></div></template>
<style scoped>
.markdown-source{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden;background:var(--card);color:var(--fg)}.source-stack{flex:1;position:relative;min-width:0;min-height:0}.source-input,.source-paint,.source-gutter{font:calc(var(--editor-font,14px) * var(--editor-scale))/1.85 ui-monospace,Consolas,monospace!important;tab-size:2;margin:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;letter-spacing:normal;text-align:left}.source-input,.source-paint{position:absolute;inset:0;width:100%;height:100%;padding:22px 24px;border:0!important;border-radius:0!important;resize:none;overflow:auto;outline:0;background:transparent!important}.source-input{color:var(--fg)!important;caret-color:var(--link,var(--fg));min-height:0!important}.source-input.highlighted{-webkit-text-fill-color:transparent}.source-input::placeholder{-webkit-text-fill-color:var(--fg2)}.source-input::selection{background:var(--acc-soft);-webkit-text-fill-color:var(--fg)}.source-paint{pointer-events:none;color:var(--fg);scrollbar-width:none}.source-paint :deep(.md-marker){color:var(--link,var(--fg));font-weight:600}.source-paint :deep(.md-token){color:var(--link,var(--fg));text-decoration:underline;text-decoration-color:var(--line)}.source-gutter{width:48px;flex-shrink:0;padding:22px 8px 22px 0;overflow:hidden;text-align:right;color:var(--fg2);background:var(--card2);user-select:none}@media(max-width:480px){.source-input,.source-paint{padding:16px}.source-gutter{padding-top:16px;width:35px}}
</style>
