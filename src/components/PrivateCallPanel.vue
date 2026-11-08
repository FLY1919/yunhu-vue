<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { callTitle } from '../core/yunhu-calls'
import { mediaPreferencesEvent, readMediaPreferences, routeMediaOutput, type MediaDevicePreferences } from '../core/media-devices'
import Icon from '../console/components/Icon.vue'
import GroupCallInvitePicker from './GroupCallInvitePicker.vue'
import GroupCallStage from './GroupCallStage.vue'
import GroupCallAudio from './GroupCallAudio.vue'
import ScreenShareSettings from './ScreenShareSettings.vue'
import type { GroupCallPeer } from '../core/group-call-room'

const ctx = inject<any>('ctx')
const calls = computed(() => ctx.calls)
const session = computed(() => calls.value?.state.session)
const group = computed(() => session.value?.chatType === 2)
const title = computed(() => {
  if (session.value?.voiceRoom) return '群聊语音房'
  if (!group.value) return session.value ? callTitle(session.value.kind) : ''
  if (session.value?.kind === 'video' || calls.value.state.groupPeers.some(peer => peer.hasVideo)) return '群视频通话'
  return session.value?.kindKnown === false ? '群通话' : '群语音通话'
})
const minimized = ref(false)
const expanded = ref(false)
const settingsOpen = ref(false)
const featured = ref('')
const popupTarget = shallowRef<HTMLElement>()
const peers = computed<GroupCallPeer[]>(() => calls.value?.state.groupPeers || [])
let popup: Window | undefined
let popupTimer: ReturnType<typeof setInterval> | undefined
let popupCleanup: (() => void) | undefined
const detached = computed(() => !!popupTarget.value)
const canDetach = computed(() => !['incoming', 'selecting'].includes(session.value?.phase || ''))
const native = !!(window as any).__TAURI__?.core?.invoke

function dock(focus = false) {
  const opened = popup
  popup = undefined
  clearInterval(popupTimer)
  popupCleanup?.()
  popupCleanup = undefined
  popupTarget.value = undefined
  // Reattach the media elements before the detached document is destroyed.
  if (opened && !opened.closed) void nextTick(() => { if (!opened.closed) opened.close() })
  if (focus) window.focus()
}

function openPopup(position?: { x: number; y: number }) {
  if (popup || !canDetach.value) return
  const url = new URL('/call-window.html', location.href)
  const place = position ? `,left=${Math.round(position.x)},top=${Math.round(position.y)}` : ''
  const opened = window.open(url.href, 'yh-call-float', 'popup,width=560,height=640' + place)
  if (!opened) { ctx.ui.toast('无法打开独立通话窗口，请检查弹窗权限。', 'warn'); return }
  popup = opened
  const start = Date.now()
  popupTimer = setInterval(() => {
    if (opened.closed) { dock(); return }
    if (popupTarget.value) return
    if (Date.now() - start > 5000) {
      dock()
      ctx.ui.toast('独立通话窗口加载超时。', 'warn')
      return
    }
    try {
      if (opened.location.href !== url.href || opened.document.readyState === 'loading' || !opened.document.body) return
      const doc = opened.document
      for (const stylesheet of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
        doc.head.append(stylesheet.cloneNode(true))
      }
      const syncTheme = () => {
        const original = document.documentElement
        doc.documentElement.className = original.className
        for (const name of original.getAttributeNames().filter(name => name.startsWith('data-') || name === 'style')) {
          doc.documentElement.setAttribute(name, original.getAttribute(name) || '')
        }
        for (const name of doc.documentElement.getAttributeNames()) {
          if ((name.startsWith('data-') || name === 'style') && !original.hasAttribute(name)) doc.documentElement.removeAttribute(name)
        }
      }
      const theme = new MutationObserver(syncTheme)
      theme.observe(document.documentElement, { attributes: true })
      syncTheme()
      const closed = () => { if (popup === opened) dock() }
      opened.addEventListener('pagehide', closed, { once: true })
      popupCleanup = () => { theme.disconnect(); opened.removeEventListener('pagehide', closed) }
      expanded.value = false
      minimized.value = false
      popupTarget.value = doc.body
    } catch { /* A newly opened WebView can still be loading its initial page. */ }
  }, 150)
}

function chooseFeature(id: string, enlarge = false) {
  featured.value = id
  if ((enlarge || id) && !detached.value) expanded.value = true
}

function escapePanel() {
  if (expanded.value) expanded.value = false
  else if (featured.value) featured.value = ''
}

function screenDevices() {
  return panel.value?.ownerDocument.defaultView?.navigator.mediaDevices
}

function toggleSharing() {
  if (calls.value.state.sharing) void calls.value.stopSharing()
  else void calls.value.shareScreen(screenDevices())
}
const panel = ref<HTMLElement>()
const position = shallowRef<{ x: number; y: number }>()
const positionStyle = computed(() => position.value && !expanded.value && !detached.value
  ? { left: '0', top: '0', right: 'auto', bottom: 'auto', translate: `${position.value.x}px ${position.value.y}px` }
  : undefined)
let dragOffset: { id: number; x: number; y: number } | undefined
const playbackBlocked = ref(false)
const remote = ref<HTMLMediaElement>()
const local = ref<HTMLVideoElement>()
const devicesOpen = ref(false)
const devices = shallowRef<MediaDeviceInfo[]>([])
const deviceError = ref('')
const speaker = ref('')
const outputPending = ref(false)
const canSelectOutput = computed(() => typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function'
  && (group.value || !!remote.value))
const canSwitch = computed(() => session.value?.phase === 'preview' || session.value?.phase === 'connected')
const showLocal = computed(() => (calls.value?.state.camera || calls.value?.state.sharing)
  && calls.value?.state.local?.getVideoTracks().some(track => track.readyState === 'live'))
const status = {
  selecting: '选择要邀请的群成员', incoming: '邀请你通话', preparing: '正在准备设备', preview: '确认画面后发起呼叫',
  dialing: '正在向云湖发起呼叫', ringing: '等待对方接听', connecting: '正在建立媒体连接', connected: '通话中',
}
watch(() => session.value?.room, () => {
  dock()
  featured.value = ''
  minimized.value = expanded.value = playbackBlocked.value = devicesOpen.value = settingsOpen.value = outputPending.value = false
  position.value = dragOffset = undefined
  devices.value = []
  deviceError.value = ''
  speaker.value = readMediaPreferences().speaker
})
watch([featured, peers], ([id, members]) => {
  if (id && id !== '__local__' && !members.some(peer => peer.id === id && peer.hasVideo)) {
    featured.value = ''
    return
  }
})
watch(featured, id => calls.value?.featureParticipant?.(id === '__local__' ? '' : id))
function movePanel(x: number, y: number) {
  const element = panel.value
  if (!element || expanded.value || detached.value) return
  const next = {
    x: Math.max(0, Math.min(x, innerWidth - element.offsetWidth)),
    y: Math.max(0, Math.min(y, innerHeight - element.offsetHeight)),
  }
  if (position.value?.x !== next.x || position.value?.y !== next.y) position.value = next
}
function clampPanel() {
  if (position.value) movePanel(position.value.x, position.value.y)
}
watch([panel, expanded, detached], ([element, full, separate], _, cleanup) => {
  if (!element || full || separate) return
  const observer = new ResizeObserver(clampPanel)
  observer.observe(element)
  window.addEventListener('resize', clampPanel)
  cleanup(() => { observer.disconnect(); window.removeEventListener('resize', clampPanel) })
}, { flush: 'post' })
function beginDrag(event: PointerEvent) {
  if (!panel.value || expanded.value || detached.value || dragOffset || event.button !== 0 || (event.target as Element).closest('button')) return
  const rect = panel.value.getBoundingClientRect()
  const header = event.currentTarget as HTMLElement
  header.setPointerCapture(event.pointerId)
  dragOffset = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function drag(event: PointerEvent) {
  if (dragOffset?.id === event.pointerId) movePanel(event.clientX - dragOffset.x, event.clientY - dragOffset.y)
}
function finishDrag(event: PointerEvent) {
  if (dragOffset?.id !== event.pointerId) return
  dragOffset = undefined
  const outside = event.clientX < 0 || event.clientX > innerWidth || event.clientY < 0 || event.clientY > innerHeight
  if (native && event.type === 'pointerup' && outside) openPopup({ x: event.screenX - 80, y: event.screenY - 40 })
}
function openMediaSettings() {
  if (popup) dock(true)
  expanded.value = false
  minimized.value = true
  ctx.console.goto('/account', 'media')
}
function options(kind: MediaDeviceKind) {
  return devices.value.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default')
}
let deviceRequest = 0
async function refreshDevices() {
  const request = ++deviceRequest
  if (!devicesOpen.value || !navigator.mediaDevices?.enumerateDevices) return
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    if (request === deviceRequest) { devices.value = list; deviceError.value = '' }
  } catch {
    if (request === deviceRequest) deviceError.value = '无法读取设备列表，可继续使用系统默认设备。'
  }
}
watch(devicesOpen, (open, _, cleanup) => {
  if (!open) return
  void refreshDevices()
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
  cleanup(() => { deviceRequest++; navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices) })
})
function syncSpeaker(event: Event) {
  const id = (event as CustomEvent<MediaDevicePreferences>).detail?.speaker
  if (typeof id !== 'string' || speaker.value === id) return
  if (remote.value && session.value?.phase === 'connected') void switchSpeaker(id)
  else speaker.value = id
}
onMounted(() => window.addEventListener(mediaPreferencesEvent, syncSpeaker))
onBeforeUnmount(() => { dock(); deviceRequest++; window.removeEventListener(mediaPreferencesEvent, syncSpeaker) })
async function switchSpeaker(id: string) {
  if (group.value) { speaker.value = id; return }
  const element = remote.value, room = session.value?.room
  if (!element || !room || outputPending.value) return
  outputPending.value = true
  try {
    const selected = await routeMediaOutput(element, id)
    if (session.value?.room !== room) return
    speaker.value = selected ? id : ''
    if (!selected) ctx.ui.toast('所选扬声器暂不可用，已使用系统默认输出。', 'warn')
  } catch (error) {
    if (session.value?.room === room) ctx.ui.toast(error?.message || '无法切换通话输出设备。', 'warn')
  } finally {
    if (session.value?.room === room) outputPending.value = false
  }
}
async function switchInput(kind: 'audio' | 'video', event: Event) {
  const select = event.target as HTMLSelectElement, room = session.value?.room
  if (kind === 'video') await calls.value.selectVideoSource(select.value, screenDevices())
  else await calls.value.switchDevice('audio', select.value)
  if (session.value?.room === room) select.value = kind === 'audio' ? calls.value.state.microphoneId
    : calls.value.state.sharing ? 'screen' : calls.value.state.cameraId
}
async function playRemote() {
  const element = remote.value, stream = element?.srcObject
  if (!element || !stream) return
  let blocked = false
  try { await element.play() } catch { blocked = true }
  if (remote.value === element && element.srcObject === stream) playbackBlocked.value = blocked
}
watch([remote, () => calls.value?.state.remote], ([element, stream], _, cleanup) => {
  if (!element || !stream) return
  element.srcObject = stream
  cleanup(() => { if (element.srcObject === stream) element.srcObject = null })
  void routeMediaOutput(element, speaker.value).catch(() => {})
  void playRemote()
}, { flush: 'post' })
watch([local, () => calls.value?.state.local], ([element, stream], _, cleanup) => {
  if (!element || !stream) return
  element.srcObject = stream
  cleanup(() => { if (element.srcObject === stream) element.srcObject = null })
}, { flush: 'post' })
</script>

<template>
  <Teleport :to="popupTarget || 'body'">
    <Transition name="call-enter">
      <section v-if="session" ref="panel" class="call-panel" :class="{ minimized, expanded, detached }" :style="positionStyle" :aria-label="group ? '群通话' : '私聊通话'" @keydown.esc="escapePanel">
        <header class="call-header" @pointerdown="beginDrag" @pointermove="drag" @pointerup="finishDrag" @pointercancel="finishDrag" @lostpointercapture="finishDrag">
          <span class="call-icon"><Icon :name="session.kind === 'voice' ? 'callVoice' : 'callVideo'" :size="20" aria-hidden="true" /></span>
          <div class="call-summary">
            <strong>{{ session.name }}</strong>
            <span role="status">{{ title }} · {{ status[session.phase] }}</span>
          </div>
          <button v-if="!detached && !minimized && (session.kind === 'video' || group) && calls.state.local" type="button" class="ghost small"
            :aria-label="expanded ? '退出软件内全屏' : '软件内全屏'" @click="expanded = !expanded">
            <Icon :name="expanded ? 'collapse' : 'expand'" :size="17" aria-hidden="true" />
          </button>
          <button v-if="canDetach" type="button" class="ghost small" :aria-label="detached ? '返回主窗口' : '移到独立窗口'"
            :title="detached ? '返回主窗口' : '移到独立窗口'" @click="detached ? dock(true) : openPopup()">
            <Icon :name="detached ? 'collapse' : 'popOut'" :size="17" aria-hidden="true" />
          </button>
          <button v-if="canDetach && !detached" type="button" class="ghost small" :aria-label="minimized ? '展开通话' : '最小化通话'" @click="expanded = false; minimized = !minimized">
            <Icon :name="minimized ? 'expand' : 'minus'" :size="17" aria-hidden="true" />
          </button>
        </header>
        <GroupCallInvitePicker v-if="session.phase === 'selecting'" :key="session.room" :group-id="session.chatId" :video="session.kind === 'video'" @invite="calls.inviteGroup" />
        <GroupCallStage v-if="group && calls.state.local" v-show="!minimized" :key="'stage-' + detached"
          :peers="peers" :room="session.room" :phase="session.phase" :local="calls.state.local" :featured="featured"
          :camera="calls.state.camera" :microphone="calls.state.microphone" :sharing="calls.state.sharing" :wide="expanded || detached"
          @feature="chooseFeature" @fullscreen="chooseFeature($event, true)" />
        <div v-else-if="!group && session.kind === 'video'" v-show="!minimized && calls.state.local" :key="'video-' + detached" class="call-video">
          <video ref="remote" v-show="calls.state.remote" autoplay playsinline aria-label="对方画面" />
          <video ref="local" :class="{ inset: calls.state.remote }" v-show="showLocal" autoplay playsinline muted :aria-label="calls.state.sharing ? '本机共享画面' : '本机画面'" />
          <p v-if="!showLocal && !calls.state.remote">本机摄像头已暂停或不可用</p>
        </div>
        <audio v-else-if="!group" :key="'audio-' + detached" ref="remote" autoplay></audio>
        <div class="call-actions">
          <GroupCallAudio v-for="peer in peers" :key="peer.id + detached" :stream="peer.stream" :speaker="speaker" />
          <button v-if="playbackBlocked"  type="button" class="ghost" @click="playRemote">播放通话声音</button>
          <button v-if="session.phase === 'incoming'" type="button" @click="calls.accept()">接听</button>
          <button v-if="session.phase === 'preview'" type="button" :disabled="calls.state.audioPending || calls.state.videoPending" @click="calls.confirm()">发起视频通话</button>
          <button v-if="!minimized && calls.state.local" type="button" class="ghost" :disabled="calls.state.audioPending" :aria-pressed="!calls.state.microphone" @click="calls.toggle('audio')">
            <Icon name="mic" :size="16" aria-hidden="true" /> {{ !calls.state.local.getAudioTracks().length ? '打开麦克风' : calls.state.microphone ? '静音' : '取消静音' }}
          </button>
          <button v-if="!minimized && calls.state.local && (session.kind === 'video' || (group && canSwitch)) && !calls.state.sharing" type="button" class="ghost"
            :disabled="calls.state.videoPending" :aria-pressed="!calls.state.camera"
            @click="calls.state.local.getVideoTracks().some(track => track.readyState === 'live') ? calls.toggle('video') : calls.selectVideoSource(calls.state.cameraId)">
            <Icon name="video" :size="16" aria-hidden="true" />
            {{ !calls.state.local.getVideoTracks().some(track => track.readyState === 'live') ? '打开摄像头' : calls.state.camera ? '暂停画面' : '恢复画面' }}
          </button>
          <button v-if="!minimized && (session.kind === 'video' || group) && calls.canShare && (canSwitch || calls.state.sharing)" type="button" class="ghost"
            :aria-pressed="calls.state.sharing" :disabled="calls.state.videoPending" @click="toggleSharing">
            <Icon name="screen" :size="16" aria-hidden="true" /> {{ calls.state.sharing ? '停止共享' : '共享屏幕' }}
          </button>
          <button v-if="!minimized && canSwitch" type="button" class="ghost" :aria-expanded="devicesOpen" @click="devicesOpen = !devicesOpen; if (devicesOpen) settingsOpen = false">
            <Icon name="settings" :size="16" aria-hidden="true" /> 通话设备
          </button>
          <button v-if="!minimized && canSwitch && calls.canShare && (group || session.kind === 'video')" type="button" class="ghost"
            :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen; if (settingsOpen) devicesOpen = false">
            <Icon name="sliders" :size="16" aria-hidden="true" /> 屏幕画质
          </button>
          <button v-if="!minimized && canSwitch && ctx.console?.goto" type="button" class="ghost" @click="openMediaSettings">
            <Icon name="settings" :size="16" aria-hidden="true" /> 音视频设置
          </button>
          <button type="button" class="call-end" @click="calls.end()">{{ session.phase === 'incoming' ? '拒绝' : ['connecting', 'connected'].includes(session.phase) ? '挂断' : '取消' }}</button>
        </div>
        <Transition name="call-enter">
          <ScreenShareSettings v-if="settingsOpen && !minimized && canSwitch" />
        </Transition>
        <Transition name="call-enter">
          <div v-if="devicesOpen && !minimized && canSwitch" class="call-devices">
            <label>麦克风<select :value="calls.state.microphoneId" :disabled="calls.state.audioPending" @change="switchInput('audio', $event)">
              <option value="">系统默认</option>
              <option v-for="(device, index) in options('audioinput')" :key="device.deviceId" :value="device.deviceId">{{ device.label || '麦克风 ' + (index + 1) }}</option>
            </select></label>
            <label v-if="session.kind === 'video' || group">视频来源<select :value="calls.state.sharing ? 'screen' : calls.state.cameraId" :disabled="calls.state.videoPending" @change="switchInput('video', $event)">
              <option value="">默认摄像头</option>
              <option v-for="(device, index) in options('videoinput')" :key="device.deviceId" :value="device.deviceId">{{ device.label || '摄像头 ' + (index + 1) }}</option>
              <option v-if="calls.canShare" value="screen">屏幕（作为摄像头）</option>
            </select></label>
            <label v-if="canSelectOutput">扬声器<select :value="speaker" :disabled="outputPending" @change="switchSpeaker(($event.target as HTMLSelectElement).value)">
              <option value="">系统默认</option>
              <option v-for="(device, index) in options('audiooutput')" :key="device.deviceId" :value="device.deviceId">{{ device.label || '扬声器 ' + (index + 1) }}</option>
            </select></label>
            <p v-if="deviceError" role="status">{{ deviceError }}</p>
          </div>
        </Transition>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.call-panel { position:fixed; z-index:80; right:18px; bottom:18px; width:min(480px,calc(100vw - 36px)); max-height:calc(100dvh - 36px); overflow:auto; display:grid; gap:12px; padding:14px; container-type:inline-size; border:1px solid var(--line); border-radius:16px; color:var(--fg); background:var(--card); box-shadow:var(--shadow); }
.call-panel.expanded { inset:12px; width:auto; max-height:calc(100dvh - 24px); grid-template-rows:auto minmax(0,1fr) auto auto; }
.call-panel.detached { inset:0; width:100%; height:100%; max-height:none; border:0; border-radius:0; box-shadow:none; grid-template-rows:auto minmax(0,1fr) auto auto; }
.call-panel:is(.expanded,.detached) .call-video { max-height:none; height:100%; aspect-ratio:auto; }
.call-panel.minimized { width:min(300px,calc(100vw - 36px)); }
.call-header,.call-actions { display:flex; gap:8px; align-items:center; }
.call-panel:not(.expanded,.detached) .call-header { cursor:grab; touch-action:none; user-select:none; }
.call-panel:not(.expanded,.detached) .call-header:active { cursor:grabbing; }
.call-icon { display:grid; place-items:center; width:36px; height:36px; flex:0 0 36px; border-radius:10px; background:var(--acc-soft); color:var(--fg); }
.call-summary { min-width:0; display:grid; gap:2px; flex:1; }
.call-summary strong,.call-summary span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.call-summary span { color:var(--fg2); font-size:12px; }
.call-actions { flex-wrap:wrap; align-content:center; }
.call-actions button { display:inline-flex; align-items:center; gap:5px; font-size:12px; }
.call-devices { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr)); gap:8px; border-top:1px solid var(--line); padding-top:8px; font-size:12px; }
.call-devices label { display:grid; gap:4px; min-width:0; }
.call-devices select { width:100%; min-width:0; }
.call-devices p { grid-column:1/-1; margin:0; color:var(--fg2); }
.call-actions .call-end { margin-left:auto; background:#ad2636; color:#fff; }
.call-actions .call-end:hover { background:#922230; }
.call-video { position:relative; width:100%; aspect-ratio:16/9; max-height:38dvh; overflow:hidden; border-radius:10px; background:var(--card2); }
.call-video video { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.call-video video.inset { inset:auto 8px 8px auto; width:30%; height:33%; background:var(--card); border-radius:6px; }
.call-video p { margin:0; display:grid; place-items:center; height:100%; color:var(--fg2); }
.call-enter-enter-active,.call-enter-leave-active { transition:opacity 150ms ease-out, transform 150ms cubic-bezier(.2,.75,.3,1); }
.call-enter-enter-from,.call-enter-leave-to { opacity:0; transform:translateY(4px); }
@media (prefers-reduced-motion:reduce) {
  .call-enter-enter-active,.call-enter-leave-active { transition:none; }
}
</style>
