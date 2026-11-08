const MAX_POSTERS = 60
const posters = new Map<string, string>()
let active = 0
const queue: (() => void)[] = []

function capture(url: string, signal: AbortSignal) {
  return new Promise<string>(resolve => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    const finish = (poster = '') => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', stop)
      video.onloadeddata = video.onerror = null
      video.removeAttribute('src')
      video.load()
      resolve(poster)
    }
    const stop = () => finish()
    const timeout = setTimeout(stop, 8000)
    signal.addEventListener('abort', stop, { once: true })
    video.onerror = stop
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 384 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.78))
      } catch { finish() }
    }
    video.src = url
  })
}

export function videoPoster(url: string, signal: AbortSignal) {
  const cached = posters.get(url)
  if (cached) { posters.delete(url); posters.set(url, cached); return Promise.resolve(cached) }
  return new Promise<string>(resolve => {
    const start = async () => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted) { resolve(''); return }
      active++
      try {
        const poster = posters.get(url) || await capture(url, signal)
        if (poster && !signal.aborted) {
          posters.set(url, poster)
          if (posters.size > MAX_POSTERS) {
            const oldest = posters.keys().next().value
            if (oldest !== undefined) posters.delete(oldest)
          }
        }
        resolve(poster)
      } finally { active--; queue.shift()?.() }
    }
    const cancel = () => {
      const index = queue.indexOf(start)
      if (index >= 0) queue.splice(index, 1)
      resolve('')
    }
    if (signal.aborted) resolve('')
    else if (active < 2) void start()
    else { queue.push(start); signal.addEventListener('abort', cancel, { once: true }) }
  })
}
