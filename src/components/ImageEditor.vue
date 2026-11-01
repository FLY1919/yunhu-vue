<script setup lang="ts">
/** YH LaoDa's editing surface, shared by the viewer and the attachment composer. */
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import Icon from '../console/components/Icon.vue'
import { drawStrokes, editedImageName, openImageEdit, type ImageDesignPatch, type BrushStroke } from '../core/image-edit'

const props = defineProps<{ file: File; url?: string; confirmLabel?: string; saving?: boolean }>()
const emit = defineEmits<{ (e: 'done', file: File): void; (e: 'close'): void }>()
const ctx = inject<any>('ctx')
const canvas = ref<HTMLCanvasElement | null>(null)
const previewStage = ref<HTMLElement | null>(null)
const loading = ref(true), busy = ref(false), error = ref(''), revision = ref(0)
const working = computed(() => busy.value || props.saving)
const tool = ref('transform'), format = ref('image/png'), lockRatio = ref(true)
const crop = ref({ x: 0, y: 0, width: 1, height: 1 }), size = ref({ width: 1, height: 1 })
const text = ref(''), textColor = ref('#ffffff'), textSize = ref(8)
const textInput = ref<HTMLTextAreaElement | null>(null), textPosition = ref({ x: .5, y: .5 })
const brushColor = ref('#ff3030'), brushSize = ref(2), zoom = ref(1)
const gifFrame = ref(0), gifPlaying = ref(false), frameCount = ref(0), exportProgress = ref(0)
const controller = new AbortController()
let gifTimer: ReturnType<typeof setTimeout> | undefined
const dragging = ref<null | { x: number; y: number; w: number; h: number }>(null)
const tabs = [{ id: 'transform', title: '裁剪与旋转', icon: 'scissors' }, { id: 'adjust', title: '调色与滤镜', icon: 'sliders' }, { id: 'text', title: '文字标注', icon: 'pencil' }, { id: 'brush', title: '画笔标注', icon: 'pencil' }]
const filters = [{ id: 'original', name: '原图' }, { id: 'grayscale', name: '黑白' }, { id: 'sepia', name: '复古' }, { id: 'invert', name: '反色' }]
let editor: Awaited<ReturnType<typeof openImageEdit>> | undefined
let frame = 0, disposed = false
let releasePointer: (() => void) | undefined
let observer: ResizeObserver | undefined
const design = computed(() => { revision.value; return editor?.session.design })
const canUndo = computed(() => { revision.value; return !!editor?.session.canUndo })
const canRedo = computed(() => { revision.value; return !!editor?.session.canRedo })
const output = computed(() => { revision.value; return editor?.session.outputSize })

function syncFields() {
  if (!editor) return
  crop.value = { x: 0, y: 0, ...editor.session.orientedSize, ...editor.session.design.crop }
  size.value = { width: editor.session.outputSize.width, height: editor.session.outputSize.height }
}
function repaint() {
  revision.value++
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (disposed || !editor || !canvas.value) return
    try {
      const raster = editor.preview(gifFrame.value)
      canvas.value.width = raster.width; canvas.value.height = raster.height
      canvas.value.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
      fitPreview()
    } catch (e: any) { error.value = '预览失败：' + e.message }
  })
}
function fitPreview() {
  if (!canvas.value || !previewStage.value) return
  const c = canvas.value, stage = previewStage.value
  const scale = Math.min(Math.max(1, stage.clientWidth - 44) / c.width, Math.max(1, stage.clientHeight - 84) / c.height) * zoom.value
  c.style.width = Math.max(1, Math.floor(c.width * scale)) + 'px'
  c.style.height = Math.max(1, Math.floor(c.height * scale)) + 'px'
}
function setZoom(value: number, clientX?: number, clientY?: number) {
  const c = canvas.value, stage = previewStage.value
  if (!c || !stage) return
  const old = c.getBoundingClientRect(), view = stage.getBoundingClientRect()
  const x = clientX ?? view.left + view.width / 2, y = clientY ?? view.top + view.height / 2
  const px = (x - old.left) / old.width, py = (y - old.top) / old.height
  zoom.value = Math.min(8, Math.max(.2, value)); fitPreview()
  const current = c.getBoundingClientRect()
  stage.scrollLeft += current.left + px * current.width - x
  stage.scrollTop += current.top + py * current.height - y
}
function wheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault(); e.stopPropagation()
  setZoom(zoom.value * Math.exp(-e.deltaY * (e.deltaMode === 1 ? .08 : .01)), e.clientX, e.clientY)
}
function stopGif() { gifPlaying.value = false; clearTimeout(gifTimer) }
function playGif() {
  if (gifPlaying.value) { stopGif(); return }
  gifPlaying.value = true
  const tick = () => {
    if (disposed || !gifPlaying.value || !editor?.animation) return
    gifTimer = setTimeout(() => { gifFrame.value = (gifFrame.value + 1) % frameCount.value; repaint(); tick() }, editor.animation.delays[gifFrame.value])
  }
  tick()
}
function apply(patch: ImageDesignPatch) {
  if (!editor || working.value) return
  error.value = ''; editor.session.apply(patch); syncFields(); repaint()
}
function rotate(degrees: number) { apply({ rotate: (design.value?.rotate || 0) + degrees, crop: null, resize: null }) }
function undo() { if (working.value) return; editor?.session.undo(); syncFields(); repaint() }
function redo() { if (working.value) return; editor?.session.redo(); syncFields(); repaint() }
function reset() { editor?.session.reset(); text.value = ''; syncFields(); repaint() }
function setSize(axis: 'width' | 'height', value: string) {
  const n = Math.round(Number(value))
  if (!n || n < 1) return
  const next = { ...size.value, [axis]: n }
  if (lockRatio.value && output.value) {
    const ratio = output.value.width / output.value.height
    if (axis === 'width') next.height = Math.max(1, Math.round(n / ratio))
    else next.width = Math.max(1, Math.round(n * ratio))
  }
  apply({ resize: next })
}
function addText(position = textPosition.value) {
  if (!text.value.trim()) return
  apply({ annotations: [...(design.value?.annotations || []), { id: crypto.randomUUID(), type: 'text', text: text.value.trim(), ...position,
    fontSize: textSize.value / 100, fontFamily: 'Arial, "Microsoft YaHei", sans-serif', color: textColor.value, bold: true, italic: false, align: 'center', valign: 'middle' }] })
  text.value = ''
}
function imagePoint(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }
}
function beginEdit(e: PointerEvent) {
  if (!editor || working.value || e.button !== 0 || e.ctrlKey || e.metaKey) return
  stopGif()
  if (tool.value === 'text') {
    textPosition.value = imagePoint(e)
    if (text.value.trim()) addText(textPosition.value)
    else textInput.value?.focus({ preventScroll: true })
    return
  }
  if (tool.value !== 'brush') { beginCrop(e); return }
  releasePointer?.()
  const element = canvas.value!, ctx2d = element.getContext('2d')!
  const snapshot = ctx2d.getImageData(0, 0, element.width, element.height)
  const stroke: BrushStroke = { id: crypto.randomUUID(), color: brushColor.value, size: brushSize.value / 100, points: [imagePoint(e)] }
  const paint = () => { ctx2d.putImageData(snapshot, 0, 0); drawStrokes(ctx2d, element.width, element.height, [stroke]) }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const point = imagePoint(ev), last = stroke.points[stroke.points.length - 1]
    if (stroke.points.length < 8192 && (point.x !== last.x || point.y !== last.y)) stroke.points.push(point)
    paint()
  }
  const stop = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    if (ev.type === 'pointerup') { move(ev); apply({ strokes: [...(design.value?.strokes || []), stroke] }) }
    else ctx2d.putImageData(snapshot, 0, 0)
    releasePointer?.()
  }
  releasePointer = () => {
    element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); element.removeEventListener('pointercancel', stop)
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    releasePointer = undefined
  }
  element.setPointerCapture(e.pointerId); element.addEventListener('pointermove', move); element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop); paint()
}
// Draw a new crop on the rendered result. Map back through the existing crop/resize to oriented source coordinates.
function beginCrop(e: PointerEvent) {
  if (tool.value !== 'transform' || !editor || working.value || e.button !== 0) return
  releasePointer?.()
  const element = canvas.value!, rect = element.getBoundingClientRect()
  const point = (ev: PointerEvent) => ({ x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)) })
  const start = point(e), base = { x: 0, y: 0, ...editor.session.orientedSize, ...design.value?.crop }
  const move = (ev: PointerEvent) => {
    const end = point(ev)
    dragging.value = { x: Math.min(start.x, end.x) * 100, y: Math.min(start.y, end.y) * 100, w: Math.abs(start.x - end.x) * 100, h: Math.abs(start.y - end.y) * 100 }
  }
  const stop = (ev: PointerEvent) => {
    const selection = dragging.value
    if (ev.type !== 'pointercancel' && selection && selection.w > 1 && selection.h > 1) apply({ crop: { x: base.x + base.width * selection.x / 100, y: base.y + base.height * selection.y / 100, width: base.width * selection.w / 100, height: base.height * selection.h / 100 }, resize: null })
    releasePointer?.()
  }
  releasePointer = () => {
    element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); element.removeEventListener('pointercancel', stop)
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    dragging.value = null; releasePointer = undefined
  }
  element.setPointerCapture(e.pointerId)
  element.addEventListener('pointermove', move); element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop)
}
async function close() {
  if (working.value) return
  if (editor?.session.dirty && ctx?.ui?.confirm && !await ctx.ui.confirm('放弃图片编辑', '未保存的编辑将被丢弃。', { okText: '放弃编辑', cancelText: '继续编辑' })) return
  emit('close')
}
async function confirm() {
  if (!editor || working.value || loading.value) return
  busy.value = true; error.value = ''; exportProgress.value = 0; stopGif()
  try {
    const blob = await editor.export(format.value, p => { exportProgress.value = p }, gifFrame.value)
    if (!disposed) emit('done', new File([blob], editedImageName(props.file.name, format.value), { type: blob.type }))
  } catch (e: any) { error.value = '导出失败：' + e.message }
  finally { busy.value = false }
}
function keyboard(e: KeyboardEvent) {
  if (ctx?.lock?.isLocked) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); void close(); return }
  if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
}
function visibility() { if (document.hidden) stopGif() }
onMounted(async () => {
  window.addEventListener('keydown', keyboard, true)
  document.addEventListener('visibilitychange', visibility)
  observer = new ResizeObserver(fitPreview)
  if (previewStage.value) observer.observe(previewStage.value)
  try {
    editor = await openImageEdit(props.file, controller.signal)
    if (disposed) return
    frameCount.value = editor.animation?.frames.length || 0
    if (editor.animation) format.value = 'image/gif'
    syncFields(); repaint()
  } catch (e: any) { error.value = '图片打开失败：' + e.message }
  finally { loading.value = false }
})
onUnmounted(() => { disposed = true; controller.abort(); stopGif(); observer?.disconnect(); releasePointer?.(); cancelAnimationFrame(frame); window.removeEventListener('keydown', keyboard, true); document.removeEventListener('visibilitychange', visibility); editor = undefined })
</script>

<template>
  <Teleport to="body">
    <div class="ied-mask" @click.self="close">
      <section class="ied-box" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
        <header class="ied-head"><div><h2 id="image-editor-title">编辑图片</h2><p>{{ file.name }}<span v-if="output"> · {{ output.width }} × {{ output.height }}</span></p></div><button class="ghost" aria-label="关闭图片编辑器" :disabled="working" @click="close">×</button></header>
        <div class="ied-workspace">
          <aside class="ied-tools">
            <nav aria-label="图片编辑工具"><button v-for="item in tabs" :key="item.id" :class="{ on: tool === item.id }" :aria-pressed="tool === item.id" @click="tool = item.id"><Icon :name="item.icon" :size="17" />{{ item.title }}</button></nav>
            <div v-if="tool === 'transform'" class="ied-panel">
              <h3>旋转与翻转</h3>
              <div class="ied-grid"><button class="ghost small" :disabled="!design" @click="rotate(-90)">左转 90°</button><button class="ghost small" :disabled="!design" @click="rotate(90)">右转 90°</button><button class="ghost small" :disabled="!design" @click="apply({ flip: { horizontal: !design?.flip.horizontal } })">水平翻转</button><button class="ghost small" :disabled="!design" @click="apply({ flip: { vertical: !design?.flip.vertical } })">垂直翻转</button></div>
              <h3>裁剪</h3><p class="ied-hint">在预览图上拖动选择裁剪区域，或输入像素范围。</p>
              <div class="ied-grid"><label>X<input type="number" v-model.number="crop.x" min="0" /></label><label>Y<input type="number" v-model.number="crop.y" min="0" /></label><label>宽<input type="number" v-model.number="crop.width" min="1" /></label><label>高<input type="number" v-model.number="crop.height" min="1" /></label></div>
              <div class="ied-grid"><button class="ghost small" :disabled="!design" @click="apply({ crop, resize: null })">应用裁剪</button><button class="ghost small" :disabled="!design?.crop" @click="apply({ crop: null, resize: null })">恢复全图</button></div>
              <h3>输出尺寸</h3><div class="ied-grid"><label>宽<input aria-label="输出宽度" type="number" :value="size.width" min="1" max="8192" @change="setSize('width', ($event.target as HTMLInputElement).value)" /></label><label>高<input aria-label="输出高度" type="number" :value="size.height" min="1" max="8192" @change="setSize('height', ($event.target as HTMLInputElement).value)" /></label></div><label class="ied-check"><input type="checkbox" v-model="lockRatio" /> 锁定宽高比</label>
            </div>
            <div v-else-if="tool === 'adjust'" class="ied-panel">
              <h3>基础调整</h3>
              <label class="ied-slider" v-for="item in ([['brightness', '亮度'], ['contrast', '对比度'], ['saturation', '饱和度']] as const)" :key="item[0]">{{ item[1] }}<span>{{ design?.finetune[item[0]] || 0 }}</span><input type="range" :aria-label="item[1]" min="-100" max="100" :value="design?.finetune[item[0]] || 0" @change="apply({ finetune: { [item[0]]: Number(($event.target as HTMLInputElement).value) } })" /></label>
              <h3>滤镜</h3><div class="ied-grid"><button v-for="filter in filters" :key="filter.id" class="ghost small" :class="{ selected: design?.filter === filter.id }" @click="apply({ filter: filter.id })">{{ filter.name }}</button></div>
            </div>
            <div v-else-if="tool === 'text'" class="ied-panel"><h3>文字标注</h3><p class="ied-hint">输入文字后，点击图片上的任意位置放置；也可以先点击选位置。</p><textarea ref="textInput" v-model="text" placeholder="输入标注或水印文字" aria-label="标注文字" rows="3"></textarea><label class="ied-slider">字号（图片高度的百分比）<input v-model.number="textSize" type="range" min="2" max="20" /></label><label class="ied-check">文字颜色<input type="color" v-model="textColor" /></label><button class="ghost small" :disabled="!text.trim()" @click="addText()">添加到选中位置</button><button class="ghost small" :disabled="!design?.annotations.length" @click="apply({ annotations: [] })">清除文字</button></div>
            <div v-else class="ied-panel"><h3>画笔标注</h3><p class="ied-hint">在图片上按住拖动绘制；每一笔都可以撤销。GIF 标注会应用到所有帧。</p><label class="ied-check">画笔颜色<input aria-label="画笔颜色" type="color" v-model="brushColor" /></label><label class="ied-slider">笔宽（图片高度的百分比）<span>{{ brushSize }}%</span><input aria-label="画笔粗细" type="range" min=".2" max="15" step=".2" v-model.number="brushSize" /></label><button class="ghost small" :disabled="!design?.strokes.length" @click="apply({ strokes: [] })">清除画笔</button></div>
          </aside>
          <div class="ied-preview-area"><div ref="previewStage" class="ied-preview" @wheel="wheel">
            <div v-if="loading" class="ied-loading" role="status">正在加载图片…</div>
            <div class="ied-image-wrap" :class="{ cropping: tool === 'transform' || tool === 'text' || tool === 'brush' }"><canvas ref="canvas" aria-label="图片编辑预览" @pointerdown.prevent="beginEdit"></canvas><div v-if="dragging" class="ied-selection" :style="{ left: dragging.x + '%', top: dragging.y + '%', width: dragging.w + '%', height: dragging.h + '%' }"></div></div>
          </div><div class="ied-view-bar"><button class="ghost small" aria-label="缩小编辑预览" @click="setZoom(zoom / 1.25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button class="ghost small" aria-label="放大编辑预览" @click="setZoom(zoom * 1.25)">＋</button><button class="ghost small" @click="setZoom(1)">适应窗口</button><template v-if="frameCount"><button class="ghost small" :disabled="working" @click="playGif">{{ gifPlaying ? '暂停动图' : '播放动图' }}</button><input aria-label="GIF 当前帧" type="range" min="0" :max="frameCount - 1" v-model.number="gifFrame" @input="stopGif(); repaint()" /><span>{{ gifFrame + 1 }}/{{ frameCount }}</span></template></div><p class="ied-preview-note">{{ frameCount ? 'GIF 保留动画；PNG/JPG 导出所选帧。' : '编辑只生成副本，保存后可自行发送。' }} 双指滚动平移，捏合或 Ctrl + 滚轮缩放。</p></div>
        </div>
        <p v-if="error" class="ied-error" role="alert">{{ error }}</p>
        <footer class="ied-bar"><button class="ghost small" :disabled="!canUndo || working" @click="undo"><Icon name="undo" :size="15" /> 撤销</button><button class="ghost small" :disabled="!canRedo || working" @click="redo">重做</button><button class="ghost small" :disabled="loading || working" @click="reset">重置</button><span class="ied-spacer"></span><select v-model="format" aria-label="导出格式" :disabled="working"><option v-if="frameCount" value="image/gif">GIF 动图</option><option value="image/png">PNG</option><option value="image/jpeg">JPG</option></select><button class="small" :disabled="loading || working || !design" @click="confirm">{{ working ? (saving ? '保存中…' : ('导出中…' + (exportProgress ? exportProgress + '%' : ''))) : confirmLabel || '应用到附件' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ied-mask { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; background: rgb(0 0 0 / .66); backdrop-filter: blur(10px); padding: 20px; }
.ied-box { width: min(1120px, 96vw); height: min(780px, 91vh); display: flex; flex-direction: column; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 22px; overflow: hidden; box-shadow: 0 24px 90px rgb(0 0 0 / .4); animation: editor-enter .18s ease-out; }
.ied-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--line); gap: 12px; }
.ied-head h2 { font-size: 18px; margin: 0 0 5px; }.ied-head p { color: var(--fg2); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
.ied-workspace { display: grid; grid-template-columns: 250px minmax(0, 1fr); flex: 1; min-height: 0; }
.ied-tools { overflow: auto; border-right: 1px solid var(--line); padding: 14px; }
.ied-tools nav { display: grid; gap: 5px; margin-bottom: 18px; }
.ied-tools nav button { display: flex; gap: 9px; align-items: center; padding: 11px; background: transparent; border: 0; text-align: left; color: var(--fg2); border-radius: 10px; font-size: 12px; }
.ied-tools nav .on { color: var(--acc); background: var(--acc-soft); }
.ied-panel { display: grid; gap: 12px; font-size: 12px; }
.ied-panel h3 { margin: 10px 0 0; font-size: 12px; font-weight: 600; }
.ied-hint { margin: 0; color: var(--fg2); font-size: 11px; line-height: 1.6; }
.ied-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ied-grid label { display: grid; gap: 5px; color: var(--fg2); }
.ied-grid input { min-width: 0; width: 100%; padding: 7px; font-size: 12px; border-radius: 8px; }
.ied-check { display: flex; align-items: center; gap: 7px; color: var(--fg2); }
.ied-check input[type=color] { width: 42px; height: 32px; padding: 3px; }
.ied-slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; color: var(--fg2); }
.ied-slider input { grid-column: 1/-1; width: 100%; }
.ied-panel textarea { width: 100%; resize: vertical; }
.ied-grid .selected { color: var(--acc); background: var(--acc-soft); border-color: var(--acc); }
.ied-preview-area { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
.ied-preview { flex: 1; min-width: 0; min-height: 0; padding: 24px 22px; position: relative; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.ied-image-wrap { display: block; position: relative; width: max-content; margin: auto; }
.ied-image-wrap canvas { display: block; max-width: none; box-shadow: 0 6px 28px rgb(0 0 0 / .14); touch-action: none; }
.ied-view-bar { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; padding: 8px; font-size: 11px; }
.ied-view-bar input { min-width: 70px; width: 90px; }
.ied-image-wrap.cropping { cursor: crosshair; }
.ied-selection { position: absolute; pointer-events: none; border: 2px solid #fff; box-shadow: 0 0 0 1px #000, 0 0 0 100vmax rgb(0 0 0 / .35); }
.ied-preview-note { margin: 0; padding: 0 12px 10px; text-align: center; font-size: 11px; color: var(--fg2); }
.ied-loading { position: absolute; color: var(--fg2); font-size: 13px; }
.ied-bar { display: flex; align-items: center; gap: 8px; padding: 15px 20px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.ied-bar select { width: 82px; font-size: 12px; padding: 6px; }.ied-spacer { flex: 1; }
.ied-error { margin: 0; padding: 10px 20px; color: var(--err); background: var(--card2); font-size: 12px; }
@keyframes editor-enter { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: none; } }
@media(max-width: 700px) { .ied-mask { padding: 6px; }.ied-box { height: 95vh; width: 100%; border-radius: 14px; }.ied-workspace { grid-template-columns: 1fr; grid-template-rows: minmax(150px, 1fr) minmax(130px, 1fr); }.ied-tools { grid-row: 2; border-right: 0; border-top: 1px solid var(--line); }.ied-tools nav { display: flex; gap: 3px; margin-bottom: 6px; }.ied-tools nav button { padding: 8px; }.ied-panel { gap: 8px; }.ied-preview { grid-row: 1; padding: 12px 12px 34px; }.ied-head { padding: 12px 15px; }.ied-bar { padding: 10px; gap: 5px; } }
@media(prefers-reduced-motion: reduce) { .ied-box { animation: none; } }
</style>
