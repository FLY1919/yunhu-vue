import * as pb from './pb'

export type CallKind = 'voice' | 'video'
export type CallEnd = 'busy' | 'cancel' | 'failed' | 'hang_up' | 'refuse'
export interface GroupVoiceRoom {
  id: string
  title: string
  host: string
  count: number
}
const liveCommands = new Set([
  'live_video_user_answer', 'live_video_user_busy', 'live_video_user_cancel',
  'live_video_user_failed', 'live_video_user_handle', 'live_video_user_hang_up', 'live_video_user_refuse',
])

export const callContentType = (kind: CallKind) => kind === 'voice' ? 13 : 12
export const callKind = (type: number): CallKind | undefined => type === 13 ? 'voice' : type === 12 ? 'video' : undefined
export const callTitle = (kind: CallKind) => kind === 'voice' ? '语音通话' : '视频通话'

/** Official Content and SendMsgRequest fields, verified in the Android 1.6.32 release. */
export function callOfferRequest(id: string, peer: string, kind: CallKind, offer: RTCSessionDescriptionInit) {
  const content = pb.build(pb.fStr(7, JSON.stringify(offer)), pb.fStr(28, peer), pb.fStr(29, callTitle(kind)))
  return pb.build(pb.fStr(2, id), pb.fStr(3, peer), pb.fNum(4, 1), pb.fBytes(5, content), pb.fNum(6, callContentType(kind)))
}

export function groupCallRequest(id: string, groupId: string, invitees: string[], kind: CallKind) {
  // Group media is published after joining LiveKit, so room creation carries invitees rather than peer SDP.
  const content = pb.build(invitees.map(user => pb.fStr(28, user)), pb.fStr(29, callTitle(kind)))
  return pb.build(pb.fStr(2, id), pb.fStr(3, groupId), pb.fNum(4, 2), pb.fBytes(5, content), pb.fNum(6, callContentType(kind)))
}

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return value
  if (!value || value.length > 150_000) return null
  try { return JSON.parse(value) } catch { return null }
}

export function callDescription(value: unknown, type: 'offer' | 'answer'): RTCSessionDescriptionInit | null {
  const data = parseJson(value)
  return data?.type === type && typeof data.sdp === 'string' && data.sdp.length <= 100_000 && /^v=0\r?\n/.test(data.sdp)
    ? { type, sdp: data.sdp } : null
}

/** Official private-call ICE uses the caller/callee pair as its session ID. */
export function decodeCallCandidate(cmd: string, value: Uint8Array) {
  const fields = pb.decode(value)
  if (cmd === 'file_send_message' && pb.str(fields, 4) !== 'candidate') return null
  const data = parseJson(pb.str(fields, 5))
  const { from, to, session_id: session, candidate } = data || {}
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from === to
    || (session !== from + '-' + to && session !== to + '-' + from)) return null
  if (typeof candidate?.candidate !== 'string' || !candidate.candidate.startsWith('candidate:')
    || candidate.candidate.length > 2048) return null
  const mid = typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null
  const index = Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0
    && candidate.sdpMLineIndex < 65536 ? candidate.sdpMLineIndex : null
  if (mid === null && index === null) return null
  return { from, to, session, candidate: { candidate: candidate.candidate as string, sdpMid: mid, sdpMLineIndex: index } }
}

export type CallCandidate = NonNullable<ReturnType<typeof decodeCallCandidate>>

export function readCallInvitation(data: any, self: string) {
  const message = data?.message
  const chatType = Number(data?.chatType)
  const messageKind = callKind(Number(message?.contentType))
  if ((chatType !== 1 && chatType !== 2) || !messageKind || typeof message?.msgId !== 'string'
    || !message.msgId || typeof message.senderId !== 'string' || !message.senderId || message.senderId === self) return null
  const content = parseJson(parseJson(message.content))
  const users = content?.liveInviteUserIds
  if (Array.isArray(users) ? !users.some(id => String(id) === self) : chatType === 2) return null
  const kind = chatType === 2 && content?.liveType === '视频通话' ? 'video' : messageKind
  const chatId = chatType === 2 ? message.chatId : message.senderId
  if (typeof chatId !== 'string' || !chatId) return null
  const offer = callDescription(content?.formJson, 'offer')
  if (chatType === 1 && !offer) return null
  return { kind, offer, chatType, chatId, room: message.msgId, peer: message.senderId, name: String(data.senderNickname || message.senderId) }
}

export function decodeGroupCallInvite(value: Uint8Array) {
  const fields = pb.decode(value)
  const room = pb.str(fields, 1), peer = pb.str(fields, 2), chatId = pb.str(fields, 3)
  if (!room || !peer || !chatId || pb.num(fields, 4) !== 2) return null
  return { room, peer, chatId, chatType: 2, kind: 'voice' as CallKind, kindKnown: false,
    name: pb.str(fields, 8) || peer, joinToken: pb.str(fields, 6) }
}

export function decodeLiveCall(cmd: string, value: Uint8Array) {
  if (!liveCommands.has(cmd)) return null
  // LiveMessage: roomId=1, userId=2, chatId=3, chatType=4, cmd=5, data=6.
  const message = pb.decode(value)
  const room = pb.str(message, 1)
  if (!room || pb.str(message, 5) !== cmd) return null
  return {
    cmd, room, user: pb.str(message, 2), chat: pb.str(message, 3), chatType: pb.num(message, 4),
    data: parseJson(pb.str(message, 6)),
  }
}

export type LiveCallSignal = NonNullable<ReturnType<typeof decodeLiveCall>>
export type GroupCallInvite = NonNullable<ReturnType<typeof decodeGroupCallInvite>>
