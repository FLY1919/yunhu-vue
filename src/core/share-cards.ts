export type ShareTarget =
  | { kind: 'community'; id: number }
  | { kind: 'group'; id: string }

export type ShareCard = ShareTarget & { title: string; avatar?: string }

export function parseShareTarget(href: string, dataId = '', dataType = ''): ShareTarget | null {
  let id = dataId
  let type = dataType
  if (href) {
    try {
      const url = new URL(href)
      if (url.protocol !== 'yunhu:') return null
      id = url.searchParams.get('id') || dataId
      if (url.hostname === 'alley-detail') type = 'community'
      else if (url.hostname === 'chat-add') {
        type = url.searchParams.get('type') || dataType
        if (type !== 'group' && type !== '2') return null
      } else return null
    } catch { return null }
  }
  if (!/^\d+$/.test(id) || /^0+$/.test(id)) return null
  if (type === 'group' || type === '2') return { kind: 'group', id }
  const boardId = Number(id)
  if (['community', 'alley', 'board', 'ba'].includes(type) && Number.isSafeInteger(boardId)) {
    return { kind: 'community', id: boardId }
  }
  return null
}

export function shareTargetOf(link: HTMLAnchorElement) {
  return parseShareTarget(link.getAttribute('href') || '', link.dataset.yhId, link.dataset.yhType)
}

// Receives sanitized HTML. Keep mixed rich text intact and replace only standalone shares.
export function extractShareCard(html: string): ShareCard | null {
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  const [link, secondLink] = root.querySelectorAll<HTMLAnchorElement>('a')
  if (!link || secondLink) return null
  const target = shareTargetOf(link)
  if (!target) return null
  if ([...root.querySelectorAll('img, audio, video, hr, [data-a2ui-action]')].some(node => !link.contains(node))) return null
  const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let title = ''
  while (text.nextNode()) {
    const value = text.currentNode.textContent?.trim()
    if (!value) continue
    if (!link.contains(text.currentNode)) return null
    if (!title) title = value
  }
  const avatar = link.querySelector('img')?.getAttribute('src') || undefined
  return { ...target, title: title || (target.kind === 'community' ? '板块 ' : '群聊 ') + target.id, avatar }
}
