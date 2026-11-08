<script setup lang="ts">
import { routeChatMedia } from '../core/media-devices'
import ThemedSelect from './ThemedSelect.vue'
import { newMsgId } from '../plugins/api'
import { decodedImageUrl, imageMetadata, mediaMetadata } from '../core/media'
import { inject, ref, nextTick, computed, onMounted, onUnmounted, toRefs, defineAsyncComponent, watch } from 'vue'
import QuoteBar from './QuoteBar.vue'
import EditorToolbar from './EditorToolbar.vue'
import { markdownAction, createTextHistory, escapeHtml, type EditAction } from '../core/editor/core'
import AiInstructionDialog from './AiInstructionDialog.vue'
const ImageEditor = defineAsyncComponent(() => import('./ImageEditor.vue'))
const ImageProperties = defineAsyncComponent(() => import('./ImageProperties.vue'))
import { h } from '../satori/element'
import Icon from '../console/components/Icon.vue'
import { resUrl } from '../core/res'
import { fallbackAvatar, formatFileSize } from '../core/util'
import { moveComposerMentions, type ComposerMention, type PendingAttachment as Pending } from '../core/composer-drafts'
import { keyOf } from '../plugins/userbot'
import CallToolbarButtons from './CallToolbarButtons.vue'
import type { CallKind } from '../core/yunhu-calls'

const props = defineProps<{ detached?: boolean }>()
const ctx = inject<any>('ctx')
const chat = ctx.chat
const quickreply = ctx.quickreply

const target = chat.state.current
const accountId = ctx.auth?.state.user?.id
const draft = chat.drafts.get(target)
const { text, kind, pending, uploading } = toRefs(draft)
let disposed = false
const isCurrent = () => !disposed && chat.state.current?.id === target.id && chat.state.current?.type === target.type
  && ctx.auth?.state.user?.id === accountId
onUnmounted(() => { disposed = true })
const showCalls = computed(() => !props.detached && ctx.calls?.supported
  && (target.type === 2 || (target.type === 1 && target.id !== String(accountId))))
const enablingCalls = ref(false)
async function startCall(kind: CallKind) {
  const calls = ctx.calls
  if (!isCurrent() || !showCalls.value || enablingCalls.value || calls.state.session) return
  if (!calls.state.enabled) {
    enablingCalls.value = true
    try {
      const enabled = await ctx.ui.confirm('启用通话', '开启后可以发起和接收语音、视频通话。可以在「音频与视频」设置中关闭。', { okText: '启用通话' })
      if (!enabled || !isCurrent()) return
      calls.setEnabled(true)
    } finally { enablingCalls.value = false }
  }
  if (!calls.ready()) { ctx.ui.toast('实时连接暂不可用，请连接后再发起通话。', 'warn'); return }
  await calls.start(target, kind)
}
const aiOpen = ref(false)
const aiInstructionOpen = ref(false)
const aiInstructionError = ref('')
const aiSubmitting = ref(false)
const aiDetached = computed(() => !!ctx.aiPanel?.state.detached)
async function detachAi(position?: { x?: number; y?: number; drag?: boolean }) {
  aiInstructionOpen.value = false
  await ctx.aiPanel?.detach(position)
}
let stopAiDrag: (() => void) | undefined
function startAiDrag(e: PointerEvent) {
  if (e.button !== 0 || !ctx.aiPanel) return
  stopAiDrag?.()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const stop = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', stop); el.removeEventListener('pointercancel', stop)
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    stopAiDrag = undefined
  }
  const move = (p: PointerEvent) => {
    if (p.clientX < 0 || p.clientX > innerWidth || p.clientY < 0 || p.clientY > innerHeight) {
      stop(); void detachAi({ x: p.screenX - 180, y: p.screenY - 24, drag: true })
    }
  }
  stopAiDrag = stop
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop)
}
onUnmounted(() => stopAiDrag?.())
const aiKey = keyOf(target)
const aiHasAI = computed(() => ctx.userbot?.usesAIFor(target) !== false)
const aiWorkMode = computed(() => ctx.userbot?.workModeFor(target) || 'conversation')
function switchAiMode(value: string | number) { try { ctx.userbot.setWorkMode(target, value) } catch (e: any) { ctx.ui.toast(e.message, 'warn') } }
const aiBusy = computed(() => !!ctx.userbot?.state.busy[aiKey])
const aiNow = ref(Date.now())
const aiQueued = computed(() => ctx.userbot?.state.queued?.[aiKey])
const aiActive = computed(() => aiBusy.value || !!aiQueued.value)
const aiStatus = computed(() => aiQueued.value && !aiBusy.value
  ? `等待回复 · ${Math.max(0, Math.ceil((aiQueued.value.dueAt - aiNow.value) / 1000))} 秒 · ${aiQueued.value.count} 条消息`
  : ctx.userbot?.state.context[aiKey]?.stage || (aiBusy.value ? '正在准备回复' : ctx.userbot?.statusFor(target)))
const aiElapsed = computed(() => Math.max(0, Math.floor((aiNow.value - (ctx.userbot?.state.started?.[aiKey] || aiNow.value)) / 1000)))
let aiClock: ReturnType<typeof setInterval> | undefined
watch(aiActive, (active) => {
  clearInterval(aiClock); aiNow.value = Date.now()
  if (active) { if (isCurrent()) aiOpen.value = true; aiClock = setInterval(() => { aiNow.value = Date.now() }, 1000) }
}, { immediate: true })
onUnmounted(() => clearInterval(aiClock))
watch(() => ctx.userbot?.state.drafts[aiKey], (value) => { if (value && isCurrent()) aiOpen.value = true })
async function generateAiDraft(manual?: { instruction: string; previousDraft?: string }) {
  if (aiSubmitting.value || aiActive.value || !isCurrent()) return false
  aiSubmitting.value = true; aiInstructionError.value = ''
  try {
    const answer = await ctx.userbot.runManual(target, manual)
    if (isCurrent()) { ctx.userbot.state.drafts[aiKey] = answer; ctx.userbot.state.draftKinds[aiKey] = ctx.userbot.state.replyKinds[aiKey] || 1 }
    return true
  } catch (e: any) {
    if (isCurrent() && e?.name !== 'AbortError') {
      aiInstructionError.value = e.message || '生成失败，请重试'
      ctx.ui?.toast?.('AI 生成失败：' + aiInstructionError.value, 'error', 6000)
    }
    return false
  } finally { aiSubmitting.value = false }
}
async function submitAiInstruction(value: { instruction: string; useDraft: boolean }) {
  const previousDraft = value.useDraft ? ctx.userbot?.state.drafts[aiKey] : undefined
  if (await generateAiDraft({ instruction: value.instruction, previousDraft }) && isCurrent()) aiInstructionOpen.value = false
}
function useAiDraft() {
  const answer = ctx.userbot?.state.drafts[aiKey]
  if (!answer || !isCurrent()) return
  text.value = text.value ? text.value.replace(/\s+$/, '') + '\n' + answer : answer
  kind.value = ctx.userbot.state.draftKinds?.[aiKey] || 1
  delete ctx.userbot.state.draftKinds?.[aiKey]
  delete ctx.userbot.state.drafts[aiKey]; aiOpen.value = false
  nextTick(() => ta.value?.focus())
}

// 1 文本 / 3 Markdown / 8 HTML
const ta = ref<HTMLTextAreaElement | null>(null)
const formatting = ref(false), moreTools = ref(false), composerHistory = createTextHistory(text.value), historyVersion = ref(0)
let textSelection = {start:0,end:0}
const historyState = computed(()=>{historyVersion.value;return {undo:composerHistory.canUndo,redo:composerHistory.canRedo}})
function rememberSelection(){if(ta.value)textSelection={start:ta.value.selectionStart,end:ta.value.selectionEnd}}
watch(text, value => {
  composerHistory.record(value)
  historyVersion.value++
})
function formatText(action:EditAction){if(uploading.value)return;const value=markdownAction(text.value,textSelection,action);composerHistory.record(text.value,false);kind.value=3;text.value=value.text;composerHistory.record(value.text,false);historyVersion.value++;nextTick(()=>{ta.value?.focus();ta.value?.setSelectionRange(value.start,value.end);rememberSelection()})}
function historyMove(redo=false){text.value=redo?composerHistory.redo():composerHistory.undo();historyVersion.value++;nextTick(()=>{ta.value?.focus()})}

const imgInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const audioInput = ref<HTMLInputElement | null>(null)
const videoInput = ref<HTMLInputElement | null>(null)

/**
 * 输入区按钮来自插件注册表 ctx.chat.composerOf('composer')：
 * 「文本/Markdown/HTML」由 chat 插件贡献，「快捷回复」由 quickreply 贡献。
 * 快捷回复单独渲染成一行 chips（qr-row），与模式切换按钮视觉区分。
 * 两行顺序都可拖拽自由调整，存 localStorage（默认序 = 插件注册 order）。
 */
const BAR_ORDER_KEY = 'yh.bar.order'
const QR_ORDER_KEY = 'yh.qr.order'
function loadOrder(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch { return [] }
}
const barOrder = ref<string[]>(loadOrder(BAR_ORDER_KEY))
const qrOrder = ref<string[]>(loadOrder(QR_ORDER_KEY))
function sortByOrder(list: any[], order: string[]) {
  const idx = new Map(order.map((id, i) => [id, i]))
  return [...list].sort((a, b) => (idx.get(a.id) ?? 9999) - (idx.get(b.id) ?? 9999))
}
const barItems = computed(() => sortByOrder((chat.composerOf?.('composer') || []).filter((it: any) => it.kind !== 'quick'), barOrder.value))
const primaryTools = computed(() => barItems.value.filter(it => ['emoji', 'image', 'file'].includes(it.kind)))
const messageKinds = computed(() => barItems.value.filter(it => it.kind === 'type'))
const extraTools = computed(() => barItems.value.filter(it => it.kind !== 'type' && !['emoji', 'image', 'file'].includes(it.kind)))
const qrItems = computed(() => sortByOrder((chat.composerOf?.('composer') || []).filter((it: any) => it.kind === 'quick'), qrOrder.value))

/* ---- 拖拽排序：dragstart 记 id，drop 到目标上即把拖拽项插到目标位置 ---- */
let dragId: string | null = null
function onDragStart(id: string) { dragId = id }
function onDropReorder(targetId: string, which: 'bar' | 'qr') {
  if (!dragId || dragId === targetId) { dragId = null; return }
  const items = which === 'bar' ? barItems.value : qrItems.value
  const ids = items.map((i: any) => i.id)
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(targetId)
  if (from >= 0 && to >= 0) {
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    if (which === 'bar') barOrder.value = ids
    else qrOrder.value = ids
    localStorage.setItem(which === 'bar' ? BAR_ORDER_KEY : QR_ORDER_KEY, JSON.stringify(ids))
  }
  dragId = null
}

/** QQ 式图标工具条：非模式切换的按钮渲染成图标（title 保留文字语义） */
const BAR_ICON: Record<string, string> = {
  emoji: 'smile', image: 'image', file: 'paperclip', voice: 'mic',
  audioFile: 'mic', videoFile: 'video', videoRec: 'record',
}

function onInput() {
  onInputAt()
  if (!text.value.startsWith('/')) return
  const kw = text.value.slice(1)
  if (/\s/.test(kw)) return
  ctx.commands?.openWith?.(kw)
}

const offCommandPick = ctx.on('commands/pick', (t: string) => {
  text.value = t
  nextTick(() => ta.value?.focus())
})
/* 插件可以向输入框追加普通文本。 */
const offAppend = ctx.on('composer/append', (t: string) => {
  text.value += t
  nextTick(() => ta.value?.focus())
})
const offMention = ctx.on('composer/mention', (member: { id: string; name?: string }) => insertMention(member))

onUnmounted(() => { offCommandPick(); offAppend(); offMention() })

function onBar(it: any) {
  if (it.kind === 'type') { kind.value = it.value; return }
  if (it.kind === 'image') { imgInput.value?.click(); return }
  if (it.kind === 'file') { fileInput.value?.click(); return }
  if (it.kind === 'quick') { quickreply?.fire?.(it.value); return }
  if (it.kind === 'emoji') { ctx.stickers?.open?.(); return }
  if (it.kind === 'voice') {
    if (ctx.stickers?.state?.recording) ctx.stickers.recordStop()
    else ctx.stickers?.recordStart?.()
    return
  }
  if (it.kind === 'audioFile') { audioInput.value?.click(); return }
  if (it.kind === 'videoFile') { videoInput.value?.click(); return }
  if (it.kind === 'videoRec') {
    const st = ctx.stickers?.state
    if (st?.recordingVideo) ctx.stickers.recordVideoStop()
    else ctx.stickers?.recordVideoStart?.()
    return
  }
}

const placeholder = computed(() => ({
  1: '输入消息，Enter 发送 / Shift+Enter 换行；粘贴或拖入图片/视频/文件会先放进待发送区',
  3: 'Markdown：# 标题、**粗体**、`代码`、- 列表 …',
  8: '<b>HTML</b> 消息，支持内联标签',
}[kind.value]))

const MIN_HEIGHT = 52
const MAX_HEIGHT = 300
const HEIGHT_KEY = 'yh.composer.height'
function savedHeight() {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY))
    if (Number.isInteger(value) && value >= MIN_HEIGHT && value <= MAX_HEIGHT) return value
  } catch { /* Storage can be unavailable in private sessions. */ }
  return 0
}
const manualHeight = ref(savedHeight())
function saveHeight() {
  try {
    if (manualHeight.value) localStorage.setItem(HEIGHT_KEY, String(manualHeight.value))
    else localStorage.removeItem(HEIGHT_KEY)
  } catch { /* Keep the current height for this session. */ }
}

// New WebViews size the textarea natively. Older engines measure at most once per frame.
const nativeSizing = globalThis.CSS?.supports?.('field-sizing', 'content') === true
let measureFrame = 0
let textareaObserver: ResizeObserver | undefined
function scheduleHeight() {
  if (!ta.value || nativeSizing || manualHeight.value || measureFrame) return
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0
    const el = ta.value
    if (!el || manualHeight.value) return
    el.style.height = 'auto'
    el.style.height = Math.max(MIN_HEIGHT, el.scrollHeight) + 'px'
  })
}
if (!nativeSizing) {
  watch([text, kind], scheduleHeight, { flush: 'post' })
  onMounted(() => {
    scheduleHeight()
    if (ta.value && typeof ResizeObserver !== 'undefined') {
      let width = 0
      textareaObserver = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width === width) return
        width = entry.contentRect.width
        scheduleHeight()
      })
      textareaObserver.observe(ta.value)
    }
  })
  onUnmounted(() => {
    if (measureFrame) cancelAnimationFrame(measureFrame)
    textareaObserver?.disconnect()
  })
}

/* ---------------- 待发送附件：由 chat 服务保存，切会话保留草稿与预览 ---------------- */
let pendingSeq = Math.max(Date.now(), ...pending.value.map((p) => p.id))

function classify(f: File): Pending['kind'] {
  if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i.test(f.name)) return 'image'
  if (f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(f.name)) return 'video'
  if (f.type.startsWith('audio/')) return 'audio'
  return 'file'
}

/** 加入待发送区：图片/视频生成本地预览 URL（objectURL，移除/卸载时释放）。
 *  大小限制不在此预拦（用户要求：先让上传跑，失败时才提示 40MB 超限）——
 *  门在 api.uploadFile 的 LIMITS，失败原因会显示在暂存卡片与 toast 上。 */
function stage(f: File) {
  const k = classify(f)
  const url = (k === 'image' || k === 'video') ? URL.createObjectURL(f) : ''
  pending.value.push({ id: ++pendingSeq, file: f, url, kind: k, error: '', progress: 0, speed: 0 })
}

function unstage(p: Pending) {
  pending.value = pending.value.filter((x) => x.id !== p.id)
  if (p.url) URL.revokeObjectURL(p.url)
}

/** 选择框支持多选：全部进暂存区 */
async function onPick(e: any) {
  const fs: File[] = Array.from(e.target?.files || [])
  if (e.target) e.target.value = ''
  for (const f of fs) stage(f)
}

/** 粘贴：所有文件都进暂存区（之前只取第一个） */
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  let took = false
  for (const it of Array.from(items)) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (!f) continue
    took = true
    stage(f)
  }
  if (took) e.preventDefault()
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const fs = e.dataTransfer?.files
  if (!fs || !fs.length) return
  e.preventDefault()
  for (const f of Array.from(fs)) stage(f)
}

/* 拖到页面其他位置时阻止浏览器直接打开文件（window 级兜底） */
function winDragOver(e: DragEvent) { e.preventDefault() }
function winDrop(e: DragEvent) { e.preventDefault() }
function dismissMore(e:PointerEvent){if(!(e.target as HTMLElement)?.closest('.composer-more'))moreTools.value=false}
window.addEventListener('pointerdown',dismissMore)
window.addEventListener('dragover', winDragOver)
window.addEventListener('drop', winDrop)
onUnmounted(() => {
  window.removeEventListener('pointerdown',dismissMore)
  window.removeEventListener('dragover', winDragOver)
  window.removeEventListener('drop', winDrop)
})

/* ---- Tauri 桌面端拖放：监听 tauri://drag-drop 拿本地路径，经 /local-read 转 File 进暂存 ---- */
let offTauriDrop: (() => void) | null = null
async function stageLocalPath(p: string) {
  try {
    const r = await fetch('/local-read?path=' + encodeURIComponent(p), { headers: { token: ctx.api?.token || '' } })
    if (!r.ok) { ctx.ui?.toast?.('读取拖入文件失败：HTTP ' + r.status, 'error'); return }
    const name = decodeURIComponent(r.headers.get('x-file-name') || p.split(/[\\/]/).pop() || 'file')
    const blob = await r.blob()
    if (isCurrent()) stage(new File([blob], name, { type: blob.type || 'application/octet-stream' }))
  } catch (e: any) { ctx.ui?.toast?.('读取拖入文件失败：' + e.message, 'error') }
}
const w = window as any
if (w.__TAURI__?.event?.listen) {
  w.__TAURI__.event.listen('tauri://drag-drop', (ev: any) => {
    for (const p of ev?.payload?.paths || []) stageLocalPath(p)
  }).then((off: () => void) => { if (disposed) off(); else offTauriDrop = off })
}
onUnmounted(() => { offTauriDrop?.() })

const propertiesAttachment = ref<Pending | null>(null)
function openAttachmentProperties(p: Pending) {
  if (!uploading.value && !p.sent) propertiesAttachment.value = p
}

/* ---- 发送前图片编辑（裁剪/旋转/翻转） ---- */
const editing = ref<Pending | null>(null)
const applyingEdit = ref(false)
function openEditor(p: Pending) { if (!uploading.value && !p.sent && p.kind === 'image') editing.value = p }
async function onEdited(f: File) {
  const p = editing.value
  if (!p || uploading.value || p.sent || applyingEdit.value) return
  applyingEdit.value = true
  let url = ''
  try {
    url = await decodedImageUrl(f)
    if (!isCurrent() || editing.value !== p || !pending.value.includes(p)) return
    const previous = p.url
    p.elements = undefined; p.messageId = undefined; p.file = f; p.url = url; url = ''; p.error = ''
    await nextTick()
    editing.value = null
    if (previous) URL.revokeObjectURL(previous)
  } catch (e: any) { ctx.ui?.toast?.('编辑图片预览失败：' + (e?.message || String(e)), 'error') }
  finally { if (url) URL.revokeObjectURL(url); applyingEdit.value = false }
}

const dragOver = ref(false)

/** 上传进度回调：进度比例 + 实时速度 MB/s（约 0.4s 窗口平滑） */
function progressOf(p: Pending) {
  let lastLoaded = 0
  let lastTs = performance.now()
  return (loaded: number, total: number) => {
    const now = performance.now()
    const dt = (now - lastTs) / 1000
    if (dt > 0.4) {
      p.speed = Math.max(0, (loaded - lastLoaded) / dt / 1024 / 1024)
      lastLoaded = loaded
      lastTs = now
    }
    p.progress = total ? loaded / total : 0
  }
}

/**
 * 发送：逐个上传待发送附件（uploadAndUrl 拿完整 URL + 进度/速度），再发文本。
 * 失败保留在暂存区标红可重试；超大小限制在 api 层直接拒绝并提示。
 */
/** 读音频文件真实时长（秒，向上取整，最小 1）；解码失败返回 0。
 *  手机端进度条依赖 content f22（audio_time），传 0 会被 protobuf 省略 → 手机拖不了进度。 */
function audioDurationOf(f: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(f)
    const a = document.createElement('audio')
    const done = (v: number) => { URL.revokeObjectURL(url); resolve(v) }
    const t = setTimeout(() => done(0), 3000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => { clearTimeout(t); done(Math.max(1, Math.ceil(a.duration || 0))) }
    a.onerror = () => { clearTimeout(t); done(0) }
    a.src = url
  })
}

/** 仅重试上传；消息发送超时可能已被服务器接收，不能自动重发整条消息。 */
async function prepareAttachment(p: Pending) {
  if (p.elements) return
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const onProg = progressOf(p)
      if (p.kind === 'image') {
        if (!p.file.size) throw new Error('文件内容为空，请重新选择文件')
        const meta = await imageMetadata(p.file)
        if (typeof Image === 'function' && (!meta.width || !meta.height)) throw new Error('无法解码图片，请重新选择有效原图')
        const { key, url } = await ctx.api.uploadAndUrl(p.file, 'image', onProg)
        p.elements = [h.image(key || url, meta)]
      } else if (p.kind === 'video') {
        const { key } = await ctx.api.uploadFile(p.file, 'video', onProg)
        const meta = await mediaMetadata(p.file, 'video')
        p.elements = [{ ...h.video(key, meta.time), attrs: { src: key, ...meta, name: p.file.name, size: p.file.size } }]
      } else if (p.kind === 'audio') {
        const { key } = await ctx.api.uploadFile(p.file, 'audio', onProg)
        p.elements = [h.audio(key, await audioDurationOf(p.file))]
      } else {
        const { url } = await ctx.api.uploadAndUrl(p.file, 'file', onProg)
        p.elements = [h.file(url, p.file.name, p.file.size)]
      }
      return
    } catch (err: any) {
      const retryable = /abort|timeout|network|fetch|region|incorrect/i.test(err?.message || '')
      if (attempt || !retryable || !isCurrent()) throw err
      p.progress = 0; p.speed = 0
    }
  }
}

async function submit(onlyId?: number) {
  if (!isCurrent() || uploading.value || chat.state.sending) return
  const originalText = typeof onlyId==='number' ? '' : text.value
  const v = originalText.trim()
  const contentKind = kind.value
  const mentionedIds = [...new Set<string>((draft.mentions as ComposerMention[])
    .filter(({ start, end }) => originalText[start] === '@' && (start === 0 || /\s/.test(originalText[start - 1]))
      && (end === originalText.length || /[\s,!?;:，。！？；：]/.test(originalText[end] || '')))
    .map(({ id }) => id))]
  const todo = typeof onlyId==='number' ? pending.value.filter(p=>p.id===onlyId) : [...pending.value]
  if (!v && !todo.length) return
  uploading.value = true
  let attachFailed = 0
  try {
    for (const p of todo) {
      if (!isCurrent()) break
      p.error = ''; p.progress = 0; p.speed = 0
      try {
        await prepareAttachment(p)
        // 上传期间可能切换会话或退出登录，保留草稿，不向新会话发送。
        if (!isCurrent()) break
        if (!p.sent) {
          const retry = !!p.messageId
          p.messageId ||= newMsgId()
          await chat.sendMedia(p.elements, { msgId: p.messageId, retry })
          p.sent = true
        }
        unstage(p)
      } catch (err: any) {
        p.error = err?.message || '发送失败'
        p.progress = 0; p.speed = 0
        attachFailed++
      }
    }
    if (v && isCurrent()) {
      try {
        await chat.send(v, contentKind, mentionedIds)
        // 失败不清空；等待上传/发送时新输入的内容也必须保留。
        if (text.value === originalText) text.value = ''
      } catch { /* chat.send 已提示，草稿保留 */ }
    }
    await nextTick()
    if (isCurrent() && !text.value.trim() && !pending.value.length) ctx.emit('chat/scroll-bottom')
  } finally {
    uploading.value = false
    if (attachFailed && isCurrent()) {
      const firstErr = pending.value.find((x) => x.error)?.error || ''
      ctx.ui?.toast(`${attachFailed} 个附件发送失败${firstErr ? '：' + firstErr : ''}，已保留在待发送区，可重试`, 'error', 6000)
    }
  }
}

/* Only the resize handle captures the active pointer. Release it on every exit path. */
let resizeDrag: { el: HTMLElement; pointer: number; y: number; height: number; max: number; next: number | null } | undefined
let resizeFrame = 0
function startResize(e: PointerEvent) {
  const input = ta.value
  if (e.button !== 0 || !e.isPrimary || !input || resizeDrag) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  e.preventDefault()
  resizeDrag = {
    el, pointer: e.pointerId, y: e.clientY, height: input.getBoundingClientRect().height,
    max: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(innerHeight * .38))),
    next: null,
  }
}
function moveResize(e: PointerEvent) {
  const drag = resizeDrag
  if (!drag || e.pointerId !== drag.pointer || (e.clientY === drag.y && drag.next === null)) return
  drag.next = Math.round(Math.max(MIN_HEIGHT, Math.min(drag.max, drag.height + drag.y - e.clientY)))
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    if (drag.next !== null) manualHeight.value = drag.next
  })
}
function endResize(e?: PointerEvent) {
  const drag = resizeDrag
  if (!drag || (e && e.pointerId !== drag.pointer)) return
  resizeDrag = undefined
  cancelAnimationFrame(resizeFrame)
  resizeFrame = 0
  if (drag.el.hasPointerCapture(drag.pointer)) drag.el.releasePointerCapture(drag.pointer)
  if (drag.next !== null) {
    manualHeight.value = drag.next
    saveHeight()
  }
}
const stopResizeOnBlur = () => endResize()
window.addEventListener('blur', stopResizeOnBlur)
onUnmounted(() => {
  window.removeEventListener('blur', stopResizeOnBlur)
  endResize()
})
function resetHeight() {
  endResize()
  manualHeight.value = 0
  saveHeight()
  scheduleHeight()
}

function onKey(e: KeyboardEvent) {
  // 中文输入法 Enter 确认候选字时不能发送消息。
  if (e.isComposing || e.keyCode === 229) return
  rememberSelection()
  if(e.ctrlKey||e.metaKey){const key=e.key.toLowerCase();if(['b','i','k'].includes(key)){e.preventDefault();formatText(key==='b'?'bold':key==='i'?'italic':'link');return}if(['z','y'].includes(key)){e.preventDefault();historyMove(key==='y'||e.shiftKey);return}}
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    // @ 成员下拉打开时，Enter 选中当前高亮项而不是发送
    if (atOpen.value && atList.value.length) { e.preventDefault(); pickAt(atIdx.value); return }
    e.preventDefault(); submit()
  }
  if (atOpen.value && atList.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); atIdx.value = (atIdx.value + 1) % atList.value.length }
    if (e.key === 'ArrowUp') { e.preventDefault(); atIdx.value = (atIdx.value - 1 + atList.value.length) % atList.value.length }
    if (e.key === 'Escape') { atOpen.value = false }
  }
}

/* ---------------- @成员（QQ 式：输入 @ 弹成员列表，可搜索可选） ---------------- */
const atOpen = ref(false)
const atIdx = ref(0)
const atList = computed<any[]>(() => {
  if (!atOpen.value) return []
  const g = ctx.group
  if (!g || chat.state.current?.type !== 2) return []
  const kw = atKeyword.value.trim().toLowerCase()
  const ms = g.state?.members || []
  return (kw ? ms.filter((m: any) => (m.name || '').toLowerCase().includes(kw)) : ms).slice(0, 8)
})
const atKeyword = ref('')

function onInputAt() {
  // 检测光标前最近的 @ 片段：@xxx（无空格）即处于 at 输入态
  const el = ta.value
  if (!el) { atOpen.value = false; return }
  const position = el.selectionStart ?? text.value.length
  const before = text.value.slice(Math.max(0, position - 13), position)
  const m = before.match(/@([^\s@]{0,12})$/)
  if (m && chat.state.current?.type === 2) {
    atKeyword.value = m[1]
    atIdx.value = 0
    if (!atOpen.value) { atOpen.value = true; ctx.group?.loadMembers?.() }
  } else {
    atOpen.value = false
  }
}

function pickAt(i: number) {
  const m = atList.value[i]
  if (!m) return
  const pos = ta.value?.selectionStart ?? text.value.length
  const match = text.value.slice(0, pos).match(/@([^\s@]{0,12})$/)
  if (match) insertMention(m, match.index, pos)
}

function insertMention(member: { id: string; name?: string }, start = text.value.length, end = start) {
  if (!member.id || !isCurrent() || target.type !== 2) return
  const id = String(member.id)
  const name = String(member.name || id).replace(/\s+/g, ' ').trim() || id
  const label = '@' + (kind.value === 8 ? escapeHtml(name) : name)
  const left = text.value.slice(0, start)
  const padding = left && !/\s$/.test(left) ? ' ' : ''
  const insertion = padding + label + ' '
  const previous = draft.mentions
  text.value = left + insertion + text.value.slice(end)
  draft.mentions = [
    ...moveComposerMentions(previous, start, end, insertion.length),
    { id, start: start + padding.length, end: start + insertion.length - 1 },
  ]
  atOpen.value = false
  nextTick(() => {
    if (!isCurrent()) return
    const caret = start + insertion.length
    ta.value?.focus()
    ta.value?.setSelectionRange(caret, caret)
    rememberSelection()
  })
}

/* ---- 快捷回复 chips 管理 ---- */
const addingQr = ref(false)
const qrNew = ref('')
function qrAdd() {
  const t = qrNew.value.trim()
  if (t) quickreply?.add?.(t)
  qrNew.value = ''
  addingQr.value = false
}

</script>

<template>
  <div class="composer" :class="{ 'drag-over': dragOver }"
       @drop="onDrop" @dragover.prevent="dragOver = true" @dragleave="dragOver = false">
    <!-- 双击顶边把手恢复自动高度。 -->
    <div class="resize-bar" title="拖拽调整输入区高度（双击复位）"
         @pointerdown="startResize" @pointermove="moveResize" @pointerup="endResize"
         @pointercancel="endResize" @lostpointercapture="endResize" @dblclick="resetHeight"></div>
    <QuoteBar />
    <input ref="imgInput" type="file" accept="image/*" multiple hidden @change="onPick"/><input ref="fileInput" type="file" multiple hidden @change="onPick"/><input ref="audioInput" type="file" accept="audio/*" multiple hidden @change="onPick"/><input ref="videoInput" type="file" accept="video/*" multiple hidden @change="onPick"/>
    <Transition name="ai-strip">
      <section v-if="aiOpen && ctx.userbot && !aiDetached" id="ai-reply-strip" class="ai-menu" aria-label="AI 回复助手" @keydown.esc.stop="aiOpen = false">
        <div class="ai-strip-row">
          <span class="ai-badge"><Icon name="robot" :size="18" /></span>
          <div class="ai-info"><strong>{{ aiWorkMode === 'management' ? 'AI 管理' : 'AI 回复' }}</strong><span class="ai-status" role="status"><i v-if="aiActive" class="ai-working"></i>{{ aiStatus }}</span></div>
          <div class="ai-actions">
            <ThemedSelect v-if="target.type === 2" class="ai-mode" label="AI 工作模式" :model-value="aiWorkMode" :options="[{value:'conversation',label:'对话模式'},{value:'management',label:'管理模式'}]" @update:model-value="switchAiMode" />
            <button class="ai-generate" :disabled="!aiHasAI || aiActive || aiSubmitting" @click="generateAiDraft()">{{ !aiHasAI ? '规则自动化运行中' : aiActive ? '处理中…' : ctx.userbot.state.drafts[aiKey] ? '重新生成' : '生成回复草稿' }}</button>
            <button class="ai-instruction-trigger" :disabled="!aiHasAI || aiActive || aiSubmitting" @click="aiInstructionError = ''; aiInstructionOpen = true">快捷指令</button>
            <button v-if="ctx.userbot.state.drafts[aiKey]" @click="useAiDraft">填入输入框</button>
            <button v-if="ctx.aiPanel" class="ai-icon ai-detach" title="独立浮窗（可按住拖到软件外）" aria-label="独立浮窗" :disabled="ctx.aiPanel.state.opening" @pointerdown="startAiDrag" @click="detachAi()"><Icon name="copy" :size="17" /></button>
            <button class="ai-icon" title="当前会话 AI 设置" aria-label="当前会话 AI 设置" @click="ctx.userbot.open(target); aiOpen = false"><Icon name="settings" :size="17" /></button>
            <button class="ai-icon" title="收起 AI 回复" aria-label="收起 AI 回复" @click="aiOpen = false"><Icon name="close" :size="17" /></button>
          </div>
        </div>
        <div v-if="aiActive" class="ai-progress-area">
          <div class="ai-progress" role="progressbar" aria-label="AI 回复进度" :aria-valuetext="aiStatus"><span></span></div>
          <span class="ai-elapsed">{{ aiBusy ? `已等待 ${aiElapsed} 秒` : '等待合并消息 / 冷却结束' }}</span>
        </div>
        <span v-if="ctx.userbot.state.drafts[aiKey]" class="ai-format-label">{{ ctx.userbot.state.draftKinds[aiKey] === 3 ? 'Markdown 草稿' : '文字草稿' }}</span>
        <p v-if="ctx.userbot.state.drafts[aiKey]" class="ai-preview">{{ ctx.userbot.state.drafts[aiKey] }}</p>
        <div v-if="ctx.userbot.state.context[aiKey]" class="ai-context"><span>上下文 ≈ {{ ctx.userbot.state.context[aiKey].percent }}%</span><span v-if="ctx.userbot.state.context[aiKey].updatedAt">记忆已自动更新</span></div>
      </section>
    </Transition>
    <div v-if="aiOpen && aiDetached" class="ai-menu ai-detached-notice" role="status"><span>AI 回复已在独立浮窗中</span><button @click="detachAi()">显示浮窗</button><button @click="ctx.aiPanel.dock()">嵌回聊天框</button></div>
    <AiInstructionDialog :management="aiWorkMode === 'management'" v-if="aiInstructionOpen" :busy="aiSubmitting" :error="aiInstructionError" :has-draft="!!ctx.userbot?.state.drafts[aiKey]" @submit="submitAiInstruction" @close="aiInstructionOpen = false" />

    <!-- 待发送附件预览区：图片可点开发送前编辑 -->
    <div v-if="pending.length" class="pending">
      <div v-for="p in pending" :key="p.id" class="pend" :class="{ 'pend-video': p.kind === 'video', err: !!p.error }">
        <img v-if="p.kind === 'image'" :src="p.url" alt="" title="点击编辑（裁剪/旋转/翻转）" @click="openEditor(p)" />
        <video v-else-if="p.kind === 'video'" :src="p.url" muted preload="metadata" controls @play="routeChatMedia"></video>
        <div v-else class="pend-file" aria-hidden="true">
          <Icon :name="p.kind === 'audio' ? 'mic' : 'paperclip'" :size="19" />
        </div>
        <div class="pend-details">
          <span class="pend-name" :title="p.file.name">{{ p.file.name }}</span>
          <div class="pend-info">
            <span>{{ formatFileSize(p.file.size) }}</span>
            <button v-if="p.kind === 'image'" type="button" class="pend-properties" title="图片属性（EXIF）"
                    aria-label="附件图片属性" :disabled="uploading || p.sent" @click="openAttachmentProperties(p)">
              <Icon name="info" :size="12" aria-hidden="true" /> 属性
            </button>
          </div>
        </div>
        <!-- 上传进度条 + 实时速度 MB/s -->
        <div v-if="uploading && p.progress > 0 && !p.error" class="pend-prog">
          <div class="bar" :style="{ width: Math.round(p.progress * 100) + '%' }"></div>
          <span class="spd">{{ p.speed.toFixed(1) }} MB/s</span>
        </div>
        <div v-if="p.error" class="pend-err">
          <span :title="p.error">{{ p.error }}</span>
          <button type="button" :disabled="uploading" @click="submit(p.id)">重试</button>
        </div>
        <button type="button" class="pend-x" title="移除" aria-label="移除附件" :disabled="uploading" @click="unstage(p)">×</button>
      </div>
    </div>

    <!-- QQ 式输入区：输入框占满，发送按钮在右下角 -->
    <!-- @成员下拉（QQ 式：输入 @ 弹出，可继续输入搜索，↑↓ 选择，Enter 选中） -->
    <div v-if="atOpen && atList.length" class="at-pop">
      <button v-for="(m, i) in atList" :key="m.id" class="at-item" :class="{ on: i === atIdx }"
              @click="pickAt(i)" @mouseenter="atIdx = i">
        <img :src="m.avatar ? resUrl(m.avatar) : fallbackAvatar(m.name)" alt="" />
        <span>{{ m.name }}</span>
        <span class="dim small">{{ m.id }}</span>
      </button>
    </div>

    <Transition name="composer-format"><div v-if="formatting" class="composer-format"><EditorToolbar compact popup-above :disabled="uploading" :undo="historyState.undo" :redo="historyState.redo" @action="formatText" @undo="historyMove()" @redo="historyMove(true)"/></div></Transition>
    <div class="line">
      <textarea ref="ta" v-model="text" rows="1" :placeholder="placeholder"
                :class="{ 'has-manual-height': manualHeight }" :style="{ '--composer-height': manualHeight + 'px' }"
                aria-label="聊天消息" @input="onInput" @keydown="onKey" @paste="onPaste" @select="rememberSelection" @click="rememberSelection" @keyup="rememberSelection" @blur="rememberSelection"></textarea>
      <div class="composer-footer"><div class="bar-row">
        <button v-for="it in primaryTools" :key="it.id" class="ghost tiny icon-btn" :title="it.label" :aria-label="it.label" draggable="true" @click="onBar(it)" @dragstart="onDragStart(it.id)" @dragover.prevent @drop.stop="onDropReorder(it.id,'bar')"><Icon :name="BAR_ICON[it.kind]||'page'" :size="17"/></button>
        <CallToolbarButtons v-if="showCalls" :busy="enablingCalls || !!ctx.calls.state.session" @call="startCall" />
        <ThemedSelect class="composer-kind" label="消息格式" :model-value="kind" :options="messageKinds" @update:model-value="kind = Number($event)" />
        <button class="ghost tiny" aria-label="Markdown 格式工具" :aria-expanded="formatting" :class="{on:formatting}" @click="formatting=!formatting; moreTools=false"><Icon name="code" :size="17"/></button>
        <div class="composer-more"><button class="ghost tiny" aria-label="更多输入功能" :aria-expanded="moreTools" @click="moreTools=!moreTools; if (moreTools) formatting=false"><Icon name="plus" :size="17"/></button><Transition name="composer-format"><div v-if="moreTools" class="composer-more-menu" @keydown.esc.stop="moreTools=false"><button v-for="it in extraTools" :key="it.id" @click="onBar(it);moreTools=false"><Icon :name="BAR_ICON[it.kind]||'page'" :size="16"/>{{it.label}}</button><button v-for="it in qrItems" :key="it.id" draggable="true" @dragstart="onDragStart(it.id)" @dragover.prevent @drop.stop="onDropReorder(it.id,'qr')" @click="onBar(it);moreTools=false">{{it.label}}</button><input v-if="addingQr" v-model="qrNew" aria-label="快捷回复内容" @keydown.enter.prevent="qrAdd"/><button @click="addingQr?qrAdd():addingQr=true">{{addingQr?'保存快捷回复':'添加快捷回复'}}</button></div></Transition></div>
        <button v-if="ctx.userbot" class="ghost tiny ai-trigger" title="用户 Bot / AI" aria-label="用户 Bot / AI" :aria-expanded="aiOpen" :class="{active:aiOpen}" @click="aiOpen=!aiOpen">AI<span v-if="ctx.userbot.state.drafts[aiKey]" class="ai-dot"></span></button>
      </div><div class="send-row"><button aria-label="发送" :disabled="chat.state.sending||uploading||(!text.trim()&&!pending.length)" @click="submit()"><Icon name="send" :size="16"/><span>{{chat.state.sending||uploading?'发送中':'发送'}}</span></button></div></div>
      <div v-if="draft.remoteText!=null" class="draft-conflict" role="status">另一台设备修改了草稿<button @click="chat.drafts.useRemote(target)">采用云端</button><button @click="chat.drafts.keepLocal(target)">保留本机</button></div>
      <span v-if="ctx.stickers?.state?.recording" class="rec-dot">录音中 {{ctx.stickers.state.seconds}}s <button @click="ctx.stickers.recordStop()">结束录音</button></span><span v-if="ctx.stickers?.state?.recordingVideo" class="rec-dot">录制中 {{ctx.stickers.state.videoSeconds}}s <button @click="ctx.stickers.recordVideoStop()">结束录制</button></span>

    </div>

    <ImageProperties v-if="propertiesAttachment" :file="propertiesAttachment.file" @close="propertiesAttachment = null" />
    <ImageEditor v-if="editing" :file="editing.file" :url="editing.url" :saving="applyingEdit"
                 @done="onEdited" @close="editing = null" />
  </div>
</template>

<style scoped>
.composer { z-index: 4; }
.ai-wrap { position: relative; flex: 0 0 auto; }
.ai-detach{touch-action:none;cursor:grab!important}.ai-detach:active{cursor:grabbing!important}.ai-detached-notice{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--fg2)}.ai-detached-notice span{margin-right:auto}
.ai-trigger { position: relative; font-weight: 700; }
.ai-dot { position: absolute; width: 7px; height: 7px; border-radius: 50%; right: 2px; top: 2px; background: var(--acc); }
.ai-trigger.active { background: var(--acc-soft); color: var(--acc); border-color: var(--acc); }
.ai-menu { width: 100%; box-sizing: border-box; margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 13px; background: var(--card); box-shadow: 0 3px 14px #0000000c; overflow: hidden; transform-origin: bottom center; }
.ai-strip-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ai-badge { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius: 10px; color: var(--acc); background: var(--acc-soft); }
.ai-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.ai-info strong { font-size: 13px; white-space: nowrap; }
.ai-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-mode { max-width: 105px; min-height:31px; border:1px solid var(--line); border-radius:8px; background:var(--card2); color:var(--fg); padding:5px; font:inherit; font-size:12px; }
.ai-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ai-menu button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; padding: 7px 10px; min-height: 31px; border: 1px solid var(--line); border-radius: 8px; background: var(--card2); color: var(--fg); cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; transition: background 160ms, border-color 160ms, transform 160ms; }
.ai-menu button:hover { border-color: var(--acc); background: var(--acc-soft); }
.ai-menu button:active { transform: scale(.97); }
.ai-menu button:disabled { opacity: .55; cursor: default; }
.ai-menu .ai-generate { background: var(--acc-soft); color: var(--acc); border-color: transparent; }
.ai-menu .ai-icon { padding: 6px; width: 31px; background: transparent; border-color: transparent; }
.ai-format-label { display: block; margin-top: 9px; font-size: 11px; color: var(--fg2); }
.ai-preview { margin: 9px 0 0; padding: 10px 12px; max-height: 112px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg); background: var(--card2); border-radius: 8px; font-size: 13px; line-height: 1.65; }
.ai-progress-area { display: flex; align-items: center; gap: 12px; margin-top: 9px; }
.ai-progress { position: relative; flex: 1; height: 3px; overflow: hidden; border-radius: 4px; background: var(--acc-soft); }
.ai-progress span { position: absolute; inset: 0 auto 0 0; width: 38%; border-radius: inherit; background: var(--acc); animation: ai-progress 1.4s ease-in-out infinite; }
.ai-elapsed { font-size: 11px; color: var(--fg2); white-space: nowrap; }
@keyframes ai-progress { from { transform: translateX(-105%); } to { transform: translateX(365%); } }
.ai-context { display: flex; gap: 12px; margin-top: 7px; font-size: 11px; color: var(--fg2); }
.ai-working { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--acc); animation: ai-spin 900ms linear infinite; flex-shrink: 0; }
.ai-strip-enter-active { transition: opacity 210ms ease, transform 240ms cubic-bezier(.2,.8,.2,1), max-height 240ms ease, margin 240ms ease, padding 240ms ease; max-height: 260px; }
.ai-strip-leave-active { transition: opacity 170ms ease, transform 190ms ease, max-height 210ms ease, margin 210ms ease, padding 210ms ease; max-height: 260px; pointer-events: none; }
.ai-strip-enter-from,.ai-strip-leave-to { opacity: 0; transform: translateY(7px); max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
@media(max-width:760px) { .ai-info { align-items: flex-start; flex-direction: column; gap: 3px; }.ai-menu { padding: 9px; }.ai-badge { display: none; }.ai-strip-row { gap: 6px; flex-wrap: wrap; }.ai-status { max-width: 145px; }.ai-actions { gap: 3px; flex-wrap: wrap; }.ai-menu button { padding: 6px; } }
@media(prefers-reduced-motion:reduce) { .ai-strip-enter-active,.ai-strip-leave-active,.ai-menu button { transition: none; }.ai-working,.ai-progress span { animation: none; } }
.bar-row {
  display: flex; flex-wrap: nowrap; align-items: center; gap: 6px;
  margin-bottom: 8px; padding: 2px 0 4px;
  overflow-x: auto; overflow-y: hidden; max-width: 100%;
  scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
.bar-row::-webkit-scrollbar { display: none; }
.bar-row > * { flex: 0 0 auto; }
.tiny { padding: 3px 10px; font-size: 12px; border-radius: 7px; }
/* 图标按钮必须零内边距，否则 grid 居中会被 padding 挤偏（实测偏 4px） */
.bar-row .icon-btn { padding: 0; }
.bar-row .on { background: var(--acc); color: #fff; border-color: transparent; }
.line { position: relative; display: flex; }
.line textarea { width: 100%; padding-bottom: 34px; }   /* 底部留出发送行空间 */
.send-row {
  position: absolute; right: 6px; bottom: 6px;
  display: flex; align-items: center; gap: 10px;
}
.send-row .hint { font-size: 11px; color: var(--fg2); }
.send-row button { height: 28px; padding: 0 18px; font-size: 13px; border-radius: 6px; }
.rec-dot { font-size: 12px; color: var(--err); flex: 0 0 auto; }

/* 顶边拖拽把手：一条细热区，hover 变强调色提示可拖 */
.resize-bar {
  position: absolute; left: 0; right: 0; top: -4px; height: 8px; cursor: ns-resize;
  background: transparent; z-index: 2; touch-action: none;
}
.resize-bar:hover, .resize-bar:active { background: color-mix(in srgb, var(--acc) 35%, transparent); }

/* @成员下拉（浮在输入区上方） */
.at-pop {
  position: absolute; left: 14px; bottom: 100%; margin-bottom: 6px; z-index: 76;
  width: min(280px, 80%); max-height: 240px; overflow: auto;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .4); padding: 4px;
}
.at-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 6px 8px; border: none; border-radius: 7px; background: none;
  color: var(--fg); font-size: 13px; cursor: pointer;
}
.at-item img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.at-item.on { background: var(--acc-soft, var(--card2)); color: var(--acc); }

/* 待发送附件保留在一条可横向滚动的紧凑列表里。 */
.pending { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px; overflow-x: auto; }
.pend {
  --preview-width: 48px;
  position: relative; flex: none; display: grid; grid-template-columns: var(--preview-width) minmax(0, 1fr);
  align-items: center; column-gap: 6px; width: 166px; padding: 3px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--card2); overflow: hidden;
}
.pend-video { --preview-width: 84px; width: 202px; }
.pend.err { border-color: var(--err); }
.pend img, .pend video, .pend-file { width: 100%; height: 44px; border-radius: 5px; }
.pend img, .pend video { display: block; object-fit: cover; }
.pend img { cursor: pointer; }
.pend-file { display: grid; place-items: center; color: var(--fg2); background: var(--card); }
.pend-details { display: grid; gap: 2px; }
.pend-name, .pend-err span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pend-name { padding-inline-end: 20px; font-size: 11px; }
.pend-info { display: flex; align-items: center; gap: 4px; color: var(--fg2); font-size: 10px; white-space: nowrap; }
.pend-properties, .pend-err button {
  display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px; border: 1px solid var(--line);
  border-radius: 5px; color: var(--fg); background: var(--card); font-size: 10px;
}
.pend-properties:hover:enabled, .pend-err button:hover:enabled { background: var(--acc-soft); }
.pend-err {
  grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between;
  gap: 4px; margin-top: 2px; padding: 1px 2px; font-size: 10px; color: var(--err);
}
.pend-err button { flex: none; }
.pend-x {
  position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; padding: 0;
  border-radius: 5px; background: var(--card); color: var(--fg2); font-size: 14px; line-height: 1;
  display: grid; place-items: center;
}
.pend-x:hover:enabled { background: var(--err); color: #fff; }
.pend-prog {
  position: absolute; left: 0; right: 0; bottom: 0; height: 14px;
  background: rgba(0, 0, 0, .65); display: flex; align-items: center; pointer-events: none;
}
.pend-prog .bar {
  position: absolute; left: 0; top: 0; bottom: 0; background: var(--acc); opacity: .8;
  transition: width .25s linear;
}
.pend-prog .spd {
  position: relative; width: 100%; text-align: center; font-size: 9.5px; color: #fff; line-height: 14px;
}
.composer{position:relative;background:var(--card);padding:10px 12px;border:0;border-top:1px solid var(--line);color:var(--fg)}
.composer .line {
  display: flex; flex-direction: column; background: var(--card2); border-radius: 11px;
  padding: 0; overflow: visible; transition: background-color .15s;
}
.composer .line:focus-within { background-color: color-mix(in srgb, var(--card2) 90%, black); }
.composer .line textarea {
  display: block; flex: 0 0 auto; box-sizing: border-box; min-height: 52px;
  max-height: max(52px, min(300px, 38vh)); height: auto; width: 100%; resize: none;
  border: 0; border-radius: 11px; background: transparent; padding: 12px 14px;
  color: var(--fg); font-family: inherit; font-size: 14px; line-height: 1.65;
  overflow: auto; box-shadow: none; outline: none;
}
@supports (field-sizing: content) {
  .composer .line textarea { field-sizing: content; }
}
.composer .line textarea.has-manual-height { height: var(--composer-height) !important; }
.composer-footer{display:flex;align-items:center;gap:8px;padding:4px 8px 8px;min-width:0}.composer .bar-row{display:flex;align-items:center;gap:3px;margin:0;flex:1;min-width:0;flex-wrap:wrap}.composer .bar-row button:not(.composer-kind){width:29px;height:29px;padding:5px;border:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--fg);transition:background .13s,transform .12s}.composer .bar-row button:not(.composer-kind):hover{background:var(--acc-soft)}.composer button:active{transform:translateY(1px)}.composer :focus-visible:not(textarea){outline:2px solid var(--link,var(--fg));outline-offset:1px}.composer button:disabled{opacity:.45;cursor:default}.composer-kind{font-family:inherit;font-size:11px;border:0;border-radius:5px;background:transparent;color:var(--fg2);max-width:88px;padding:4px;min-width:0}.send-row{position:static;display:flex;align-items:center;gap:7px;flex-shrink:0}.send-row button{display:inline-flex;align-items:center;gap:5px;height:31px;padding:5px 10px;border:0;background:var(--acc);color:var(--on-acc,var(--fg));border-radius:7px;font-size:12px}.composer-format{min-height:32px;padding:3px 4px 5px;position:relative;z-index:10}.composer-format-enter-active,.composer-format-leave-active{transition:opacity .16s,transform .16s,max-height .16s;max-height:220px}.composer-format-leave-active{pointer-events:none}.composer-format-enter-from,.composer-format-leave-to{opacity:0;transform:translateY(4px);max-height:0;overflow:hidden}.composer-more{position:static}.composer-more-menu{position:absolute;bottom:calc(100% + 8px);inset-inline:4px;z-index:80;max-height:min(280px,38dvh);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:5px;box-shadow:0 6px 18px #0002}.composer .bar-row .composer-more-menu button{display:flex;width:100%;justify-content:flex-start;gap:8px;font-size:12px;min-height:32px;height:auto;text-align:left;overflow-wrap:anywhere}.composer-more-menu input{width:100%;box-sizing:border-box}.draft-conflict{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;padding:6px 10px;color:var(--fg2)}.draft-conflict button{font-size:11px;padding:3px 6px}.composer-more-menu input{max-width:100%}@media(max-width:650px){.composer{padding:7px}.composer-footer{gap:3px;padding-inline:5px}.composer .bar-row{gap:1px}.composer .bar-row button:not(.composer-kind){width:27px}.composer-kind{max-width:72px}.send-row button{padding:5px 8px}.composer .line textarea{font-size:14px}}@media(prefers-reduced-motion:reduce){.composer *{transition:none!important;animation:none!important}}
</style>
