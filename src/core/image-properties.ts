/** Container-only EXIF removal; keep compressed image, animation and ICC chunks intact. */
import { imageMetadata } from './media'
export type ImageFormat = 'JPEG' | 'PNG' | 'WebP' | 'GIF' | 'TIFF' | '其他'
interface Part { start: number; end: number; kind: string; data: Uint8Array }
export interface ImageProperties {
  format: ImageFormat; mime: string; width: number; height: number; size: number
  exif: Record<string, any>; metadata: Record<string, any>; hasExif: boolean; orientation: number; animated: boolean
  canClean: boolean; parseError: string; metadataError: string
}
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
const invalid = () => { throw new Error('图片数据不完整或结构损坏，无法安全清除 EXIF') }
function inspect(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parts: Part[] = [], exif: Uint8Array[] = []
  let format: ImageFormat = '其他', animated = false
  const add = (start: number, end: number, kind: string, dataStart: number, dataEnd = end) => {
    if (end > bytes.length || end <= start) invalid()
    const part = { start, end, kind, data: bytes.subarray(dataStart, dataEnd) }; parts.push(part)
    if (kind === 'EXIF') exif.push(part.data)
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'JPEG'; let p = 2
    while (p < bytes.length) {
      const start = p
      if (bytes[p++] !== 0xff) invalid()
      while (bytes[p] === 0xff) p++
      const marker = bytes[p++]
      if (marker === 0xda || marker === 0xd9) break // entropy-coded scan is copied byte-for-byte
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (p + 2 > bytes.length) invalid()
      const length = view.getUint16(p), end = p + length
      if (length < 2) invalid()
      const isExif = marker === 0xe1 && ascii(bytes, p + 2, 6) === 'Exif\0\0'
      add(start, end, isExif ? 'EXIF' : 'keep', p + 2); p = end
    }
  } else if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    format = 'PNG'; let p = 8, ended = false
    while (p + 12 <= bytes.length) {
      const length = view.getUint32(p), kind = ascii(bytes, p + 4, 4), end = p + 12 + length
      add(p, end, kind === 'eXIf' ? 'EXIF' : kind, p + 8, end - 4)
      if (kind === 'acTL') animated = true
      p = end
      if (kind === 'IEND') { ended = true; break }
    }
    if (!ended) invalid()
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    format = 'WebP'
    if (bytes.length < 12 || view.getUint32(4, true) + 8 !== bytes.length) invalid()
    let p = 12
    while (p + 8 <= bytes.length) {
      const length = view.getUint32(p + 4, true), kind = ascii(bytes, p, 4), end = p + 8 + length + (length % 2)
      add(p, end, kind, p + 8, p + 8 + length)
      if (kind === 'ANIM' || kind === 'ANMF') animated = true
      p = end
    }
    if (p !== bytes.length) invalid()
  } else if (/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) { format = 'GIF'; animated = true }
  else if (ascii(bytes, 0, 4) === 'II*\0' || ascii(bytes, 0, 4) === 'MM\0*') { format = 'TIFF'; exif.push(bytes) }
  return { format, parts, exif, animated }
}
const mimeOf = (format: ImageFormat) => ({ JPEG: 'image/jpeg', PNG: 'image/png', WebP: 'image/webp', GIF: 'image/gif', TIFF: 'image/tiff' }[format] || '')
export async function readImageProperties(file: File): Promise<ImageProperties> {
  if (!file.size) throw new Error('图片内容为空')
  const bytes = new Uint8Array(await file.arrayBuffer()), info = inspect(bytes)
  const exif: Record<string, any> = {}; let orientation = 1, parseError = '', metadataError = ''
  const parser = await import('exifr')
  if (info.exif.length) {
    for (const block of info.exif) {
      try {
        const tiff = ascii(block, 0, 6) === 'Exif\0\0' ? block.subarray(6) : block
        const tags = await parser.parse(tiff, { tiff: true, ifd0: {}, ifd1: true, exif: true, gps: true, interop: true, makerNote: true, userComment: true, mergeOutput: false, translateValues: false, sanitize: false })
        if (!tags || tags.errors?.length) throw new Error('EXIF 结构无法完整解析')
        Object.assign(exif, tags)
        const raw = tags.ifd0?.Orientation
        if (raw != null) { if (raw < 1 || raw > 8) throw new Error('方向信息无效'); orientation = raw }
      } catch { parseError = '无' }
    }
  }
  // Read the whole container as well: XMP/IPTC/ICC are outside the TIFF/EXIF block.
  // Keep these separate from hasExif, which guards the lossless EXIF-only removal.
  const metadata = { ...exif }
  if (['JPEG', 'PNG', 'WebP', 'TIFF'].includes(info.format)) {
    try {
      const other = await parser.parse(bytes, { tiff: false, xmp: { multiSegment: true }, iptc: true, icc: { multiSegment: true }, mergeOutput: false, translateValues: false, sanitize: false })
      if (other) Object.assign(metadata, other)
      if (other?.errors?.length) metadataError = '部分扩展元数据无法解析，已保留可读取字段。'
    } catch { metadataError = '部分扩展元数据无法解析，已保留可读取的 EXIF 字段。' }
  }
  const typed = new File([file], file.name, { type: mimeOf(info.format) || file.type })
  const size = await imageMetadata(typed)
  return { format: info.format, mime: typed.type || 'application/octet-stream', ...size, size: file.size,
    exif, metadata, hasExif: info.exif.length > 0, orientation, animated: info.animated,
    canClean: ['JPEG', 'PNG', 'WebP', 'GIF'].includes(info.format), parseError, metadataError }
}
/** Pure container rewrite; all non-EXIF bytes, including animation, remain unchanged. */
export function stripExifBytes(bytes: Uint8Array): Uint8Array {
  const info = inspect(bytes)
  if (info.format === 'GIF') return bytes.slice() // GIF has no standard EXIF; retain every animation byte.
  if (!['JPEG', 'PNG', 'WebP'].includes(info.format)) throw new Error('此格式暂不支持安全清除 EXIF')
  const removed = info.parts.filter(p => p.kind === 'EXIF')
  if (!removed.length && info.format !== 'WebP') return bytes.slice()
  const result = new Uint8Array(bytes.length - removed.reduce((n, p) => n + p.end - p.start, 0))
  let from = 0, to = 0
  for (const part of removed) { result.set(bytes.subarray(from, part.start), to); to += part.start - from; from = part.end }
  result.set(bytes.subarray(from), to)
  if (info.format === 'WebP') {
    new DataView(result.buffer).setUint32(4, result.length - 8, true)
    const vp8x = inspect(result).parts.find(p => p.kind === 'VP8X')
    if (vp8x) result[vp8x.start + 8] &= ~8 // EXIF-present bit, RFC 9649
  }
  return result
}
export async function clearImageExif(file: File): Promise<File> {
  const info = await readImageProperties(file)
  if (!info.canClean) throw new Error('此格式暂不支持安全清除 EXIF；原文件保持不变')
  let blob: Blob
  if (info.orientation !== 1 || info.parseError && !info.animated) {
    if (info.animated) throw new Error('该动图含旋转方向信息，暂不支持在保留动画的同时清除 EXIF')
    // Browsers apply all 8 EXIF orientations while decoding; bake the visible pixels into lossless PNG.
    const url = URL.createObjectURL(file), image = new Image()
    try {
      image.src = url; await image.decode()
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('图片过大，无法安全校正方向，请先缩小图片')
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d'); if (!context) throw new Error('无法创建图片画布')
      context.drawImage(image, 0, 0)
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片导出失败')), 'image/png'))
      canvas.width = canvas.height = 0
    } finally { image.removeAttribute('src'); URL.revokeObjectURL(url) }
  } else blob = new Blob([stripExifBytes(new Uint8Array(await file.arrayBuffer())) as BlobPart], { type: info.mime })
  const extension = blob.type === 'image/png' ? 'png' : info.format === 'JPEG' ? 'jpg' : info.format === 'GIF' ? 'gif' : 'webp'
  const name = (file.name.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'image') + '_no-exif.' + extension
  const output = new File([blob], name, { type: blob.type })
  const verified = await readImageProperties(output)
  if (verified.hasExif || !verified.width || !verified.height) throw new Error('清除后的图片校验失败，原文件保持不变')
  return output
}
export const exifLabels: Record<string, string> = {
  CreatorTool: '软件', ProcessingSoftware: '处理软件', Make: '制造商', Model: '设备型号', Software: '软件', DateTimeOriginal: '拍摄时间', CreateDate: '数字化时间', ModifyDate: '修改时间',
  Orientation: '方向', ExposureTime: '曝光时间（秒）', FNumber: '光圈', ISO: 'ISO 感光度', FocalLength: '焦距（mm）', LensModel: '镜头型号',
  GPSLatitude: 'GPS 纬度', GPSLatitudeRef: '纬度方向', GPSLongitude: 'GPS 经度', GPSLongitudeRef: '经度方向', GPSAltitude: '海拔',
  Artist: '作者', Copyright: '版权', ImageDescription: '描述', UserComment: '用户备注', MakerNote: '厂商数据',
}
export function propertyValue(value: any, full = false): string {
  if (value == null || typeof value === 'number' && !Number.isFinite(value)) return '无'
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toLocaleString() : '无'
  if (ArrayBuffer.isView(value)) {
    if (!full && value.byteLength > 256) return `[${value.byteLength.toLocaleString()} 字节二进制数据，展开查看原始内容]`
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), n => n.toString(16).padStart(2, '0')).join(' ')
  }
  if (Array.isArray(value)) return value.length ? value.map(v => propertyValue(v, full)).join(', ') : '无'
  if (value && typeof value === 'object') { try { return JSON.stringify(value, null, 2) || '无' } catch { return '无' } }
  return String(value).replace(/\0/g, '').trim() || '无'
}
const gpsDirections: Record<string, string> = { N: '北纬', S: '南纬', E: '东经', W: '西经' }
function gpsValue(key: string, value: any, siblings: Record<string, any>) {
  if (/^GPS(Latitude|Longitude)Ref$/.test(key)) return gpsDirections[String(value).replace(/\0/g, '').trim().toUpperCase()] || '无'
  if (!/^(GPSLatitude|GPSLongitude|latitude|longitude)$/.test(key)) return propertyValue(value)
  const latitude = /latitude/i.test(key), limit = latitude ? 90 : 180
  const dms = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<number>) : null
  const decimal = dms ? Number(dms[0]) + Number(dms[1]) / 60 + Number(dms[2]) / 3600 : Number(value)
  if (value == null || value === '' || !Number.isFinite(decimal) || Math.abs(decimal) > limit || dms && (dms.length !== 3 || dms.some(n => !Number.isFinite(n) || n < 0) || dms[1] >= 60 || dms[2] >= 60)) return '无'
  const ref = String(siblings[latitude ? 'GPSLatitudeRef' : 'GPSLongitudeRef'] || '').replace(/\0/g, '').trim().toUpperCase()
  const validRef = latitude ? /^[NS]$/.test(ref) : /^[EW]$/.test(ref)
  const direction = validRef ? gpsDirections[ref] : !dms ? gpsDirections[latitude ? decimal < 0 ? 'S' : 'N' : decimal < 0 ? 'W' : 'E'] : ''
  const coordinate = dms ? `${dms[0]}° ${dms[1]}′ ${Number(dms[2].toFixed(4))}″` : `${Number(Math.abs(decimal).toFixed(7))}°`
  return direction ? `${direction} ${coordinate}` : `${coordinate}（方向：无）`
}
function decodeExifComment(value: any) {
  if (!ArrayBuffer.isView(value)) return value
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength), charset = ascii(bytes, 0, 8)
  try {
    if (charset.startsWith('ASCII')) return new TextDecoder().decode(bytes.subarray(8)).replace(/\0+$/, '')
    if (charset.startsWith('UNICODE')) return new TextDecoder(bytes[8] === 0xfe || bytes[8] === 0 && bytes[9] !== 0 ? 'utf-16be' : 'utf-16le').decode(bytes.subarray(8)).replace(/\0+$/, '')
    if (charset.startsWith('JIS')) return new TextDecoder('shift_jis').decode(bytes.subarray(8)).replace(/\0+$/, '')
  } catch { /* Keep original bytes when the declared encoding cannot be decoded. */ }
  return value
}
export function imagePropertyRows(metadata: Record<string, any>) {
  const rows: { group: string; key: string; label: string; value: string; raw: any }[] = []
  function visit(value: any, path: string[], siblings: Record<string, any> = {}) {
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
      for (const [key, child] of Object.entries(value)) if (key !== 'errors') visit(child, [...path, key], value)
    } else {
      const key = path.at(-1) || '', group = path.slice(0, -1).join('.')
      if (key === 'UserComment') value = decodeExifComment(value)
      rows.push({ group, key, label: exifLabels[key] || key, value: gpsValue(key, value, siblings), raw: value })
    }
  }
  visit(metadata, [])
  const priority = (key: string) => key === 'Model' ? 0 : /^(Software|CreatorTool|ProcessingSoftware)$/.test(key) ? 1
    : /^(GPS|latitude|longitude)/i.test(key) ? 2 : key === 'Make' ? 3 : /Lens/.test(key) ? 4
    : /Date|Time/.test(key) ? 5 : 10
  return rows.sort((a, b) => priority(a.key) - priority(b.key))
}
