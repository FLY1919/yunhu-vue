export const shareResolutions = [720, 1080, 1440, 2160, 2880, 4320, 0]
export const shareFrameRates = [15, 24, 30, 60, 90, 120, 144, 165, 240, 0]
export const shareBitrates = [0, 2, 4, 6, 8, 12, 16, 24, 35, 50]
export const shareTrackName = 'yh-screen-share'
const key = 'yh.call.screen-share'

export interface ScreenShareProfile {
  height: number
  fps: number
  mbps: number
}

export function readScreenShareProfile(): ScreenShareProfile {
  let value: Partial<ScreenShareProfile> = {}
  try { value = JSON.parse(localStorage.getItem(key) || '{}') ?? {} } catch {}
  return {
    height: shareResolutions.includes(value.height) ? value.height : 1080,
    fps: shareFrameRates.includes(value.fps) ? value.fps : 30,
    mbps: shareBitrates.includes(value.mbps) ? value.mbps : 0,
  }
}

export function saveScreenShareProfile(profile: ScreenShareProfile) {
  try { localStorage.setItem(key, JSON.stringify(profile)) } catch {}
}

export function shareCaptureRequest(profile: ScreenShareProfile): MediaTrackConstraints {
  return {
    ...(profile.height ? { height: { ideal: profile.height } } : {}),
    frameRate: { ideal: profile.fps || 240 },
  }
}

export function shareConstraints(profile: ScreenShareProfile): MediaTrackConstraints {
  return {
    ...(profile.height ? { height: { ideal: profile.height, max: profile.height } } : {}),
    frameRate: profile.fps ? { ideal: profile.fps, max: profile.fps } : { ideal: 240 },
  }
}

export function shareEncoding(profile: ScreenShareProfile, track: MediaStreamTrack) {
  const { width, height, frameRate } = track.getSettings()
  const pixels = width && height ? width * height : (profile.height || 1080) ** 2 * 16 / 9
  const fps = frameRate || profile.fps || 60
  const automaticMbps = Math.max(3, Math.min(35, Math.ceil(6 * pixels / (1920 * 1080) * Math.max(1, fps / 30))))
  return {
    maxBitrate: (profile.mbps || automaticMbps) * 1_000_000,
    maxFramerate: profile.fps ? Math.min(fps, profile.fps) : undefined,
  }
}

export async function tuneShareSender(sender: RTCRtpSender | undefined, encoding: ReturnType<typeof shareEncoding>) {
  const parameters = sender?.getParameters?.()
  if (!parameters?.encodings.length) return
  parameters.degradationPreference = 'maintain-resolution'
  for (const layer of parameters.encodings) {
    layer.maxBitrate = encoding.maxBitrate
    layer.maxFramerate = encoding.maxFramerate
  }
  await sender.setParameters(parameters)
}
