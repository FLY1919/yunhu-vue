import { shallowRef } from 'vue'

export const floatingVideo = shallowRef<{
  src: string; time: number; playing: boolean; muted: boolean; volume: number; rate: number
} | null>(null)

export async function toggleVideoPip(video: HTMLVideoElement) {
  if (document.pictureInPictureElement === video) {
    await document.exitPictureInPicture()
    return 'closed'
  }
  const src = video.currentSrc || video.src
  if (floatingVideo.value?.src === src) {
    floatingVideo.value = null
    return 'closed'
  }
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    try {
      await video.requestPictureInPicture()
      floatingVideo.value = null
      return 'native'
    } catch { /* Embedded WebViews may reject system picture-in-picture. */ }
  }
  if (!src) throw new Error('视频地址不可用')
  floatingVideo.value = { src, time: video.currentTime, playing: !video.paused,
    muted: video.muted, volume: video.volume, rate: video.playbackRate }
  video.pause()
  return 'floating'
}
