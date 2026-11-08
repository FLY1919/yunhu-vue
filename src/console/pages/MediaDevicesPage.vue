<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Icon from '../components/Icon.vue'
import KLayout from '../components/KLayout.vue'
import ScreenShareSettings from '../../components/ScreenShareSettings.vue'
import { displayProfiles, inputDevice, makeSpeakerTone, mediaError, readMediaPreferences, routeMediaOutput, saveMediaPreferences, stopMediaStream } from '../../core/media-devices'
import { useMediaCapture } from '../../core/use-media-capture'

const props = defineProps<{ active: boolean }>()
const ctx = inject<any>('ctx')
const devices = navigator.mediaDevices as (MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> }) | undefined
const canInput = !!devices?.getUserMedia
const canRecord = typeof MediaRecorder !== 'undefined'
const canDisplay = !!devices?.getDisplayMedia
const canOutput = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function'
const stunUrl = ref('')
const turnUrl = ref('')
const turnUser = ref('')
const turnPassword = ref('')
const relayMessage = ref('')
function saveCallNetwork(clear = false) {
  try {
    ctx.calls.setIceServers(clear ? '' : stunUrl.value.trim(), clear ? '' : turnUrl.value.trim(), turnUser.value.trim(), turnPassword.value)
    relayMessage.value = ctx.calls.state.iceConfigured ? '已应用到接下来的通话。' : '已恢复直连。'
    stunUrl.value = turnUrl.value = turnUser.value = turnPassword.value = ''
  } catch (error) { relayMessage.value = error?.message || '无法应用通话网络设置。' }
}
const prefs = readMediaPreferences()
const microphone = ref(prefs.microphone)
const camera = ref(prefs.camera)
const speaker = ref(prefs.speaker)
const permissionPending = ref<'camera' | 'microphone' | ''>('')
const permissionStatus = ref({ camera: '', microphone: '' })
const display = ref<'monitor' | 'window' | ''>('')
const list = shallowRef<MediaDeviceInfo[]>([])
const inputs = computed(() => options('audioinput', '麦克风'))
const cameras = computed(() => options('videoinput', '摄像头'))
const outputs = computed(() => options('audiooutput', '扬声器'))
const missing = (id: string, available: { id: string }[]) => !!id && !available.some(device => device.id === id)
const missingMic = computed(() => missing(microphone.value, inputs.value))
const missingCamera = computed(() => missing(camera.value, cameras.value))
const missingSpeaker = computed(() => missing(speaker.value, outputs.value))
const enumerationError = ref('')
const micError = ref('')
const videoError = ref('')
const outputError = ref('')
const level = ref(0)
const recording = ref(false)
const finalizing = ref(false)
const sample = shallowRef<Blob | null>(null)
const videoElement = ref<HTMLVideoElement>()
const audioElement = ref<HTMLAudioElement>()
const settings = shallowRef<MediaTrackSettings>({})
const profiles = shallowRef<ReturnType<typeof displayProfiles>>({ resolutions: [], frames: [] })
const resolution = ref('')
const frameRate = ref('')
const adjusting = ref(false)
const outputPicking = ref(false)
const routing = ref(false)
const playing = ref<'tone' | 'sample' | ''>('')
const locked = computed(() => !!ctx?.lock?.isLocked)
let minimized = false
let disposed = false
let enumerateRequest = 0
let playbackRequest = 0
let outputRequest = 0
let audioUrl = ''
let recorder: MediaRecorder | undefined
let recordingTimer: ReturnType<typeof setTimeout> | undefined
let meterContext: AudioContext | undefined
let meterTimer: ReturnType<typeof setInterval> | undefined
let tone: Blob | undefined

const mic = useMediaCapture(() => {
  clearInterval(meterTimer)
  if (meterContext) void meterContext.close().catch(() => {})
  meterContext = undefined
  level.value = 0
  cancelRecording()
})
const video = useMediaCapture(() => {
  if (videoElement.value) videoElement.value.srcObject = null
  settings.value = {}
  profiles.value = { resolutions: [], frames: [] }
  resolution.value = frameRate.value = ''
  adjusting.value = false
})
const { stream: micStream, pending: micPending } = mic
const { stream: videoStream, pending: videoPending } = video
const liveTrack = computed(() => videoStream.value?.getVideoTracks()[0])
const source = computed(() => display.value || camera.value)
const videoDescription = computed(() => {
  const { width, height, frameRate: fps } = settings.value
  return [width && height ? `${width} × ${height}` : '', fps ? `${Number(fps.toFixed(1))} 帧/秒` : ''].filter(Boolean).join(' · ')
})

function options(kind: MediaDeviceKind, fallback: string) {
  return list.value.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default')
    .map((device, i) => ({ id: device.deviceId, label: device.label || `${fallback} ${i + 1}` }))
}

function canStart() { return !disposed && props.active && !document.hidden && !minimized && !locked.value }

async function authorizeInput(device: 'camera' | 'microphone') {
  if (!canStart() || !canInput || permissionPending.value) return
  permissionPending.value = device
  permissionStatus.value[device] = ''
  const label = device === 'camera' ? '摄像头' : '麦克风'
  try {
    const permission = await navigator.permissions?.query({ name: device as PermissionName }).catch(() => undefined)
    if (!canStart()) return
    const invoke = (window as any).__TAURI__?.core?.invoke
    if (permission?.state === 'denied' && invoke) await invoke('reset_media_permission', { device })
    if (!canStart()) return
    const stream = await devices!.getUserMedia({ audio: device === 'microphone', video: device === 'camera' })
    stopMediaStream(stream)
    if (!canStart()) return
    if (device === 'camera') videoError.value = ''
    else micError.value = ''
    permissionStatus.value[device] = label + '已授权'
    void refreshDevices()
  } catch (error) {
    if (!canStart()) return
    const denied = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)
    permissionStatus.value[device] = denied
      ? `未获得${label}权限。若系统持续拦截，请在 Windows 隐私设置或浏览器网站权限中允许访问。`
      : mediaError(error)
  } finally {
    permissionPending.value = ''
  }
}

async function refreshDevices() {
  if (!devices?.enumerateDevices || !canStart()) return
  const request = ++enumerateRequest
  try {
    const next = await devices.enumerateDevices()
    if (request !== enumerateRequest || !canStart()) return
    const disappeared = (kind: MediaDeviceKind, id: string | undefined) => !!id
      && list.value.some(d => d.kind === kind && d.deviceId === id)
      && !next.some(d => d.kind === kind && d.deviceId === id)
    if (disappeared('audioinput', micStream.value?.getAudioTracks()[0]?.getSettings().deviceId)) {
      mic.stop()
      micError.value = '麦克风已断开。重新开始测试时可使用系统默认设备。'
    }
    if (!display.value && disappeared('videoinput', liveTrack.value?.getSettings().deviceId)) {
      video.stop()
      videoError.value = '摄像头已断开。重新预览时可使用系统默认设备。'
    }
    const sink = (audioElement.value as (HTMLAudioElement & { sinkId?: string }) | undefined)?.sinkId
    if (playing.value && disappeared('audiooutput', sink)) {
      stopPlayback()
      outputError.value = '扬声器已断开，下次播放将使用系统默认输出。'
    }
    list.value = next
    enumerationError.value = ''
  } catch (error) {
    if (request === enumerateRequest && canStart()) enumerationError.value = mediaError(error)
  }
}

function persist() {
  saveMediaPreferences({ microphone: microphone.value, camera: camera.value, speaker: speaker.value })
}

function setMicrophone() {
  persist()
  micError.value = ''
  if (micStream.value) void startMicrophone()
}

async function startMicrophone() {
  if (!canStart() || !devices?.getUserMedia || micPending.value) return
  micError.value = ''
  try {
    const stream = await mic.start(
      () => devices.getUserMedia({ audio: inputDevice(missingMic.value ? '' : microphone.value), video: false }),
      () => { micError.value = '麦克风已断开或停止。' },
    )
    if (!stream) return
    void refreshDevices()
    try {
      const context = meterContext = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      await context.resume()
      if (meterContext !== context) return
      meterTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += value * value
        level.value = Math.round(Math.min(1, Math.sqrt(sum / samples.length) * 4) * 100)
      }, 80)
    } catch {
      if (micStream.value === stream) {
        if (meterContext) void meterContext.close().catch(() => {})
        meterContext = undefined
        micError.value = '音量检测不可用，仍可测试录音。'
      }
    }
  } catch (error) {
    micError.value = mediaError(error)
  }
}

function cancelRecording() {
  clearTimeout(recordingTimer)
  if (recorder) {
    recorder.onstop = recorder.ondataavailable = recorder.onerror = null
    if (recorder.state !== 'inactive') recorder.stop()
    recorder = undefined
  }
  recording.value = finalizing.value = false
}

function finishRecording() {
  clearTimeout(recordingTimer)
  if (!recorder || recorder.state === 'inactive') return
  finalizing.value = true
  recorder.stop()
  recording.value = false
}

function startRecording() {
  if (!canStart() || !micStream.value || recorder) return
  stopPlayback()
  sample.value = null
  const chunks: Blob[] = []
  try {
    const capture = recorder = new MediaRecorder(micStream.value)
    capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    capture.onerror = () => { cancelRecording(); micError.value = '测试录音失败，请重新开始。' }
    capture.onstop = () => {
      if (recorder !== capture) return
      const result = new Blob(chunks, { type: capture.mimeType || chunks[0]?.type })
      cancelRecording()
      if (result.size) sample.value = result
      else micError.value = '没有录到可试听的音频，请稍后重试。'
    }
    capture.start()
    micError.value = ''
    recording.value = true
    recordingTimer = setTimeout(finishRecording, 10_000)
  } catch (error) {
    cancelRecording()
    micError.value = mediaError(error)
  }
}

function setVideoSource(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const wasPreviewing = !!videoStream.value
  videoError.value = ''
  if (value === 'monitor' || value === 'window') {
    display.value = value
    void startVideo()
    return
  }
  display.value = ''
  camera.value = value
  persist()
  if (wasPreviewing) void startVideo()
}

async function startVideo() {
  if (!canStart() || !devices || videoPending.value) return
  const surface = display.value
  if (surface ? !canDisplay : !canInput) return
  videoError.value = ''
  try {
    // Call directly from the selection/button event to keep the system picker's user activation.
    const stream = await video.start(() => {
      if (!surface) return devices.getUserMedia({ audio: false, video: inputDevice(missingCamera.value ? '' : camera.value) })
      const options = {
        audio: false, video: { displaySurface: surface },
        selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude',
        ...(surface === 'window' ? { monitorTypeSurfaces: 'exclude' } : {}),
      }
      return devices.getDisplayMedia(options)
    }, () => { videoError.value = surface ? '桌面采集已停止。' : '摄像头已断开或停止。' }, acquired => {
      const track = acquired.getVideoTracks()[0]
      if (!track) throw new DOMException('没有可用的画面轨道。', 'NotReadableError')
      const selected = track.getSettings().displaySurface
      if (surface && selected && selected !== surface) {
        throw new Error(surface === 'window' ? '请选择应用窗口。' : '请选择整个屏幕。')
      }
    })
    if (!stream) return
    updateVideoSettings()
    const track = stream.getVideoTracks()[0]
    if (surface && track) profiles.value = displayProfiles(track)
    if (!surface) void refreshDevices()
  } catch (error) {
    videoError.value = mediaError(error, surface ? 'display' : 'device')
  }
}

function updateVideoSettings() {
  if (liveTrack.value) settings.value = liveTrack.value.getSettings()
}

async function changeDisplayProfile(event: Event, field: 'resolution' | 'frameRate') {
  const track = liveTrack.value
  if (!track || adjusting.value) return
  const select = event.target as HTMLSelectElement
  const next = select.value
  const size = field === 'resolution' ? next : resolution.value
  const fps = Number(field === 'frameRate' ? next : frameRate.value)
  const [width, height] = size.split('x').map(Number)
  adjusting.value = true
  videoError.value = ''
  try {
    await track.applyConstraints({
      ...(width && height ? { width: { max: width }, height: { max: height } } : {}),
      ...(fps ? { frameRate: { max: fps } } : {}),
    })
    if (liveTrack.value !== track) return
    if (field === 'resolution') resolution.value = next
    else frameRate.value = next
    updateVideoSettings()
  } catch (error) {
    if (liveTrack.value !== track) return
    select.value = field === 'resolution' ? resolution.value : frameRate.value
    videoError.value = mediaError(error, 'display')
  } finally {
    if (liveTrack.value === track) adjusting.value = false
  }
}

watch([videoElement, videoStream], ([element, stream]) => {
  if (!element || !stream) return
  element.srcObject = stream
  void element.play().catch(error => {
    if (videoStream.value !== stream) return
    video.stop()
    videoError.value = mediaError(error)
  })
}, { flush: 'post' })

function stopPlayback() {
  playbackRequest++
  playing.value = ''
  if (audioElement.value?.hasAttribute('src')) {
    audioElement.value.pause()
    audioElement.value.removeAttribute('src')
    audioElement.value.load()
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = ''
}

async function playTest(kind: 'tone' | 'sample') {
  if (!canStart() || !audioElement.value || recording.value || routing.value) return
  const element = audioElement.value
  const blob = kind === 'tone' ? (tone ||= makeSpeakerTone()) : sample.value
  if (!blob) return
  stopPlayback()
  const request = playbackRequest
  playing.value = kind
  outputError.value = ''
  try {
    const selected = canOutput && !missingSpeaker.value ? speaker.value : ''
    routing.value = true
    let used: boolean
    try { used = await routeMediaOutput(element, selected) }
    finally { routing.value = false }
    if (request !== playbackRequest) return
    if (!used || (canOutput && missingSpeaker.value)) {
      outputError.value = '所选扬声器不可用，正在使用系统默认输出。'
    }
    element.src = audioUrl = URL.createObjectURL(blob)
    await element.play()
  } catch (error) {
    if (request !== playbackRequest) return
    stopPlayback()
    outputError.value = mediaError(error, 'output')
  }
}

function setSpeaker() {
  stopPlayback()
  outputError.value = ''
  persist()
}

async function chooseSpeaker() {
  if (!canStart() || !devices?.selectAudioOutput || outputPicking.value) return
  const request = ++outputRequest
  outputPicking.value = true
  try {
    const device = await devices.selectAudioOutput()
    if (request !== outputRequest || !canStart()) return
    if (!list.value.some(d => d.deviceId === device.deviceId)) list.value = [...list.value, device]
    speaker.value = device.deviceId
    setSpeaker()
    void refreshDevices()
  } catch (error) {
    if (request === outputRequest && canStart()) outputError.value = mediaError(error, 'output')
  } finally {
    outputPicking.value = false
  }
}

function release() {
  enumerateRequest++
  outputRequest++
  mic.stop()
  video.stop()
  stopPlayback()
  sample.value = null
}
function onVisibility() { if (document.hidden) release(); else void refreshDevices() }
function onMinimized(event: Event) {
  minimized = !!(event as CustomEvent).detail
  if (minimized) release()
  else void refreshDevices()
}
watch([() => props.active, locked], ([active, isLocked]) => {
  if (!active || isLocked) release()
  else void refreshDevices()
}, { flush: 'sync' })
onMounted(() => {
  void refreshDevices()
  devices?.addEventListener('devicechange', refreshDevices)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('yh-window-minimized', onMinimized)
  window.addEventListener('pagehide', release)
  window.addEventListener('focus', refreshDevices)
})
onBeforeUnmount(() => {
  disposed = true
  release()
  devices?.removeEventListener('devicechange', refreshDevices)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('yh-window-minimized', onMinimized)
  window.removeEventListener('pagehide', release)
  window.removeEventListener('focus', refreshDevices)
})
</script>

<template>
  <KLayout title="音频与视频" desc="管理本机设备、预览画面并测试声音。">
    <template #actions>
      <button type="button" class="ghost small device-action" :disabled="!devices?.enumerateDevices" @click="refreshDevices">
        <Icon name="refresh" :size="15" aria-hidden="true" /> 刷新设备
      </button>
    </template>
    <p v-if="!canInput" class="device-notice" role="status">当前环境无法访问麦克风和摄像头。请使用 Windows 客户端、HTTPS 或本机地址。</p>
    <p v-if="enumerationError" class="device-notice" role="status">{{ enumerationError }}</p>
    <div class="device-grid">
      <section class="device-card device-video" data-setting-id="media-camera">
        <header><span class="device-icon"><Icon name="video" :size="20" aria-hidden="true" /></span><div><h3>摄像头与桌面</h3><p>视频输入源与本地预览</p></div></header>
        <label class="device-field">视频输入源
          <select :value="source" :disabled="videoPending" @change="setVideoSource">
            <optgroup label="摄像头">
              <option value="" :disabled="!canInput">默认摄像头</option>
              <option v-if="missingCamera" :value="camera">上次选择的摄像头（暂不可用）</option>
              <option v-for="device in cameras" :key="device.id" :value="device.id">{{ device.label }}</option>
            </optgroup>
            <optgroup label="YH LaoDa 虚拟摄像头">
              <option value="monitor" :disabled="!canDisplay">整个屏幕</option>
              <option value="window" :disabled="!canDisplay">指定窗口</option>
            </optgroup>
          </select>
        </label>
        <div class="device-preview">
          <Transition name="settings-fade">
            <video v-if="videoStream" ref="videoElement" autoplay muted playsinline aria-label="本地视频预览" @resize="updateVideoSettings" />
          </Transition>
          <div v-if="!videoStream" class="preview-idle">
            <Icon :name="display ? 'screen' : 'video'" :size="32" aria-hidden="true" />
            <span>{{ videoPending ? '正在等待设备或系统授权' : '预览已关闭' }}</span>
          </div>
        </div>
        <div class="device-actions">
          <button type="button" class="ghost device-action" :disabled="!canInput || !!permissionPending || videoPending"
                  @click="authorizeInput('camera')">授权摄像头</button>
          <button v-if="!videoStream || display" type="button" class="device-action" :disabled="videoPending || (display ? !canDisplay : !canInput)" @click="startVideo">
            {{ display ? (videoStream ? '切换采集来源' : '选择屏幕或窗口') : '开启预览' }}
          </button>
          <button v-if="videoStream || videoPending" type="button" class="ghost device-action" @click="video.stop()">{{ videoPending ? '取消预览' : '停止预览' }}</button>
          <span v-if="videoDescription" class="device-hint">{{ videoDescription }}</span>
        </div>
        <p v-if="permissionStatus.camera" class="device-hint" role="status">{{ permissionStatus.camera }}</p>
        <div v-if="videoStream && display && (profiles.resolutions.length || profiles.frames.length)" class="device-profile">
          <label v-if="profiles.resolutions.length" class="device-field">分辨率上限
            <select :value="resolution" :disabled="adjusting" @change="changeDisplayProfile($event, 'resolution')">
              <option value="">自动</option>
              <option v-for="size in profiles.resolutions" :key="size.height" :value="size.width + 'x' + size.height">{{ size.width }} × {{ size.height }}</option>
            </select>
          </label>
          <label v-if="profiles.frames.length" class="device-field">帧率上限
            <select :value="frameRate" :disabled="adjusting" @change="changeDisplayProfile($event, 'frameRate')">
              <option value="">自动</option>
              <option v-for="fps in profiles.frames" :key="fps" :value="String(fps)">{{ fps }} 帧/秒</option>
            </select>
          </label>
        </div>
        <p v-if="videoError" class="device-notice" role="status">{{ videoError }}</p>
        <p v-else-if="!display && missingCamera" class="device-hint">所选摄像头暂不可用，预览将尝试使用默认摄像头。</p>
        <p class="device-hint">{{ canDisplay ? '桌面画面仅在本机预览，每次采集都需要在系统选择器中授权。' : '当前 WebView 或浏览器不支持桌面采集。' }}</p>
      </section>

      <section class="device-card" data-setting-id="media-microphone">
        <header><span class="device-icon"><Icon name="mic" :size="20" aria-hidden="true" /></span><div><h3>麦克风</h3><p>检测输入电平，试录后试听</p></div></header>
        <label class="device-field">输入设备
          <select v-model="microphone" :disabled="!canInput || micPending || recording || finalizing" @change="setMicrophone">
            <option value="">系统默认麦克风</option>
            <option v-if="missingMic" :value="microphone">上次选择的麦克风（暂不可用）</option>
            <option v-for="device in inputs" :key="device.id" :value="device.id">{{ device.label }}</option>
          </select>
        </label>
        <label class="device-field">输入音量
          <meter min="0" max="100" :value="level"></meter>
        </label>
        <div class="device-actions">
          <button type="button" class="ghost device-action" :disabled="!canInput || !!permissionPending || micPending || recording"
                  @click="authorizeInput('microphone')">授权麦克风</button>
          <button v-if="!micStream && !micPending" type="button" class="device-action" :disabled="!canInput" @click="startMicrophone">测试麦克风</button>
          <button v-else type="button" class="ghost device-action" @click="mic.stop()">{{ micPending ? '取消测试' : '停止测试' }}</button>
          <button v-if="recording" type="button" class="device-action" @click="finishRecording">结束录音</button>
          <button v-else type="button" class="ghost device-action" :disabled="!micStream || finalizing || !canRecord" @click="startRecording">开始试录</button>
          <button v-if="sample" type="button" class="ghost device-action" :disabled="recording || (routing && playing !== 'sample')" @click="playing === 'sample' ? stopPlayback() : playTest('sample')">{{ playing === 'sample' ? '停止试听' : '试听录音' }}</button>
        </div>
        <p v-if="permissionStatus.microphone" class="device-hint" role="status">{{ permissionStatus.microphone }}</p>
        <p v-if="micError" class="device-notice" role="status">{{ micError }}</p>
        <p v-else-if="missingMic" class="device-hint">所选麦克风暂不可用，测试将尝试使用默认麦克风。</p>
        <p v-if="recording" class="device-hint" role="status">正在试录，最多 10 秒。</p>
        <p v-else class="device-hint">开启测试后即可试录，离开此页会清除录音。</p>
      </section>

      <section class="device-card" data-setting-id="media-speaker">
        <header><span class="device-icon"><Icon name="speaker" :size="20" aria-hidden="true" /></span><div><h3>扬声器</h3><p>选择播放设备并试听提示音</p></div></header>
        <label class="device-field">输出设备
          <select :value="canOutput ? speaker : ''" :disabled="!canOutput || outputPicking" @change="speaker = ($event.target as HTMLSelectElement).value; setSpeaker()">
            <option value="">系统默认输出</option>
            <option v-if="canOutput && missingSpeaker" :value="speaker">上次选择的扬声器（暂不可用）</option>
            <option v-for="device in outputs" :key="device.id" :value="device.id">{{ device.label }}</option>
          </select>
        </label>
        <div class="device-actions">
          <button type="button" class="device-action" :disabled="recording || (routing && playing !== 'tone')" @click="playing === 'tone' ? stopPlayback() : playTest('tone')">{{ playing === 'tone' ? '停止播放' : '播放测试音' }}</button>
          <button v-if="canOutput && devices?.selectAudioOutput" type="button" class="ghost device-action" :disabled="outputPicking" @click="chooseSpeaker">授权其他输出设备</button>
        </div>
        <p v-if="outputError" class="device-notice" role="status">{{ outputError }}</p>
        <p v-else-if="!canOutput" class="device-hint">当前 WebView 或浏览器不支持指定输出设备，将使用系统默认输出。</p>
        <p v-else-if="missingSpeaker" class="device-hint">所选扬声器暂不可用，将使用系统默认输出。</p>
        <p v-else-if="!outputs.length" class="device-hint">系统只公开了默认输出。允许麦克风访问后，其他设备可能会显示。</p>
      </section>
    </div>
    <section v-if="ctx?.calls?.supported" class="device-card call-preview-setting" data-setting-id="media-private-call">
      <header><span class="device-icon"><Icon name="callVoice" :size="20" aria-hidden="true" /></span><div><h3>语音与视频通话</h3><p>在主窗口的私聊或群聊输入框下方发起通话。</p></div></header>
      <label class="call-preview-toggle">
        <input type="checkbox" :checked="ctx.calls.state.enabled" @change="ctx.calls.setEnabled(($event.target as HTMLInputElement).checked)" />
        启用语音与视频通话
      </label>
      <ScreenShareSettings v-if="ctx.calls.canShare" />
      <details class="call-network">
        <summary>通话网络与中继</summary>
        <form autocomplete="off" @submit.prevent="saveCallNetwork()">
          <p class="device-hint">私聊默认尝试直连，群聊使用云湖提供的房间服务。可使用你有权使用的 STUN 或 TURN 服务。配置仅保留在当前应用会话中。</p>
          <label class="device-field">STUN 地址<input v-model="stunUrl" placeholder="stun:stun.example.com:3478" /></label>
          <label class="device-field">TURN 地址<input v-model="turnUrl" placeholder="turns:turn.example.com:5349" /></label>
          <template v-if="turnUrl.trim()">
            <label class="device-field">TURN 用户名<input v-model="turnUser" autocomplete="off" /></label>
            <label class="device-field">TURN 密码<input v-model="turnPassword" type="password" autocomplete="new-password" /></label>
          </template>
          <div class="device-actions">
            <button type="submit">应用通话网络配置</button>
            <button v-if="ctx.calls.state.iceConfigured" type="button" class="ghost" @click="saveCallNetwork(true)">恢复直连</button>
          </div>
          <p v-if="relayMessage" class="device-notice" role="status">{{ relayMessage }}</p>
          <p v-else-if="ctx.calls.state.iceConfigured" class="device-hint">当前应用会话已配置通话网络。</p>
        </form>
      </details>
    </section>
    <audio ref="audioElement" preload="none" @ended="stopPlayback"></audio>
  </KLayout>
</template>

<style scoped>
.device-grid { display:grid; grid-template-columns:minmax(0, 1.3fr) minmax(0, 1fr); gap:14px; align-items:start; color:var(--fg); }
.device-card { min-width:0; display:grid; align-content:start; gap:13px; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--card); }
.device-video { grid-row:span 2; }
.call-preview-setting { margin-top:14px; }
.call-preview-toggle { display:flex; gap:8px; align-items:center; font-size:13px; }
.call-network summary { cursor:pointer; font-size:13px; }
.call-network form { display:grid; gap:9px; margin-top:9px; }
.call-network input { min-width:0; width:100%; }
.device-card header { display:flex; align-items:center; gap:11px; min-width:0; }
.device-icon { display:grid; place-items:center; flex:0 0 36px; height:36px; border-radius:10px; background:var(--acc-soft); color:var(--fg); }
.device-card h3 { font-size:15px; margin:0 0 3px; }
.device-card header p,.device-hint,.device-notice { color:var(--fg2); font-size:12px; margin:0; line-height:1.5; overflow-wrap:anywhere; }
.device-notice { color:var(--fg); background:var(--card2); border-inline-start:2px solid var(--acc); padding:7px 9px; border-radius:5px; }
.k-body > .device-notice { margin-block-end:10px; }
.device-field { display:grid; gap:6px; min-width:0; color:var(--fg); font-size:12px; }
.device-field select { width:100%; min-width:0; text-overflow:ellipsis; }
.device-field meter { width:100%; height:10px; accent-color:var(--acc); }
.device-profile { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(110px,100%),1fr)); gap:9px; }
.device-preview { position:relative; display:grid; place-items:center; overflow:hidden; aspect-ratio:16/9; max-height:35dvh; min-height:100px; border-radius:10px; border:1px solid var(--line); background:var(--card2); }
.device-preview video { position:absolute; inset:0; display:block; width:100%; height:100%; object-fit:contain; background:#111; }
.preview-idle { display:grid; justify-items:center; gap:6px; color:var(--fg2); font-size:12px; }
.device-actions { display:flex; align-items:center; flex-wrap:wrap; gap:7px; }
.device-action { display:inline-flex; align-items:center; gap:6px; transition:transform 120ms cubic-bezier(.23,1,.32,1), background 120ms ease; }
.device-action:active:not(:disabled) { transform:scale(.97); }
.device-action:focus-visible,.device-field select:focus-visible { outline:2px solid var(--link,var(--acc)); outline-offset:2px; }
@media (max-width: 1100px) { .device-grid { grid-template-columns:1fr; } .device-video { grid-row:auto; } }
@media (prefers-reduced-motion: reduce) { .device-action { transition:none; } }
</style>
