<script setup lang="ts">
import { inject, ref, watch, onBeforeUnmount, shallowRef, defineAsyncComponent } from 'vue'
const CommunityEditor = defineAsyncComponent(() => import('./CommunityEditor.vue'))
import { saveCommunityDraft, removeCommunityDraft } from '../core/community-drafts'
import { PANEL_COLORS, newPanelId } from '../core/ai-panel'
const ctx = inject<any>('ctx'), cm = ctx.community, s = cm.state
const dialog = ref<HTMLDialogElement>(), detached = ref(false), uploading = ref(false), expanded = ref(false), visible = ref(false)
let bus: BroadcastChannel | undefined, popup: Window | null = null
let monitor: ReturnType<typeof setInterval> | undefined, observer: MutationObserver | undefined
let ack = 0, offNative: (() => void) | undefined
const renderedDraft = shallowRef(s.editor)
watch(() => s.editor, value => { if (value) renderedDraft.value = value })
const native = !!(window as any).__TAURI_INTERNALS__
const invoke = (command: string, args?: any) => (window as any).__TAURI__.core.invoke(command, args)
function snapshot() {
  if (!bus) return
  const styles = getComputedStyle(document.documentElement)
  bus.postMessage({ type: 'snapshot', ack, draft: s.editor ? { ...s.editor } : null, busy: s.publishing, saving:s.savingDraft, uploading: uploading.value,
    error: s.editorError, savedAt: s.savedAt, theme: document.documentElement.dataset.theme,
    colors: Object.fromEntries([...PANEL_COLORS, '--err', '--warn', '--on-acc'].map(k => [k, styles.getPropertyValue(k)])),
    locked: !!ctx.lock?.isLocked })
}
function change(patch: any) {
  if (!s.editor || s.publishing || ctx.lock?.isLocked) return
  for (const key of ['title', 'content']) {
    if (typeof patch?.[key] !== 'string') continue
    if (patch[key].length > (key === 'title' ? 200 : 200000)) { s.editorError = key === 'title' ? '标题最多 200 字' : '正文最多 20 万字，原内容已保留'; return }
    s.editor[key] = patch[key]
  }
  if (patch?.contentType === 1 || patch?.contentType === 2) s.editor.contentType = patch.contentType
  s.savedAt = 0
}
async function image(file: File) {
  const draft = s.editor
  if (!draft || uploading.value || s.publishing || !file?.type?.startsWith('image/') || file.size > 10 * 1024 * 1024 || !file.size) { s.editorError = '请选择 10MB 以内的有效图片'; return }
  uploading.value = true
  try {
    const r = await ctx.api.uploadFile(file, 'image')
    if (draft !== s.editor || ctx.lock?.isLocked) return
    const raw = r.url || (r.key ? 'https://chat-img.jwznb.com/' + r.key : '')
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('上传接口未返回图片地址')
    change({ content: draft.content + '\n\n![' + file.name.replace(/[\[\]\n]/g, '') + '](' + url.href.replace(/\)/g, '%29') + ')\n' })
  } catch (e: any) { if (draft === s.editor) s.editorError = '图片上传失败：' + e.message }
  finally { uploading.value = false; snapshot() }
}
async function dock() {
  detached.value = false; bus?.postMessage({ type: 'dock' }); bus?.close(); bus = undefined
  observer?.disconnect(); observer = undefined; if (monitor) clearInterval(monitor)
  offNative?.(); offNative = undefined
  if (native) await invoke('close_community_editor').catch(() => {})
  else { popup?.close(); popup = null }
}
async function detach() {
  if (detached.value) { await dock(); return }
  try {
    const sessionId = newPanelId()
    bus = new BroadcastChannel('yh-community-editor-' + sessionId); ack = 0
    bus.onmessage = async ({ data }) => {
      if (!detached.value || !s.editor || ctx.lock?.isLocked) return
      if (data?.type === 'ready') { snapshot(); return }
      if (data?.type !== 'command' || !Number.isSafeInteger(data.seq) || data.seq <= ack) return
      ack = data.seq
      if (data.action === 'change') change(data.patch)
      else if (data.action === 'save') await cm.saveDraft()
      else if (data.action === 'publish' && !uploading.value) await cm.publish()
      else if (data.action === 'upload') await image(data.file)
      else if (data.action === 'close') { if (await cm.closeEditor()) await dock() }
      else if (data.action === 'detach') await dock()
      snapshot()
    }
    detached.value = true
    if (native) {
      offNative = await (window as any).__TAURI__.event.listen('community-editor-closed', () => { void dock() })
      await invoke('open_community_editor', { sessionId })
    } else {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('community-editor', sessionId)
      popup = window.open(url.href, 'yh-editor-' + sessionId, 'popup,width=1100,height=800')
      if (!popup) throw new Error('请允许打开独立窗口')
      monitor = setInterval(() => { if (popup?.closed) void dock() }, 700)
    }
    observer = new MutationObserver(snapshot); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    snapshot()
  } catch (e: any) { await dock(); s.editorError = '独立窗口打开失败：' + e.message }
}
watch(() => !!s.editor && !detached.value && !ctx.lock?.isLocked, value => { if (value) renderedDraft.value = s.editor; visible.value = value }, { immediate: true })
watch(() => s.editor?.id, id => { expanded.value = false; if (!id) void dock() })
function showDialog(element: Element) {
  const modal = element as HTMLDialogElement
  if (visible.value && modal.isConnected && !modal.open) modal.showModal()
}
function hideDialog(element: Element) {
  (element as HTMLDialogElement).close()
  if (!s.editor) renderedDraft.value = null
}
watch(() => [s.editor?.title, s.editor?.content, s.editor?.contentType, s.editor?.baId, s.publishing, s.savingDraft, s.savedAt, s.editorError, uploading.value], snapshot)
watch(() => ctx.lock?.isLocked, locked => { if (locked) { dialog.value?.close(); renderedDraft.value = null; void dock() } })
let autosave: ReturnType<typeof setTimeout>, backupTimer: ReturnType<typeof setTimeout>
function scheduleSave(){clearTimeout(autosave);clearTimeout(backupTimer);const draft=s.editor;if(!draft||ctx.lock?.isLocked)return;backupTimer=setTimeout(()=>{if(draft===s.editor&&cm.editorDirty())try{saveCommunityDraft({...draft,updatedAt:Date.now()})}catch{}},500);autosave=setTimeout(async()=>{if(draft===s.editor&&cm.editorDirty()&&!s.publishing&&!s.savingDraft&&!uploading.value){const saved=await cm.saveDraft({silent:true});if(saved&&!cm.editorDirty())try{removeCommunityDraft(draft.owner,draft.id)}catch{}if(saved&&draft===s.editor&&cm.editorDirty())scheduleSave()}},1600)}
watch(()=>[s.editor?.id,s.editor?.title,s.editor?.content,s.editor?.contentType],scheduleSave)
watch(()=>s.savingDraft,(saving,was)=>{if(was&&!saving&&s.editor&&cm.editorDirty()&&!s.editorError)scheduleSave()})
function retrySave(){if(s.editor&&cm.editorDirty())scheduleSave()}
window.addEventListener('online',retrySave)
function preventLoss(e: BeforeUnloadEvent) { if (cm.editorDirty()) { e.preventDefault(); e.returnValue = '' } }
window.addEventListener('beforeunload', preventLoss)
onBeforeUnmount(() => { clearTimeout(autosave);clearTimeout(backupTimer);window.removeEventListener('online',retrySave);void dock(); window.removeEventListener('beforeunload', preventLoss) })
</script>
<template>
  <Teleport to="body"><Transition name="editor-dialog" appear @enter="showDialog" @after-leave="hideDialog"><dialog v-if="visible" ref="dialog" class="community-editor-dialog" :class="{ 'is-expanded': expanded }" aria-label="撰写文章" @cancel.prevent="cm.closeEditor()"><CommunityEditor v-if="renderedDraft" :key="renderedDraft.id" :draft="renderedDraft" :expanded="expanded" :busy="s.publishing" :saving="s.savingDraft" :error="s.editorError" :saved-at="s.savedAt" :uploading="uploading" @change="change" @save="cm.saveDraft()" @publish="!uploading && cm.publish()" @upload="image" @close="cm.closeEditor()" @expand="expanded = !expanded" @detach="detach" /></dialog></Transition></Teleport>
</template>
<style scoped>
.community-editor-dialog { width:min(1240px,96vw); height:92dvh; max-width:none; max-height:none; padding:0; border:1px solid var(--line); border-radius:14px; background:var(--card); color:var(--fg); overflow:hidden; box-shadow:0 24px 90px #0005; transition:width .24s,height .24s,border-radius .24s; }.community-editor-dialog.is-expanded { width:100vw; height:100dvh; border-radius:0; border-width:0; }.community-editor-dialog::backdrop { background:#0006; transition:background .2s; }.editor-dialog-enter-active,.editor-dialog-leave-active { transition:opacity .2s,transform .24s,width .24s,height .24s,border-radius .24s; }.editor-dialog-enter-from,.editor-dialog-leave-to { opacity:0; transform:translateY(12px) scale(.985); }.editor-dialog-enter-from::backdrop,.editor-dialog-leave-to::backdrop { background:#0000; }@media(max-width:650px) { .community-editor-dialog { width:100vw; height:100dvh; margin:0; border:0; border-radius:0; } }@media(prefers-reduced-motion:reduce) { .community-editor-dialog { transition:none; } }
</style>
