import { contrastText, isHexColor } from './theme-colors'

/** 标签底色完全不透明，忽略上游 alpha；文字按实际底色选黑/白，避免被壁纸干扰。 */
export function groupTagStyle(value: unknown) {
  const color = typeof value === 'string' ? value.trim() : ''
  const opaque = /^#[\da-f]{8}$/i.test(color) ? color.slice(0, 7)
    : /^#[\da-f]{4}$/i.test(color) ? color.slice(0, 4) : color
  const backgroundColor = isHexColor(opaque) ? opaque : '#888888'
  return { backgroundColor, color: contrastText(backgroundColor) }
}

/** Sender.tag can contain memberships from multiple groups; private chats have no group tags. */
export function messageGroupTags(tags: any[], channel: any) {
  if (channel?.type !== 2) return []
  return (tags || []).filter(t => !t.groupId || String(t.groupId) === String(channel.id))
}
