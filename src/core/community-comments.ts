export const commentAuthorName = (comment: any) => String(
  comment?.senderNickname || comment?.senderName || comment?.sender?.nickname || comment?.sender?.name || comment?.senderId || '云湖用户'
)
export const commentAuthorAvatar = (comment: any) => String(
  comment?.senderAvatar || comment?.senderAvatarUrl || comment?.sender?.avatar || comment?.sender?.avatarUrl || comment?.avatar || comment?.avatarUrl || ''
)

const storageKey = (owner: string, post: string) => 'yh.community.comment-pin:' + owner + ':' + post
export function readCommentPin(owner: string, post: string) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(owner, post)) || 'null')
    if (typeof value?.id === 'string' && /^[0-9]+$/.test(value.id) && Number.isInteger(value.page) && value.page >= 1) {
      return value as { id: string; page: number }
    }
  } catch { /* Unavailable storage or an older invalid entry. */ }
  return null
}
export function writeCommentPin(owner: string, post: string, pin: { id: string; page: number } | null) {
  try {
    const key = storageKey(owner, post)
    if (pin) localStorage.setItem(key, JSON.stringify(pin))
    else localStorage.removeItem(key)
    return true
  } catch { return false }
}
