import { parseGIF, decompressFrame } from 'gifuct-js'
import * as gifenc from 'gifenc'
import type { RasterImage } from '@jodit/image-editor'
const { GIFEncoder, quantize, applyPalette } = typeof gifenc.GIFEncoder === 'function' ? gifenc : (gifenc as any).default

export interface GifAnimation { frames: RasterImage[]; delays: number[]; repeat: number }
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const check = (signal?: AbortSignal) => { signal?.throwIfAborted() }
export async function decodeGif(data: ArrayBuffer, signal?: AbortSignal): Promise<GifAnimation> {
  const gif = parseGIF(data), width = gif.lsd.width, height = gif.lsd.height
  const images = gif.frames.filter((f: any) => !!f.image) as any[]
  if (!width || !height || !images.length) throw new Error('GIF 没有有效画面')
  if (images.length > 1000 || width * height * images.length > 48_000_000) throw new Error('GIF 画面过大，请先缩小动图后再编辑')
  const frames: RasterImage[] = [], delays: number[] = []
  const pixels = new Uint8ClampedArray(width * height * 4)
  const background = gif.gct?.[gif.lsd.backgroundColorIndex] || [0, 0, 0]
  function fill(left: number, top: number, w: number, h: number, transparent: boolean) {
    for (let y = top; y < Math.min(height, top + h); y++) for (let x = left; x < Math.min(width, left + w); x++) {
      const i = (y * width + x) * 4
      pixels.set(transparent ? [0, 0, 0, 0] : [...background, 255], i)
    }
  }
  fill(0, 0, width, height, !!images[0].gce?.extras.transparentColorGiven)
  let previous: ReturnType<typeof decompressFrame> | undefined, saved: Uint8ClampedArray | undefined
  for (const image of images) {
    check(signal)
    if (previous?.disposalType === 2) { const d = previous.dims; fill(d.left, d.top, d.width, d.height, previous.transparentIndex !== undefined) }
    else if (previous?.disposalType === 3 && saved) pixels.set(saved)
    const frame = decompressFrame(image, gif.gct, true), d = frame.dims
    if (!d.width || !d.height || d.left + d.width > width || d.top + d.height > height) throw new Error('GIF 帧尺寸不正确')
    saved = frame.disposalType === 3 ? pixels.slice() : undefined
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
      const from = (y * d.width + x) * 4
      if (frame.patch[from + 3]) pixels.set(frame.patch.subarray(from, from + 4), ((y + d.top) * width + x + d.left) * 4)
    }
    frames.push({ width, height, data: pixels.slice() }); delays.push(Math.max(20, (image.gce?.delay || 10) * 10)); previous = frame
    if (frames.length % 8 === 0) await yieldFrame()
  }
  const extension: any = gif.frames.find((f: any) => /NETSCAPE|ANIMEXTS/.test(f.application?.id || ''))
  const blocks = extension?.application?.blocks
  return { frames, delays, repeat: blocks?.[0] === 1 ? (blocks[1] | blocks[2] << 8) : -1 }
}

export async function encodeGif(animation: GifAnimation, render: (source: RasterImage) => RasterImage, signal?: AbortSignal, progress?: (percent: number) => void) {
  const gif = GIFEncoder()
  for (let i = 0; i < animation.frames.length; i++) {
    check(signal)
    const frame = render(animation.frames[i])
    if (frame.width * frame.height * animation.frames.length > 48_000_000) throw new Error('输出 GIF 过大，请缩小输出尺寸')
    const palette = quantize(frame.data, 255, { format: 'rgba4444', oneBitAlpha: true })
    let transparentIndex = palette.findIndex((color: number[]) => color[3] === 0)
    if (transparentIndex < 0) { transparentIndex = palette.length; palette.push([0, 0, 0, 0]) }
    const indexed = applyPalette(frame.data, palette, 'rgba4444')
    gif.writeFrame(indexed, frame.width, frame.height, { palette, delay: animation.delays[i], repeat: animation.repeat,
      transparent: true, transparentIndex, dispose: 2 })
    progress?.(Math.round((i + 1) / animation.frames.length * 100)); await yieldFrame()
  }
  check(signal); gif.finish()
  return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' })
}
