export interface MediaDevicePreferences {
  microphone: string
  camera: string
  speaker: string
}

const preferenceKey = 'yh.media.devices'
export const mediaPreferencesEvent = 'yh-media-preferences'

export function readMediaPreferences(): MediaDevicePreferences {
  const defaults = { microphone: '', camera: '', speaker: '' }
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}')
    for (const key of Object.keys(defaults) as Array<keyof MediaDevicePreferences>) {
      if (typeof saved?.[key] === 'string') defaults[key] = saved[key]
    }
  } catch { /* Local preferences are optional. */ }
  return defaults
}

export function saveMediaPreferences(value: MediaDevicePreferences) {
  try { localStorage.setItem(preferenceKey, JSON.stringify(value)) } catch { /* Storage can be blocked. */ }
  window.dispatchEvent(new CustomEvent(mediaPreferencesEvent, { detail: value }))
}

export function inputDevice(id: string): MediaTrackConstraints | true {
  return id ? { deviceId: { exact: id } } : true
}

/** Existing chat recorders use the saved physical devices, with a fallback if one was unplugged. */
export async function getChatRecordingStream(video: boolean) {
  const { microphone, camera } = readMediaPreferences()
  const devices = navigator.mediaDevices
  try {
    return await devices.getUserMedia({ audio: inputDevice(microphone), video: video && inputDevice(camera) })
  } catch (error) {
    if (!(microphone || (video && camera)) || !['NotFoundError', 'OverconstrainedError'].includes((error as Error)?.name)) throw error
    const available = await devices.enumerateDevices()
    return devices.getUserMedia({
      audio: inputDevice(available.some(d => d.kind === 'audioinput' && d.deviceId === microphone) ? microphone : ''),
      video: video && inputDevice(available.some(d => d.kind === 'videoinput' && d.deviceId === camera) ? camera : ''),
    })
  }
}

export function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop())
}

type SinkElement = HTMLMediaElement & { sinkId?: string; setSinkId?: (id: string) => Promise<void> }

/** Returns false when playback falls back to the system output. */
export async function routeMediaOutput(element: SinkElement, id: string) {
  if (!element.setSinkId) return !id
  if ((element.sinkId ?? '') === id) return true
  try {
    await element.setSinkId(id)
    return true
  } catch {
    if (!id) throw new Error('无法切换到系统默认输出')
    if (element.sinkId) await element.setSinkId('')
    return false
  }
}

export function routeChatMedia(event: Event) {
  void routeMediaOutput(event.currentTarget as HTMLMediaElement, readMediaPreferences().speaker).catch(() => {})
}

export function mediaError(error: unknown, source: 'device' | 'display' | 'output' = 'device') {
  const name = (error as Error)?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    if (source === 'display') return '未授权桌面采集，或已取消选择。'
    if (source === 'output') return '未授权访问此扬声器，或已取消选择。'
    return '设备权限未获允许，请检查系统隐私设置和应用的设备权限。'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '找不到可用设备或来源，请检查连接后重试。'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return '无法启动设备或来源，可能正被占用或被系统限制。'
  if (name === 'OverconstrainedError') return '设备已不可用，或不支持所选画质。'
  if (name === 'InvalidStateError') return '请在当前窗口处于前台时重新操作。'
  if (name === 'NotSupportedError') return '当前运行环境不支持此项媒体操作。'
  return (error as Error)?.message || '媒体操作失败，请重试。'
}

/** Offer capture limits within the selected source's reported range, preserving aspect ratio. */
export function displayProfiles(track: MediaStreamTrack) {
  const settings = track.getSettings()
  const caps = track.getCapabilities?.() ?? {}
  const width = settings.width || caps.width?.max || 0
  const height = settings.height || caps.height?.max || 0
  const maxWidth = Math.min(width, caps.width?.max ?? width)
  const maxHeight = Math.min(height, caps.height?.max ?? height)
  const resolutions = [360, 540, 720, 1080, 1440, 2160].flatMap(h => {
    const w = Math.round(width / height * h / 2) * 2
    return width && height && h >= (caps.height?.min || 1) && w >= (caps.width?.min || 1)
      && h <= maxHeight && w <= maxWidth ? [{ width: w, height: h }] : []
  })
  const frames = [5, 10, 15, 24, 30, 60].filter(fps =>
    fps >= (caps.frameRate?.min || 1) && fps <= (caps.frameRate?.max || settings.frameRate || 0))
  return { resolutions, frames }
}

export function makeSpeakerTone() {
  const rate = 16_000
  const samples = rate * 0.65
  const wave = new DataView(new ArrayBuffer(44 + samples * 2))
  const label = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wave.setUint8(offset + i, text.charCodeAt(i))
  }
  label(0, 'RIFF')
  wave.setUint32(4, 36 + samples * 2, true)
  label(8, 'WAVEfmt ')
  wave.setUint32(16, 16, true)
  wave.setUint16(20, 1, true)
  wave.setUint16(22, 1, true)
  wave.setUint32(24, rate, true)
  wave.setUint32(28, rate * 2, true)
  wave.setUint16(32, 2, true)
  wave.setUint16(34, 16, true)
  label(36, 'data')
  wave.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    const envelope = Math.min(1, t * 40, (samples / rate - t) * 9)
    wave.setInt16(44 + i * 2, Math.sin(t * Math.PI * 2 * (t < 0.27 ? 523 : 659)) * 4200 * envelope, true)
  }
  return new Blob([wave.buffer], { type: 'audio/wav' })
}
