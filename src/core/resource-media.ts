import { watch, type ObjectDirective } from 'vue'
import { resourceMode } from './resource-mode'
interface Options { src: string; animated?: boolean; width?: number; height?: number }
interface Entry { el: HTMLImageElement | HTMLMediaElement; options: Options; near: boolean; hover: boolean; preview: string; time: number; root: Element | null; cleanup: () => void }
const entries = new Map<Element, Entry>()
const pools = new Map<Element | null, { observer: IntersectionObserver; count: number }>()
let minimized = false, locked = false, focused = true, listening = false
const blank = (w: number, h: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`)}`
function rememberSize(el: HTMLImageElement, width?: number, height?: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) return
  el.style.setProperty('--media-natural-width', `${width}px`)
  el.style.setProperty('--media-fit-width', `${460 * width! / height!}px`)
  // The real resource wins over stale protocol dimensions; keep these bounds for stills/release.
  el.style.aspectRatio = `auto ${width} / ${height}`
}
function snapshot(entry: Entry) {
  const img = entry.el as HTMLImageElement
  if (entry.preview || !img.complete || !img.naturalWidth || img.getAttribute('src') !== entry.options.src) return
  try {
    const canvas = document.createElement('canvas'), scale = Math.min(1, 192 / Math.max(img.naturalWidth, img.naturalHeight))
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    entry.preview = canvas.toDataURL('image/webp', .8)
    // Preserve the original aspect ratio when the source becomes a bounded still preview.
    img.width = img.naturalWidth; img.height = img.naturalHeight
    canvas.width = canvas.height = 0
  } catch { /* Cross-origin images keep normal rendering; offscreen release still works. */ }
}
function update(entry: Entry) {
  const { el, options } = entry, economy = resourceMode.economy
  const audioPlaying = el instanceof HTMLAudioElement && !el.paused && !el.ended && !locked
  const active = !economy || audioPlaying || (entry.near && !document.hidden && !minimized && !locked)
  if (el instanceof HTMLImageElement) {
    if (active && economy && options.animated && (!entry.hover || !focused)) snapshot(entry)
    const source = !active ? blank(Number(el.getAttribute('width')) || options.width || 160, Number(el.getAttribute('height')) || options.height || 120)
      : economy && options.animated && (!entry.hover || !focused) && entry.preview ? entry.preview : options.src
    if (el.getAttribute('src') !== source) el.setAttribute('src', source)
    el.dataset.mediaState = !active ? 'released' : source === options.src ? 'source' : 'preview'
  } else {
    if (active) {
      if (el.getAttribute('src') !== options.src) el.setAttribute('src', options.src)
    } else if (el.hasAttribute('src')) {
      entry.time = el.currentTime || 0; el.pause(); el.removeAttribute('src'); el.load()
    }
    el.dataset.mediaState = active ? 'source' : 'released'
  }
}
function refresh() { for (const entry of entries.values()) update(entry) }
const onVisibility = () => refresh()
const onMinimized = (e: Event) => { minimized = (e as CustomEvent).detail === true; refresh() }
const onLocked = (e: Event) => { locked = (e as CustomEvent).detail === true; refresh() }
const onFocus = () => { focused = true; refresh() }
const onBlur = () => { focused = false; refresh() }
const onNativeFocus = (e: Event) => { focused = (e as CustomEvent).detail === true; refresh() }
function listen(enable: boolean) {
  if (listening === enable) return
  listening = enable
  const method = enable ? 'addEventListener' : 'removeEventListener'
  document[method]('visibilitychange', onVisibility)
  window[method]('yh-window-minimized', onMinimized); window[method]('yh-media-locked', onLocked)
  window[method]('focus', onFocus); window[method]('blur', onBlur); window[method]('yh-window-focused', onNativeFocus)
}
watch(() => resourceMode.economy, refresh)
export const vResourceMedia: ObjectDirective<HTMLImageElement | HTMLMediaElement, Options> = {
  beforeMount(el, { value }) {
    if (el instanceof HTMLImageElement) { rememberSize(el, value.width, value.height); el.src = blank(value.width || 160, value.height || 120) }
    else el.preload = 'none'
  },
  mounted(el, { value }) {
    const root = el.closest('.messages'), entry: Entry = { el, options: value, near: false, hover: false, preview: '', time: 0, root, cleanup: () => {} }
    entries.set(el, entry); listen(true)
    const load = () => { if (el instanceof HTMLImageElement && el.getAttribute('src') === entry.options.src) { if (el.naturalWidth) { el.width = el.naturalWidth; el.height = el.naturalHeight; rememberSize(el, el.naturalWidth, el.naturalHeight) } update(entry) } }
    const enter = () => { entry.hover = true; update(entry) }, leave = () => { entry.hover = false; update(entry) }
    const metadata = () => { if (entry.time && el instanceof HTMLMediaElement) { try { el.currentTime = entry.time } catch {} } }
    el.addEventListener('load', load); el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave); el.addEventListener('loadedmetadata', metadata)
    entry.cleanup = () => { el.removeEventListener('load', load); el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); el.removeEventListener('loadedmetadata', metadata) }
    if (typeof IntersectionObserver === 'function') {
      let pool = pools.get(root)
      if (!pool) {
        const observer = new IntersectionObserver(changes => { for (const change of changes) { const e = entries.get(change.target); if (e) { e.near = change.isIntersecting; update(e) } } }, { root, rootMargin: '240px 0px' })
        pool = { observer, count: 0 }; pools.set(root, pool)
      }
      pool.count++; pool.observer.observe(el)
    } else entry.near = true
    update(entry)
  },
  updated(el, { value }) {
    const entry = entries.get(el); if (!entry) return
    if (entry.options.src !== value.src) {
      entry.preview = ''; entry.time = 0
      if (el instanceof HTMLImageElement) {
        el.removeAttribute('width'); el.removeAttribute('height')
        el.style.removeProperty('--media-natural-width'); el.style.removeProperty('--media-fit-width'); el.style.removeProperty('aspect-ratio')
        rememberSize(el, value.width, value.height)
      }
    }
    entry.options = value; update(entry)
  },
  beforeUnmount(el) {
    const entry = entries.get(el); if (!entry) return
    entry.cleanup(); entries.delete(el)
    const pool = pools.get(entry.root)
    pool?.observer.unobserve(el)
    if (pool && --pool.count === 0) { pool.observer.disconnect(); pools.delete(entry.root) }
    if (el instanceof HTMLMediaElement) { el.pause(); el.removeAttribute('src'); el.load() }
    if (!entries.size) { listen(false); minimized = locked = false; focused = true }
  },
}
