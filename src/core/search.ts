/** 会话与全局搜索共用相关度：名称/ID 精确匹配 → 前缀 → 包含 → 消息摘要。 */
export const normalizeSearch = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase()

function fieldRank(value: unknown, word: string) {
  const text = normalizeSearch(value)
  if (text === word) return 0
  if (text.startsWith(word)) return 1
  if (text.includes(word)) return 2
  return Infinity
}

export function searchRank(item: any, word: string) {
  const identity = Math.min(...[item.name, item.id, item.remark].map(value => fieldRank(value, word)))
  if (Number.isFinite(identity)) return identity
  return normalizeSearch(item.preview).includes(word) ? 3 : Infinity
}

/** 相关度相同保留输入顺序；全局搜索保留服务端的模糊匹配结果。 */
export function rankSearchResults<T>(items: T[], keyword: string, filter = false): T[] {
  const word = normalizeSearch(keyword)
  if (!word) return [...items]
  return items.map((item, index) => ({ item, index, rank: searchRank(item, word) }))
    .filter(hit => !filter || Number.isFinite(hit.rank))
    .sort((a, b) => (a.rank - b.rank) || a.index - b.index)
    .map(hit => hit.item)
}
