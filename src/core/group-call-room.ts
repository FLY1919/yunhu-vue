import { LocalVideoTrack, Room, RoomEvent, Track, VideoQuality, type LocalTrack, type RemoteParticipant } from 'livekit-client'
import { shareEncoding, shareTrackName, tuneShareSender, type ScreenShareProfile } from './screen-share'

export interface GroupCallPeer {
  id: string
  name: string
  stream: MediaStream
  hasVideo: boolean
  sharing?: boolean
  microphone?: boolean
  speaking?: boolean
  quality?: string
}

interface RoomHandlers {
  peers: (peers: GroupCallPeer[]) => void
  reconnecting: (value: boolean) => void
  disconnected: () => void
}

export function createGroupCallRoom(handlers: RoomHandlers) {
  const room = new Room({ dynacast: true })
  const local = new Map<string, LocalTrack>()
  const streams = new Map<string, MediaStream>()
  let featured = ''
  let closed = false
  let shareProfile: ScreenShareProfile | undefined

  const isShare = (publication: { source: Track.Source; trackName: string }) =>
    publication.source === Track.Source.ScreenShare || publication.trackName === shareTrackName

  function peer(participant: RemoteParticipant): GroupCallPeer {
    const publications = [...participant.trackPublications.values()]
    const videos = publications.filter(publication => publication.kind === Track.Kind.Video)
    const video = videos.find(publication => publication.track && !publication.isMuted && isShare(publication))
      ?? videos.find(publication => publication.track && !publication.isMuted)
    const audio = publications.filter(publication => publication.kind === Track.Kind.Audio && !publication.isMuted)
    const tracks = audio.flatMap(publication => publication.track ? [publication.track.mediaStreamTrack] : [])
    if (video?.track) tracks.push(video.track.mediaStreamTrack)
    let stream = streams.get(participant.identity)
    const oldTracks = stream?.getTracks()
    if (!stream || oldTracks?.length !== tracks.length || tracks.some(track => !oldTracks?.includes(track))) {
      stream = new MediaStream(tracks)
      streams.set(participant.identity, stream)
    }
    return {
      id: participant.identity, name: participant.name || participant.identity, stream, hasVideo: !!video,
      sharing: !!video && isShare(video), speaking: participant.isSpeaking,
      microphone: audio.some(publication => publication.source !== Track.Source.ScreenShareAudio),
      quality: participant.connectionQuality,
    }
  }

  function refresh() {
    if (closed) return
    for (const identity of streams.keys()) if (!room.remoteParticipants.has(identity)) streams.delete(identity)
    handlers.peers([...room.remoteParticipants.values()].map(peer))
  }

  function setFeatured(id: string) {
    featured = id
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        publication.setVideoQuality(isShare(publication) || !featured || participant.identity === featured
          ? VideoQuality.HIGH : VideoQuality.MEDIUM)
      }
    }
  }

  room.on(RoomEvent.ParticipantConnected, refresh)
    .on(RoomEvent.ParticipantDisconnected, refresh)
    .on(RoomEvent.ParticipantNameChanged, refresh)
    .on(RoomEvent.TrackPublished, refresh)
    .on(RoomEvent.TrackUnpublished, refresh)
    .on(RoomEvent.TrackSubscribed, () => { setFeatured(featured); refresh() })
    .on(RoomEvent.TrackUnsubscribed, refresh)
    .on(RoomEvent.TrackMuted, refresh)
    .on(RoomEvent.TrackUnmuted, refresh)
    .on(RoomEvent.ActiveSpeakersChanged, refresh)
    .on(RoomEvent.ConnectionQualityChanged, refresh)
    .on(RoomEvent.Reconnecting, () => { if (!closed) handlers.reconnecting(true) })
    .on(RoomEvent.Reconnected, () => { if (!closed) { refresh(); handlers.reconnecting(false) } })
    .on(RoomEvent.Disconnected, () => { if (!closed) handlers.disconnected() })

  async function publish(track: MediaStreamTrack, profile?: ScreenShareProfile) {
    // A detached window can supply a track from another JavaScript realm.
    const input = profile ? new LocalVideoTrack(track, track.getConstraints()) : track
    const publication = await room.localParticipant.publishTrack(input, {
      // The official client expects the picture in the camera slot, including desktop capture.
      source: track.kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera,
      videoCodec: 'vp8',
      ...(profile ? {
        name: shareTrackName, videoEncoding: shareEncoding(profile, track),
        simulcast: false, degradationPreference: 'maintain-resolution' as const,
      } : {}),
    })
    if (!closed && publication.track) {
      local.set(track.kind, publication.track)
      if (!track.enabled) await publication.track.mute()
    }
  }

  return {
    async connect(token: string, iceServers: RTCIceServer[]) {
      await room.connect('wss://livekit.jwznb.com', token, {
        autoSubscribe: true, ...(iceServers.length ? { rtcConfig: { iceServers } } : {}),
      })
      if (closed) { await room.disconnect(); return }
      refresh()
    },
    async replace(track: MediaStreamTrack, profile?: ScreenShareProfile) {
      if (closed) throw new Error('群通话已结束')
      const previous = local.get(track.kind)
      if (previous && (track.kind === 'audio' || (!shareProfile && !profile))) {
        const enabled = track.enabled
        await previous.replaceTrack(track, true)
        if (enabled) await previous.unmute()
        else await previous.mute()
        return
      }
      const previousTrack = previous?.mediaStreamTrack
      if (previous) {
        await room.localParticipant.unpublishTrack(previous, false)
        local.delete(track.kind)
      }
      if (closed) return
      try {
        await publish(track, profile)
        if (track.kind === 'video') shareProfile = profile
      } catch (error) {
        if (!closed && previousTrack?.readyState === 'live') await publish(previousTrack, shareProfile).catch(() => {})
        throw error
      }
    },
    async tuneShare(profile: ScreenShareProfile) {
      const video = local.get('video')
      if (shareProfile && video && !closed) {
        await tuneShareSender(video.sender, shareEncoding(profile, video.mediaStreamTrack))
        shareProfile = profile
      }
    },
    async setEnabled(kind: string, enabled: boolean) {
      const track = local.get(kind)
      if (track && !closed) await (enabled ? track.unmute() : track.mute())
    },
    setFeatured,
    async removeVideo() {
      const previous = local.get('video')
      if (!previous || closed) return
      await room.localParticipant.unpublishTrack(previous, true)
      local.delete('video')
      shareProfile = undefined
    },
    close() {
      if (closed) return
      closed = true
      streams.clear()
      local.clear()
      room.removeAllListeners()
      void room.disconnect().catch(() => {})
    },
  }
}

export type GroupCallRoom = ReturnType<typeof createGroupCallRoom>
