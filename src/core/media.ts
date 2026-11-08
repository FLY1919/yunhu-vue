import { shallowReactive } from 'vue'
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

interface DownloadProgress { received: number; total: number; choosing?: boolean }
const downloads = shallowReactive(new Map<string, DownloadProgress>())
const downloadKey = (url: string, name: string) => JSON.stringify([url, name])

export function fileDownloadProgress(url: string, name: string) { return downloads.get(downloadKey(url, name)) }
export function mediaDownloadProgress(el: any) {
  if (!el.attrs?.src) return undefined
  const { url, name } = mediaDownload(el)
  return fileDownloadProgress(url, name)
}
export function downloadLabel(progress: DownloadProgress | undefined, idle: string) {
  if (!progress) return idle
  if (progress.choosing) return '选择保存位置…'
  if (progress.total) return `下载中 ${Math.min(100, Math.floor(progress.received / progress.total * 100))}%`
  if (!progress.received) return '正在下载…'
  return `已下载 ${(progress.received / 1048576).toFixed(1)} MB`
}
export async function downloadFile(url: string, name: string, token?: string) {
  if (!(window as any).__TAURI__?.core?.invoke) {
    const link = document.createElement('a')
    link.href = url; link.download = name; link.click()
    return
  }
  const key = downloadKey(url, name)
  if (downloads.has(key)) return
  downloads.set(key, { received: 0, total: 0 })
  try {
    const query = new URLSearchParams({ url, name })
    const response = await fetch('/local-download?' + query, { method: 'POST', headers: { token: token || '' } })
    if (!response.ok || !response.body) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.msg || '下载失败 HTTP ' + response.status)
    }
    let buffer = ''
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error('下载连接提前结束')
        buffer += value
        let lineEnd: number
        while ((lineEnd = buffer.indexOf('\n')) >= 0) {
          const update = JSON.parse(buffer.slice(0, lineEnd))
          buffer = buffer.slice(lineEnd + 1)
          if (update.ok === true) return update.cancelled ? undefined : String(update.path)
          if (update.ok === false) throw new Error(update.msg)
          downloads.set(key, update.choosing ? { choosing: true, received: 0, total: 0 }
            : { received: update.received, total: update.total })
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } finally { downloads.delete(key) }
}

export function downloadMedia(el: any, token?: string) {
  const { url, name } = mediaDownload(el)
  return downloadFile(url, name, token)
}
