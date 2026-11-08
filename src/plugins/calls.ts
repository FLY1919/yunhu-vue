import { shallowReactive, watch } from 'vue'
import type { Context } from '../core/context'
import { getChatRecordingStream, inputDevice, mediaError, mediaPreferencesEvent, readMediaPreferences, stopMediaStream, type MediaDevicePreferences } from '../core/media-devices'
import { callDescription, callKind, readCallInvitation, type CallCandidate, type CallEnd, type CallKind, type GroupCallInvite, type GroupVoiceRoom, type LiveCallSignal } from '../core/yunhu-calls'
import { readScreenShareProfile, saveScreenShareProfile, shareCaptureRequest, shareConstraints, shareEncoding, tuneShareSender, type ScreenShareProfile } from '../core/screen-share'
import type { GroupCallPeer, GroupCallRoom } from '../core/group-call-room'

const key = 'yh.call.preview'
type Phase = 'selecting' | 'incoming' | 'preparing' | 'preview' | 'dialing' | 'ringing' | 'connecting' | 'connected'
interface CallView {
  room: string
  peer: string
  chatId: string
  chatType: number
  kindKnown?: boolean
  voiceRoom?: boolean
  name: string
  kind: CallKind
  phase: Phase
  incoming: boolean
}
interface Attempt extends Omit<CallView, 'phase'> {
  account: string
  wire: { authToken: string; deviceId: string }
  controller: AbortController
  offer?: RTCSessionDescriptionInit
  connection?: RTCPeerConnection
  ice?: { session: string; pending: RTCIceCandidateInit[]; sending: boolean }
  audioSender?: RTCRtpSender
  videoSender?: RTCRtpSender
  cameraEncoding?: RTCRtpSendParameters
  groupRoom?: GroupCallRoom
  invitees?: string[]
  joinToken?: string
  hadCamera?: boolean
  pendingInputs: Set<MediaStream>
  trackCleanups: Map<string, () => void>
  operation?: Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
  joined?: boolean
}

export const callsPlugin = {
  name: 'calls',
  inject: ['api', 'auth', 'ws', 'ui'],
  provide: ['calls'],

  apply(ctx: Context) {
    let enabled = true
    try { enabled = localStorage.getItem(key) !== '0' } catch {}
    const state = shallowReactive({
      enabled, session: null as CallView | null, local: null as MediaStream | null,
      remote: null as MediaStream | null, microphone: true, camera: true,
      groupPeers: [] as GroupCallPeer[],
      screenProfile: readScreenShareProfile(), screenActual: null as MediaTrackSettings | null,
      microphoneId: '', cameraId: '', audioPending: false, videoPending: false, sharing: false, iceConfigured: false,
    })
    const supported = typeof RTCPeerConnection === 'function'
    const canShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
    let iceServers: RTCIceServer[] = []
    let active: Attempt | null = null
    let lookup: AbortController | null = null
    const retired = new Set<string>()
    const remoteIce = new Map<string, { receivedAt: number; candidates: RTCIceCandidateInit[] }>()

    function ready() {
      return supported && state.enabled && ctx.auth.state.status === 'ready' && !!ctx.api.token
        && ctx.ws.online && !ctx.lock?.isLocked
    }

    function wire() { return { authToken: ctx.api.token, deviceId: ctx.auth.deviceId || '' } }

    function update(attempt: Attempt, phase: Phase) {
      const { room, peer, name, kind, incoming, chatId, chatType, kindKnown, voiceRoom } = attempt
      state.session = { room, peer, name, kind, incoming, chatId, chatType, kindKnown, voiceRoom, phase }
    }

    function begin(info: Omit<CallView, 'phase'>, phase: Phase) {
      const attempt: Attempt = { ...info, account: String(ctx.auth.state.user?.id), wire: wire(),
        controller: new AbortController(), pendingInputs: new Set(), trackCleanups: new Map() }
      active = attempt
      state.microphone = state.camera = true
      state.microphoneId = state.cameraId = ''
      state.audioPending = state.videoPending = state.sharing = false
      update(attempt, phase)
      return attempt
    }

    function remember(room: string) {
      retired.add(room)
      if (retired.size > 64) retired.delete(retired.values().next().value!)
    }

    function close(attempt: Attempt, action?: CallEnd, message?: string) {
      if (active !== attempt) return
      const streams = [state.local, state.remote, ...attempt.pendingInputs]
      const group = attempt.chatType === 2
      const canSignalNow = attempt.joined && (group || !attempt.incoming || state.session?.phase === 'connected')
      active = null
      remember(attempt.room)
      clearTimeout(attempt.timer)
      attempt.controller.abort()
      for (const cleanup of attempt.trackCleanups.values()) cleanup()
      attempt.trackCleanups.clear()
      if (attempt.ice) remoteIce.delete(attempt.ice.session)
      attempt.pendingInputs.clear()
      state.local = state.remote = null
      state.groupPeers = []
      state.screenActual = null
      state.audioPending = state.videoPending = state.sharing = false
      state.session = null

      if (action && (!group || attempt.joined || attempt.operation)) {
        const signalEnd = async () => {
          // A room already exchanging media can be hung up before its join response returns.
          if (!canSignalNow && attempt.operation) await attempt.operation.catch(() => {})
          await ctx.api.finishPrivateCall(action, attempt.room, attempt.wire)
        }
        void signalEnd().catch(() => {
          if (state.enabled && attempt.account === String(ctx.auth.state.user?.id)) ctx.ui.toast('本机已结束通话，云湖未确认结束请求。', 'warn')
        })
      }
      if (message) ctx.ui.toast(message, 'warn')

      // Let Vue detach the media elements before WebView tears down native tracks.
      setTimeout(() => {
        try { for (const stream of streams) stopMediaStream(stream) }
        catch (error) { console.warn('通话媒体轨道释放失败', error) }
        try {
          if (attempt.connection) {
            attempt.connection.onconnectionstatechange = null
            attempt.connection.ontrack = null
            attempt.connection.onicecandidate = null
            attempt.connection.close()
          }
          attempt.groupRoom?.close()
        } catch (error) { console.warn('通话媒体连接释放失败', error) }
      }, 0)
    }

    function end() {
      if (!active) return
      const attempt = active
      const action = attempt.chatType === 2 ? (attempt.joined || attempt.operation ? 'hang_up' : undefined)
        : attempt.joined ? 'hang_up' : attempt.incoming ? 'refuse' : attempt.operation ? 'cancel' : undefined
      close(attempt, action)
    }

    function deadline(attempt: Attempt, ms: number, action: CallEnd, message: string) {
      clearTimeout(attempt.timer)
      attempt.timer = setTimeout(() => close(attempt, action, message), ms)
    }

    function syncConnection(attempt: Attempt) {
      if (active !== attempt || !attempt.joined || !attempt.connection) return
      switch (attempt.connection.connectionState) {
        case 'connected':
          clearTimeout(attempt.timer)
          update(attempt, 'connected')
          const display = state.sharing && state.local?.getVideoTracks()[0]
          if (display) void tunePrivateShare(attempt, display, state.screenProfile).catch(reportShareEncoding)
          break
        case 'disconnected':
          update(attempt, 'connecting')
          deadline(attempt, 12000, 'failed', '媒体连接已中断')
          break
        case 'failed':
          close(attempt, 'failed', '媒体连接失败，请检查网络或通话中继配置。')
          break
      }
    }

    async function capture(attempt: Attempt) {
      let stream: MediaStream
      const prefs = readMediaPreferences()
      try { stream = await getChatRecordingStream(attempt.kind === 'video') }
      catch {
        if (active !== attempt) return
        // One permission can fail the combined request while the other device is usable.
        const inputs = attempt.kind === 'video' && navigator.mediaDevices?.getUserMedia
          ? await Promise.all([
            getChatRecordingStream(false).catch(() => null),
            captureDevice('video', prefs.camera).catch(() => null),
          ]) : []
        stream = new MediaStream(inputs.flatMap(input => input?.getTracks() || []))
      }
      if (active !== attempt) {
        stopMediaStream(stream)
        return
      }
      state.local = stream
      const mic = stream.getAudioTracks()[0], camera = stream.getVideoTracks()[0]
      state.microphone = !!mic
      state.microphoneId = mic?.getSettings().deviceId || prefs.microphone
      state.cameraId = camera?.getSettings().deviceId || prefs.camera
      if (!mic || (attempt.kind === 'video' && !camera)) {
        const hints = [!mic ? '麦克风不可用，可先收听' : '', attempt.kind === 'video' && !camera
          ? (canShare ? '摄像头不可用，可共享屏幕' : '摄像头不可用，可继续通话') : ''].filter(Boolean)
        ctx.ui.toast(hints.join('。') + '。', 'warn')
      }
      for (const track of stream.getTracks()) watchTrack(attempt, track)
      return stream
    }

    function watchTrack(attempt: Attempt, track: MediaStreamTrack, display = false) {
      attempt.trackCleanups.get(track.kind)?.()
      const ended = () => {
        if (active !== attempt || !state.local?.getTracks().includes(track)) return
        if (display) void stopSharing()
        else if (state.session?.phase === 'connected' || state.session?.phase === 'preview') {
          state.local = new MediaStream(state.local.getTracks().filter(item => item !== track))
          ctx.ui.toast(track.kind === 'audio' ? '麦克风已断开，可在通话设备中重新选择。' : '摄像头已断开，可在通话设备中重新选择。', 'warn')
        } else {
          const action = attempt.chatType === 2 ? 'hang_up'
            : attempt.joined ? 'failed' : attempt.incoming ? 'refuse' : attempt.operation ? 'cancel' : undefined
          close(attempt, action, '通话设备已停止或断开')
        }
      }
      track.addEventListener('ended', ended, { once: true })
      attempt.trackCleanups.set(track.kind, () => track.removeEventListener('ended', ended))
      if (track.readyState === 'ended') queueMicrotask(ended)
    }

    async function replaceInput(attempt: Attempt, kind: 'audio' | 'video', captureInput: () => Promise<MediaStream>, display = false, profile = state.screenProfile) {
      const pending = kind === 'audio' ? 'audioPending' : 'videoPending'
      if (state[pending] || !state.local) return
      state[pending] = true
      let input: MediaStream | null = null
      try {
        input = await captureInput()
        if (active !== attempt) return
        attempt.pendingInputs.add(input)
        const next = input.getTracks().find(track => track.kind === kind && track.readyState === 'live')
        if (!next) throw new Error('未取得可用的媒体轨道')
        const old = state.local?.getTracks().find(track => track.kind === kind)
        const sender = kind === 'video' ? attempt.videoSender : attempt.audioSender
        if (attempt.connection && !sender) throw new Error('当前通话无法切换此媒体来源')
        next.enabled = display || (kind === 'audio' ? state.microphone : state.camera)
        if (display) next.contentHint = 'detail'
        if (attempt.groupRoom) await attempt.groupRoom.replace(next, display ? profile : undefined)
        else if (sender) await sender.replaceTrack(next)
        if (active !== attempt || !state.local) return
        input.removeTrack(next)
        state.local = new MediaStream([...state.local.getTracks().filter(track => track !== old), next])
        old?.stop()
        if (kind === 'audio') state.microphoneId = next.getSettings().deviceId || ''
        else {
          state.sharing = display
          state.screenActual = display ? next.getSettings() : null
          if (sender) {
            if (display) await tunePrivateShare(attempt, next, profile).catch(reportShareEncoding)
            else await restoreCameraEncoding(attempt).catch(reportShareEncoding)
          }
          if (active !== attempt) return
          if (!display) state.cameraId = next.getSettings().deviceId || ''
          if (attempt.kind === 'voice' && state.session) {
            attempt.kind = 'video'
            update(attempt, state.session.phase)
          }
        }
        watchTrack(attempt, next, display)
      } catch (error) {
        if (active === attempt) ctx.ui.toast(mediaError(error, display ? 'display' : 'device'), 'warn')
      } finally {
        if (input) attempt.pendingInputs.delete(input)
        stopMediaStream(input)
        if (active === attempt) {
          state[pending] = false
          if (display && state.sharing && state.local?.getVideoTracks()[0]?.readyState === 'ended') void stopSharing()
        }
      }
    }

    function captureDevice(kind: 'audio' | 'video', id: string) {
      return navigator.mediaDevices.getUserMedia({ [kind]: inputDevice(id) })
    }

    function switchDevice(kind: 'audio' | 'video', id: string) {
      if (!active || (kind === 'video' && ((active.kind !== 'video' && active.chatType !== 2) || state.sharing))) return
      if (state.session?.phase !== 'preview' && state.session?.phase !== 'connected') return
      return replaceInput(active, kind, () => captureDevice(kind, id))
    }

    function reportShareEncoding() {
      ctx.ui.toast('当前运行环境未能应用发送码率，采集设置仍然有效。', 'warn')
    }

    async function tunePrivateShare(attempt: Attempt, track: MediaStreamTrack, profile: ScreenShareProfile) {
      const sender = attempt.videoSender
      if (!sender?.getParameters) return
      const parameters = sender.getParameters()
      if (parameters.encodings.length && !attempt.cameraEncoding) attempt.cameraEncoding = parameters
      await tuneShareSender(sender, shareEncoding(profile, track))
    }

    async function restoreCameraEncoding(attempt: Attempt) {
      const sender = attempt.videoSender, original = attempt.cameraEncoding
      if (!sender || !original) return
      const parameters = sender.getParameters()
      parameters.degradationPreference = original.degradationPreference
      for (const [i, encoding] of parameters.encodings.entries()) {
        encoding.maxBitrate = original.encodings[i]?.maxBitrate
        encoding.maxFramerate = original.encodings[i]?.maxFramerate
      }
      if (parameters.encodings.length) await sender.setParameters(parameters)
      attempt.cameraEncoding = undefined
    }

    async function setScreenProfile(profile: ScreenShareProfile) {
      const attempt = active, track = state.sharing && state.local?.getVideoTracks()[0]
      if (state.videoPending) return
      if (attempt && track?.readyState === 'live') {
        const previous = state.screenProfile
        state.videoPending = true
        try {
          await track.applyConstraints(shareConstraints(profile))
          if (active !== attempt) return
          if (attempt.groupRoom) await attempt.groupRoom.tuneShare(profile)
          else await tunePrivateShare(attempt, track, profile)
        } catch (error) {
          if (active === attempt) {
            await track.applyConstraints(shareConstraints(previous)).catch(() => {})
            if (active === attempt) ctx.ui.toast(mediaError(error, 'display'), 'warn')
          }
          return
        } finally {
          if (active === attempt) {
            state.videoPending = false
            state.screenActual = track.getSettings()
            if (state.local?.getVideoTracks()[0]?.readyState === 'ended') void stopSharing()
          }
        }
      }
      state.screenProfile = profile
      saveScreenShareProfile(profile)
    }

    function shareScreen(devices = navigator.mediaDevices) {
      if (!devices?.getDisplayMedia || !active || (active.kind !== 'video' && active.chatType !== 2) || state.sharing
        || state.videoPending || (state.session?.phase !== 'connected' && state.session?.phase !== 'preview')) return
      active.hadCamera = !!state.local?.getVideoTracks().some(track => track.readyState === 'live')
      const profile = state.screenProfile
      return replaceInput(active, 'video', () => devices.getDisplayMedia({
        audio: false, video: shareCaptureRequest(profile),
      }).then(async stream => {
        try {
          const track = stream.getVideoTracks()[0]
          if (track && (profile.height || profile.fps)) {
            await track.applyConstraints(shareConstraints(profile))
          }
          return stream
        } catch (error) {
          stopMediaStream(stream)
          throw error
        }
      }), true, profile)
    }

    function stopSharing(camera?: string) {
      if (!active || !state.sharing || state.videoPending) return
      const attempt = active, cameraId = state.cameraId
      // End the outgoing screen capture immediately, even if camera reacquisition fails.
      const tracks = state.local?.getTracks() || []
      const screen = tracks.find(track => track.kind === 'video')
      attempt.trackCleanups.get('video')?.()
      attempt.trackCleanups.delete('video')
      screen?.stop()
      state.local = new MediaStream(tracks.filter(track => track !== screen))
      state.sharing = false
      state.screenActual = null
      if (camera === undefined && !attempt.hadCamera) {
        if (attempt.groupRoom) {
          state.videoPending = true
          return attempt.groupRoom.removeVideo().catch(error => {
            if (active === attempt) ctx.ui.toast(mediaError(error), 'warn')
          }).finally(() => { if (active === attempt) state.videoPending = false })
        }
        if (attempt.videoSender) {
          state.videoPending = true
          return attempt.videoSender.replaceTrack(null).then(() => restoreCameraEncoding(attempt)).catch(reportShareEncoding)
            .finally(() => { if (active === attempt) state.videoPending = false })
        }
        return
      }
      return replaceInput(attempt, 'video', async () => {
        try { return await captureDevice('video', camera ?? cameraId) }
        catch (error) {
          if (active !== attempt || camera !== undefined || !cameraId || !['NotFoundError', 'OverconstrainedError'].includes(error?.name)) throw error
          return captureDevice('video', '')
        }
      })
    }

    function selectVideoSource(id: string, devices?: MediaDevices) {
      if (id === 'screen') return shareScreen(devices)
      if (state.sharing) return stopSharing(id)
      return switchDevice('video', id)
    }

    function setIceServers(stun: string, turn: string, username: string, password: string) {
      const servers: RTCIceServer[] = []
      const host = '(?:[a-z0-9.-]+|\\[[a-f0-9:]+\\])(?::[0-9]{1,5})?'
      if (stun) {
        if (!new RegExp(`^stun:${host}$`, 'i').test(stun)) throw new Error('请填写有效的 STUN 地址，例如 stun:stun.example.com:3478')
        servers.push({ urls: stun })
      }
      if (turn) {
        if (!new RegExp(`^turns?:${host}(?:\\?transport=(?:udp|tcp))?$`, 'i').test(turn) || !username || !password) {
          throw new Error('请填写有效的 TURN 地址、用户名和密码')
        }
        servers.push({ urls: turn, username, credential: password })
      }
      iceServers = servers
      state.iceConfigured = servers.length > 0
    }

    function sendIce(attempt: Attempt, candidate: RTCIceCandidateInit) {
      if (!attempt.ice || active !== attempt) return
      const { session } = attempt.ice
      void ctx.api.sendCallCandidate(attempt.account, attempt.peer, session, candidate,
        { ...attempt.wire, signal: attempt.controller.signal }).catch(() => {})
    }

    function startIce(attempt: Attempt) {
      if (!attempt.ice || active !== attempt) return
      attempt.ice.sending = true
      for (const candidate of attempt.ice.pending.splice(0)) sendIce(attempt, candidate)
    }

    function applyRemoteIce(attempt: Attempt) {
      const connection = attempt.connection
      if (active !== attempt || !connection?.remoteDescription || !attempt.ice) return
      const batch = remoteIce.get(attempt.ice.session)
      remoteIce.delete(attempt.ice.session)
      if (!batch || Date.now() - batch.receivedAt > 45000) return
      for (const candidate of batch.candidates) {
        // Late candidates can belong to the previous call between these accounts.
        void connection.addIceCandidate(candidate).catch(() => {})
      }
    }

    function onRemoteIce({ from, to, session, candidate }: CallCandidate) {
      if (!ready() || to !== String(ctx.auth.state.user?.id)) return
      const attempt = active
      // The official client can send its candidates before its offer reaches us.
      if (attempt ? attempt.chatType !== 1 || attempt.peer !== from
        || session !== (attempt.incoming ? from + '-' + to : to + '-' + from)
        : session !== from + '-' + to) return
      let batch = remoteIce.get(session)
      if (!batch || Date.now() - batch.receivedAt > 45000) {
        remoteIce.delete(session)
        if (remoteIce.size >= 16) remoteIce.delete(remoteIce.keys().next().value!)
        batch = { receivedAt: Date.now(), candidates: [] }
        remoteIce.set(session, batch)
      }
      if (batch.candidates.length < 32) batch.candidates.push(candidate)
      if (attempt) applyRemoteIce(attempt)
    }

    function peerConnection(attempt: Attempt, stream: MediaStream) {
      const connection = attempt.connection = new RTCPeerConnection({ iceServers })
      const ice: NonNullable<Attempt['ice']> = attempt.ice = { session: attempt.incoming ? attempt.peer + '-' + attempt.account
        : attempt.account + '-' + attempt.peer, pending: [], sending: false }
      connection.onicecandidate = ({ candidate }) => {
        if (!candidate?.candidate || active !== attempt) return
        if (ice.sending) sendIce(attempt, candidate.toJSON())
        else if (ice.pending.length < 32) ice.pending.push(candidate.toJSON())
      }
      connection.ontrack = event => {
        if (active !== attempt) return
        const remote = state.remote || new MediaStream()
        if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track)
        state.remote = remote
      }
      connection.onconnectionstatechange = () => syncConnection(attempt)
      for (const track of stream.getTracks()) {
        const sender = connection.addTrack(track, stream)
        if (track.kind === 'audio') attempt.audioSender = sender
        else if (track.kind === 'video') attempt.videoSender = sender
      }
      if (!attempt.incoming) {
        if (!attempt.audioSender) attempt.audioSender = connection.addTransceiver('audio', { direction: 'sendrecv' }).sender
        if (attempt.kind === 'video' && !attempt.videoSender) attempt.videoSender = connection.addTransceiver('video', { direction: 'sendrecv' }).sender
      }
      return connection
    }

    async function start(conversation: { id: string; type: number; name?: string }, kind: CallKind) {
      if (!ready() || active || (conversation.type !== 1 && conversation.type !== 2) || !conversation.id
        || (conversation.type === 1 && conversation.id === String(ctx.auth.state.user?.id))) return
      const attempt = begin({
        room: crypto.randomUUID().replaceAll('-', ''), peer: conversation.id, name: conversation.name || conversation.id,
        chatId: conversation.id, chatType: conversation.type,
        kind, incoming: false,
      }, conversation.type === 2 ? 'selecting' : 'preparing')
      if (conversation.type === 1) await prepareOutgoing(attempt)
    }

    async function inviteGroup(invitees: string[]) {
      const attempt = active
      if (!attempt || attempt.chatType !== 2 || state.session?.phase !== 'selecting') return
      attempt.invitees = [...new Set(invitees)].filter(id => id && id !== attempt.account)
      if (!attempt.invitees.length) return
      update(attempt, 'preparing')
      await prepareOutgoing(attempt)
    }

    function joinVoiceRoom(chatId: string, room: GroupVoiceRoom) {
      if (!ready() || active || !chatId || !room.id) return
      const attempt = begin({
        room: room.id, peer: '', name: room.title, chatId, chatType: 2,
        kind: 'voice', incoming: false, voiceRoom: true,
      }, 'connecting')
      state.local = new MediaStream()
      state.microphone = false
      state.microphoneId = readMediaPreferences().microphone
      return connectGroup(attempt)
    }

    async function prepareOutgoing(attempt: Attempt) {
      try {
        const stream = await capture(attempt)
        if (!stream || active !== attempt) return
        if (attempt.kind === 'video') update(attempt, 'preview')
        else await dial(attempt)
      } catch (error) {
        close(attempt, undefined, mediaError(error))
      }
    }

    async function connectGroup(attempt: Attempt) {
      update(attempt, 'connecting')
      deadline(attempt, 30000, 'hang_up', '群通话连接超时')
      try {
        const { createGroupCallRoom } = await import('../core/group-call-room')
        if (active !== attempt) return
        const room = attempt.groupRoom = createGroupCallRoom({
          peers: peers => { if (active === attempt) state.groupPeers = peers },
          reconnecting: value => { if (active === attempt) update(attempt, value ? 'connecting' : 'connected') },
          disconnected: () => close(attempt, 'hang_up', '群通话连接已断开'),
        })
        const tokenRequest = attempt.voiceRoom
          ? ctx.api.enterGroupVoiceRoom(attempt.room, attempt.chatId, attempt.wire)
          : attempt.incoming
          ? attempt.joinToken ? Promise.resolve(attempt.joinToken) : ctx.api.joinGroupCall(attempt.room, attempt.wire)
          : ctx.api.startGroupCall(attempt.room, attempt.chatId, attempt.invitees || [], attempt.kind, attempt.wire)
        const operation = attempt.operation = tokenRequest.then(token => {
          attempt.joined = true
          return token
        })
        const token = await operation
        if (active !== attempt) return
        await room.connect(token, iceServers)
        if (active !== attempt) return
        for (const track of state.local?.getTracks() || []) {
          if (active !== attempt) return
          await room.replace(track, track.kind === 'video' && state.sharing ? state.screenProfile : undefined)
        }
        if (active !== attempt) return
        clearTimeout(attempt.timer)
        update(attempt, 'connected')
      } catch (error) { close(attempt, 'hang_up', mediaError(error)) }
    }

    async function dial(attempt = active) {
      if (!attempt || active !== attempt || attempt.incoming || attempt.operation || !state.local || state.audioPending || state.videoPending) return
      if (state.session?.phase !== 'preview' && state.session?.phase !== 'preparing') return
      if (!ready()) { close(attempt, undefined, '实时连接不可用，请重新连接后再试'); return }
      if (attempt.chatType === 2) { await connectGroup(attempt); return }
      update(attempt, 'dialing')
      try {
        const connection = peerConnection(attempt, state.local)
        const offer = callDescription(await connection.createOffer(), 'offer')
        if (!offer) throw new Error('未能生成有效的呼叫描述')
        await connection.setLocalDescription(offer)
        if (active !== attempt) return
        attempt.operation = ctx.api.startPrivateCall(attempt.room, attempt.peer, attempt.kind, offer, attempt.wire)
        await attempt.operation
        startIce(attempt)
        if (active === attempt && !attempt.joined) {
          update(attempt, 'ringing')
          deadline(attempt, 45000, 'cancel', '等待对方接听超时')
        }
      } catch (error) {
        close(attempt, attempt.operation ? 'cancel' : undefined, mediaError(error))
      }
    }

    async function accept() {
      const attempt = active
      if (!attempt || state.session?.phase !== 'incoming' || !ready() || (attempt.chatType === 1 && !attempt.offer)) return
      update(attempt, 'preparing')
      try {
        const stream = await capture(attempt)
        if (!stream || active !== attempt) return
        if (attempt.chatType === 2) { await connectGroup(attempt); return }
        const connection = peerConnection(attempt, stream)
        await connection.setRemoteDescription(attempt.offer)
        for (const transceiver of connection.getTransceivers()) {
          const kind = transceiver.receiver.track.kind
          if ((kind === 'audio' && !attempt.audioSender) || (kind === 'video' && !attempt.videoSender)) {
            transceiver.direction = 'sendrecv'
            if (kind === 'audio') attempt.audioSender = transceiver.sender
            else attempt.videoSender = transceiver.sender
          }
        }
        applyRemoteIce(attempt)
        const answer = callDescription(await connection.createAnswer(), 'answer')
        if (!answer) throw new Error('未能生成有效的接听描述')
        await connection.setLocalDescription(answer)
        if (active !== attempt) return
        attempt.joined = true
        update(attempt, 'connecting')
        attempt.operation = ctx.api.answerPrivateCall(attempt.room, answer, attempt.wire)
        startIce(attempt)
        await attempt.operation
        if (active !== attempt) return
        deadline(attempt, 22000, 'failed', '接听后未建立媒体连接')
        syncConnection(attempt)
      } catch (error) {
        close(attempt, attempt.chatType === 2 ? 'hang_up' : attempt.joined ? 'failed' : 'refuse', mediaError(error))
      }
    }

    async function syncIncoming(expectedRoom?: string) {
      if (!ready()) return
      lookup?.abort()
      const controller = lookup = new AbortController()
      const account = String(ctx.auth.state.user?.id)
      try {
        const data = await ctx.api.currentPrivateCall({ ...wire(), signal: controller.signal })
        if (controller.signal.aborted || !ready() || account !== String(ctx.auth.state.user?.id)) return
        const invite = readCallInvitation(data, account)
        if (invite && (!expectedRoom || expectedRoom === invite.room)) receive(invite)
      } catch { /* No active invitation or the connection changed. */ }
      finally { if (lookup === controller) lookup = null }
    }

    function receive(invite: Omit<CallView, 'phase' | 'incoming'> & { offer?: RTCSessionDescriptionInit | null; joinToken?: string }) {
      if (!ready() || retired.has(invite.room) || invite.peer === String(ctx.auth.state.user?.id)) return
      if (active) {
        if (active.room === invite.room) {
          if (invite.joinToken) active.joinToken = invite.joinToken
          if (active.chatType === 2 && invite.kindKnown !== false && state.session?.phase === 'incoming') {
            active.kind = invite.kind
            active.kindKnown = true
            update(active, 'incoming')
          }
        } else if (invite.chatType === 1) {
          remember(invite.room)
          void ctx.api.finishPrivateCall('busy', invite.room, wire()).catch(() => {})
        }
        return
      }
      const attempt = begin({ ...invite, incoming: true }, 'incoming')
      deadline(attempt, 45000, invite.chatType === 1 ? 'refuse' : 'hang_up', '来电已过期')
    }

    async function onSignal(signal: LiveCallSignal) {
      if (!state.enabled) return
      const attempt = active
      if (!attempt || attempt.room !== signal.room) {
        if (signal.cmd === 'live_video_user_cancel' || signal.cmd === 'live_video_user_hang_up') remember(signal.room)
        return
      }
      if (signal.chatType && signal.chatType !== attempt.chatType) return
      if (attempt.chatType === 2 && state.session?.phase !== 'incoming') return
      if (signal.user && signal.user !== attempt.peer && signal.user !== attempt.account) return
      const cmd = signal.cmd
      if (cmd === 'live_video_user_answer') {
        if (attempt.incoming || attempt.joined || !attempt.connection || !attempt.operation) return
        const answer = callDescription(signal.data, 'answer')
        if (!answer) { close(attempt, 'failed', '云湖返回的接听描述不可用'); return }
        attempt.joined = true
        update(attempt, 'connecting')
        deadline(attempt, 22000, 'failed', '已收到接听，但未建立媒体连接')
        try {
          await attempt.connection.setRemoteDescription(answer)
          applyRemoteIce(attempt)
          syncConnection(attempt)
        } catch (error) { close(attempt, 'failed', mediaError(error)) }
      } else if (cmd === 'live_video_user_handle') {
        if (attempt.incoming && !attempt.joined && signal.user === attempt.account) close(attempt, undefined, '来电已在其他设备处理')
      } else {
        const message = {
          live_video_user_cancel: '对方已取消呼叫', live_video_user_hang_up: '通话已结束',
          live_video_user_busy: '对方正忙', live_video_user_refuse: '对方已拒绝', live_video_user_failed: '对方的通话连接失败',
        }[cmd]
        if (message) close(attempt, undefined, message)
      }
    }

    function toggle(kind: 'audio' | 'video') {
      if (kind === 'video' && state.sharing) return
      const tracks = kind === 'audio' ? state.local?.getAudioTracks() : state.local?.getVideoTracks()
      if (!tracks?.some(track => track.readyState === 'live')) {
        if (kind !== 'audio' || !active || !['preview', 'connected'].includes(state.session?.phase || '') || state.audioPending) return
        const attempt = active
        state.microphone = true
        void replaceInput(attempt, 'audio', () => captureDevice('audio', state.microphoneId)).finally(() => {
          if (active === attempt && !state.local?.getAudioTracks().some(track => track.readyState === 'live')) state.microphone = false
        })
        return
      }
      const enabled = !tracks[0].enabled
      for (const track of tracks) track.enabled = enabled
      if (kind === 'audio') state.microphone = enabled
      else state.camera = enabled
      void active?.groupRoom?.setEnabled?.(kind, enabled).catch(() => {})
    }

    function setEnabled(value: boolean) {
      state.enabled = value && supported
      try { localStorage.setItem(key, state.enabled ? '1' : '0') } catch {}
    }

    let preferredDevices = readMediaPreferences()
    function syncMediaDevices(event: Event) {
      const next = (event as CustomEvent<MediaDevicePreferences>).detail
      if (!next) return
      const previous = preferredDevices
      preferredDevices = next
      if (!active || !['preview', 'connected'].includes(state.session?.phase || '')) return
      if (preferredDevices.microphone !== previous.microphone) {
        if (!state.local?.getAudioTracks().length) state.microphoneId = preferredDevices.microphone
        else void switchDevice('audio', preferredDevices.microphone)
      }
      if (preferredDevices.camera !== previous.camera) {
        if (state.sharing) state.cameraId = preferredDevices.camera
        else if (state.local?.getVideoTracks().length) void switchDevice('video', preferredDevices.camera)
        else state.cameraId = preferredDevices.camera
      }
    }

    ctx.on('ws/call', onSignal)
    ctx.on('ws/call-candidate', onRemoteIce)
    ctx.on('ws/group-call', (invite: GroupCallInvite) => {
      receive(invite)
      if (active?.room === invite.room && state.session?.phase === 'incoming' && active.kindKnown === false) void syncIncoming(invite.room)
    })
    ctx.on('ws/message', ({ cmd, msg }) => {
      if (!state.enabled || cmd !== 'push_message' || !callKind(msg?.type)) return
      const account = String(ctx.auth.state.user?.id)
      if (!msg.senderId || msg.senderId === account) return
      if ((msg.chatType === 1 && (!msg.recvId || msg.recvId === account))
        || (msg.chatType === 2 && msg.content?.call_invitees?.includes(account))) void syncIncoming(msg.id)
    })
    ctx.on('auth/logout', () => setIceServers('', '', '', ''))
    ctx.effect(() => {
      const stop = watch(() => [state.enabled, ctx.auth.state.status, ctx.auth.state.user?.id, ctx.ws.online, ctx.lock?.isLocked] as const, ([, , account], previous) => {
        if (account !== previous?.[2]) remoteIce.clear()
        if (active && active.account !== String(account)) end()
        if (!state.enabled || ctx.auth.state.status !== 'ready' || ctx.lock?.isLocked) {
          remoteIce.clear()
          lookup?.abort()
          end()
        } else if (ctx.ws.online) void syncIncoming()
      }, { immediate: true, flush: 'sync' })
      window.addEventListener('pagehide', end)
      window.addEventListener(mediaPreferencesEvent, syncMediaDevices)
      return () => {
        stop(); lookup?.abort(); end()
        window.removeEventListener('pagehide', end)
        window.removeEventListener(mediaPreferencesEvent, syncMediaDevices)
      }
    })
    function featureParticipant(id: string) { active?.groupRoom?.setFeatured?.(id) }

    ctx.set('calls', { state, supported, canShare, ready, setEnabled, setIceServers, start, confirm: () => dial(),
      accept, end, toggle, switchDevice, selectVideoSource, shareScreen, stopSharing, setScreenProfile, featureParticipant, inviteGroup, joinVoiceRoom })
  },
}
