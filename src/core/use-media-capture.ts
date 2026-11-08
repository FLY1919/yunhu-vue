import { ref, shallowRef } from 'vue'
import { stopMediaStream } from './media-devices'

/** Own one stream. Any grant that arrives after stop is released before it can reach the preview. */
export function useMediaCapture(onStop: () => void) {
  const stream = shallowRef<MediaStream | null>(null)
  const pending = ref(false)
  let generation = 0
  let removeEnded: (() => void) | undefined

  function stop() {
    generation++
    removeEnded?.()
    removeEnded = undefined
    const previous = stream.value
    stream.value = null
    stopMediaStream(previous)
    onStop()
  }

  async function start(open: () => Promise<MediaStream>, onEnded: () => void, validate?: (stream: MediaStream) => void) {
    if (pending.value) return null
    stop()
    const request = generation
    pending.value = true
    let acquired: MediaStream | null = null
    try {
      acquired = await open()
      if (request !== generation) return null
      validate?.(acquired)
      const tracks = acquired.getTracks()
      if (!tracks.length || tracks.some(track => track.readyState === 'ended')) {
        throw new DOMException('采集来源已停止。', 'NotReadableError')
      }
      const ended = () => { stop(); onEnded() }
      tracks.forEach(track => track.addEventListener('ended', ended, { once: true }))
      removeEnded = () => tracks.forEach(track => track.removeEventListener('ended', ended))
      stream.value = acquired
      acquired = null
      return stream.value
    } catch (error) {
      if (request === generation) throw error
      return null
    } finally {
      stopMediaStream(acquired)
      pending.value = false
    }
  }

  return { stream, pending, start, stop }
}
