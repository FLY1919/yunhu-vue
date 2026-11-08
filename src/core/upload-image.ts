/** Preserve image bytes while making storage suffix/MIME agree with the actual file. */
export function imageSignature(bytes: Uint8Array): { ext: string; mime: string } | undefined {
  const s = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (s(0, 8) === '\x89PNG\r\n\x1a\n') return { ext: 'png', mime: 'image/png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ext: 'jpg', mime: 'image/jpeg' }
  if (/^GIF8[79]a$/.test(s(0, 6))) return { ext: 'gif', mime: 'image/gif' }
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
}
export async function normalizeImageUpload(file: File) {
  const format = imageSignature(new Uint8Array(await file.slice(0, 32).arrayBuffer()))
  if (!format) return file
  const name = (file.name.replace(/\.[^.]*$/, '') || 'image') + '.' + format.ext
  return file.type === format.mime && file.name === name ? file : new File([file], name, { type: format.mime, lastModified: file.lastModified })
}
export function messageImageKey(value: string) {
  let key = String(value || '').trim()
  if (/^\/res\/[^/]+\//.test(key)) key = key.replace(/^\/res\/[^/]+\//, '')
  else key = key.replace(/^https?:\/\/[^/]+\//i, '')
  if (!key || /^(?:blob|data):/i.test(key) || /[?#\\\r\n]/.test(key)) throw new Error('图片地址无效，请重新上传原图')
  return key.replace(/^\/+/, '')
}
