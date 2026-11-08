/** 本机合集顺序：未记录的新合集保持服务端相对顺序，失效 ID 不影响显示。 */
export function orderStickerPacks<T extends { id: unknown }>(packs: T[], saved: string[]): T[] {
  const ranks = new Map(saved.map((id, index) => [String(id), index]))
  return [...packs].sort((a, b) => {
    const aRank = ranks.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER
    const bRank = ranks.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER
    return aRank - bRank
  })
}

export type StickerMove = 'top' | 'up' | 'down' | 'bottom'
export function moveStickerPack(ids: string[], target: string, direction: StickerMove): string[] {
  const result = [...ids]
  const from = result.indexOf(String(target))
  if (from < 0) return result
  const to = direction === 'top' ? 0 : direction === 'bottom' ? result.length - 1
    : direction === 'up' ? Math.max(0, from - 1) : Math.min(result.length - 1, from + 1)
  result.splice(from, 1)
  result.splice(to, 0, String(target))
  return result
}
