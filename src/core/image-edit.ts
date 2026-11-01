/** Headless adapter: Jodit provides pixels/codecs; YH LaoDa owns state, UI and file actions. */
import { createDefaultProcessor, createIdentityDesign, resize, execute, type Design, type RasterImage } from '@jodit/image-editor'

export interface BrushStroke { id: string; color: string; size: number; points: { x: number; y: number }[] }
type ImageDesign = Design & { strokes: BrushStroke[] }
const identity = (): ImageDesign => ({ ...createIdentityDesign(), strokes: [] })
export type ImageDesignPatch = Omit<Partial<ImageDesign>, 'flip' | 'finetune'> & {
  flip?: Partial<Design['flip']>; finetune?: Partial<Design['finetune']>
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const bound = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)))

export class ImageEditSession {
  private entries: ImageDesign[] = [identity()]
  private index = 0
  constructor(readonly source: RasterImage) {}
  get design() { return clone(this.entries[this.index]) }
  get canUndo() { return this.index > 0 }
  get canRedo() { return this.index < this.entries.length - 1 }
  get dirty() { return JSON.stringify(this.entries[this.index]) !== JSON.stringify(identity()) }
  get orientedSize() {
    const rotate = this.entries[this.index].rotate
    return rotate % 180 ? { width: this.source.height, height: this.source.width } : { width: this.source.width, height: this.source.height }
  }
  get outputSize() {
    const d = this.entries[this.index]
    return d.resize || d.crop || this.orientedSize
  }
  apply(patch: ImageDesignPatch) {
    const old = this.entries[this.index]
    const next = { ...clone(old), ...clone(patch), flip: { ...old.flip, ...patch.flip }, finetune: { ...old.finetune, ...patch.finetune } }
    next.rotate = ((Math.round(next.rotate / 90) * 90) % 360 + 360) % 360
    const size = next.rotate % 180 ? { width: this.source.height, height: this.source.width } : this.source
    if (next.crop) {
      const x = bound(next.crop.x, 0, size.width - 1), y = bound(next.crop.y, 0, size.height - 1)
      next.crop = { x, y, width: bound(next.crop.width, 1, size.width - x), height: bound(next.crop.height, 1, size.height - y) }
    }
    if (next.resize) {
      let width = bound(next.resize.width, 1, 8192), height = bound(next.resize.height, 1, 8192)
      const ratio = Math.min(1, Math.sqrt(16_777_216 / (width * height)))
      width = Math.max(1, Math.floor(width * ratio)); height = Math.max(1, Math.floor(height * ratio))
      next.resize = { width, height }
    }
    for (const key of ['brightness', 'contrast', 'saturation', 'warmth'] as const) next.finetune[key] = bound(next.finetune[key], -100, 100)
    next.finetune.blur = bound(next.finetune.blur, 0, 100)
    if (JSON.stringify(old) === JSON.stringify(next)) return
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push(clone(next))
    if (this.entries.length > 60) this.entries.shift()
    this.index = this.entries.length - 1
  }
  undo() { if (this.canUndo) this.index-- }
  redo() { if (this.canRedo) this.index++ }
  reset() { this.apply(identity()) }
  /** Preview runs on a smaller raster; crop coordinates always stay in original image pixels. */
  preview(maxEdge = 1100, frame = this.source) {
    const scale = Math.min(1, maxEdge / Math.max(frame.width, frame.height, this.outputSize.width, this.outputSize.height))
    const source = scale === 1 ? frame : resize(frame, { width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)) })
    const design = this.design
    if (design.crop) design.crop = { x: Math.round(design.crop.x * scale), y: Math.round(design.crop.y * scale), width: Math.max(1, Math.round(design.crop.width * scale)), height: Math.max(1, Math.round(design.crop.height * scale)) }
    if (design.resize) design.resize = { width: Math.max(1, Math.round(design.resize.width * scale)), height: Math.max(1, Math.round(design.resize.height * scale)) }
    return { source, design }
  }
  /** Pure, DOM-free output used for pixel and geometry regression tests. */
  pixels() { return execute(this.source, this.design) }
}

/** Stroke coordinates share the output image's normalized space with text annotations. */
export function drawStrokes(ctx: CanvasRenderingContext2D, width: number, height: number, strokes: BrushStroke[]) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color; ctx.lineWidth = Math.max(1, stroke.size * height)
    const start = stroke.points[0]
    if (stroke.points.length === 1 || stroke.points.every(point => point.x === start.x && point.y === start.y)) { ctx.beginPath(); ctx.arc(start.x * width, start.y * height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); continue }
    ctx.beginPath(); ctx.moveTo(start.x * width, start.y * height)
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height)
    ctx.stroke()
  }
  ctx.restore()
}
function compositeStrokes(raster: RasterImage, strokes: BrushStroke[]) {
  if (!strokes.length) return raster
  const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  drawStrokes(ctx, raster.width, raster.height, strokes)
  return { width: raster.width, height: raster.height, data: ctx.getImageData(0, 0, raster.width, raster.height).data }
}
export async function openImageEdit(blob: Blob, signal?: AbortSignal) {
  const signature = new TextDecoder().decode(await blob.slice(0, 6).arrayBuffer())
  const isGif = /^GIF8[79]a$/.test(signature)
  if (!blob.type.startsWith('image/') && !isGif) throw new Error('该文件不是可编辑的图片')
  const processor = createDefaultProcessor(undefined, { maxSize: 4096, maxPixels: 16_777_216 })
  const animation = isGif ? await (await import('./gif-edit')).decodeGif(await blob.arrayBuffer(), signal) : undefined
  signal?.throwIfAborted()
  const session = new ImageEditSession(animation?.frames[0] || await processor.decode(blob))
  const render = (source: RasterImage) => compositeStrokes(processor.render(source, session.design), session.design.strokes)
  return {
    session, animation,
    preview(index = 0) { const { source, design } = session.preview(1100, animation?.frames[index] || session.source); return compositeStrokes(processor.render(source, design), design.strokes) },
    async export(type = 'image/png', progress?: (percent: number) => void, index = 0) {
      if (type === 'image/gif' && animation) return (await import('./gif-edit')).encodeGif(animation, render, signal, progress)
      const pixels = render(animation?.frames[index] || session.source)
      return processor.toBlob(pixels, createIdentityDesign(), { type, quality: .94 })
    },
  }
}

export function editedImageName(original: string, type = 'image/png') {
  return (original.replace(/[\\/:*?"<>|]/g, '_').replace(/\.[^.]*$/, '') || 'image') + '_edited.' + (type === 'image/jpeg' ? 'jpg' : type === 'image/gif' ? 'gif' : 'png')
}
