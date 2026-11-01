import { mediaUrl } from './res'

/** Decode only for dimensions; release the local URL on every completion path. */
export function imageMetadata(file: File): Promise<{ width: number; height: number }> {
  if (typeof Image !== 'function') return Promise.resolve({ width: 0, height: 0 })
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), image = new Image()
    let finished = false
    const done = () => {
      if (finished) return
      finished = true; clearTimeout(timer)
      const width = image.naturalWidth || 0, height = image.naturalHeight || 0
      image.onload = image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url)
      resolve({ width, height })
    }
    const timer = setTimeout(done, 5000)
    image.onload = image.onerror = done; image.src = url
  })
}

export function mediaMetadata(file: File, kind: 'audio' | 'video'): Promise<{ time: number; width?: number; height?: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const media = document.createElement(kind)
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const duration = media.duration
      const video = media as HTMLVideoElement
      resolve({ time: Number.isFinite(duration) && duration > 0 ? Math.ceil(duration) : 1,
        ...(kind === 'video' ? { width: video.videoWidth || 0, height: video.videoHeight || 0 } : {}) })
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
    }
    const timer = setTimeout(done, 5000)
    media.preload = 'metadata'
    media.onloadedmetadata = media.onerror = done
    media.src = url
  })
}

/** Warm the decoded bitmap before closing the editor or releasing the old preview. */
export async function decodedImageUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file), image = new Image()
  try { image.src = url; await image.decode(); return url }
  catch (error) { URL.revokeObjectURL(url); throw error }
  finally { image.removeAttribute('src') }
}

function mediaDownload(el: any) {
  const kind = el.type === 'video' ? 'video' : el.type === 'audio' ? 'audio' : el.type === 'img' || el.type === 'sticker' ? 'image' : 'file'
  const url = mediaUrl(el.attrs.src, kind)
  if (!url) throw new Error('消息没有可下载的地址')
  let basename = String(el.attrs.name || url.split('?')[0].split('/').pop() || kind)
  try { basename = decodeURIComponent(basename) } catch { /* malformed remote filename */ }
  const name = basename.replace(/[\\/:*?"<>|]/g, '_')
  return { url, name }
}

/** Always use the local service: a browser save picker cannot reveal a file in Explorer. */
export async function revealMedia(el: any) {
  const { url, name } = mediaDownload(el)
  const response = await fetch('/local-open?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(name))
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) throw new Error(result?.msg || '打开文件位置失败 HTTP ' + response.status)
}

export async function downloadMedia(el: any) {
  const { url, name } = mediaDownload(el)
  const w = window as any
  if (typeof w.showSaveFilePicker === 'function') {
    // The picker requires the original click gesture; fetch must happen after it opens.
    const handle = await w.showSaveFilePicker({ suggestedName: name })
    const response = await fetch(url)
    if (!response.ok) throw new Error('下载失败 HTTP ' + response.status)
    const writer = await handle.createWritable()
    try { await writer.write(await response.blob()); await writer.close() }
    catch (error) { await writer.abort().catch(() => {}); throw error }
    return
  }
  await revealMedia(el)
}
