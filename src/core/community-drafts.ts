/** Local drafts contain no credentials and are partitioned by the signed-in user. */
export interface CommunityDraft {
  id: string; owner: string; baId: number; boardName: string; postId?: number
  title: string; content: string; contentType: number; updatedAt: number
  cloudId?: number; legacy?: boolean
}
const key = (owner: string) => 'yh.community.drafts.v1:' + owner
export function readCommunityDrafts(owner: string): CommunityDraft[] {
  if (!owner) return []
  const value = JSON.parse(localStorage.getItem(key(owner)) || '[]')
  if (!Array.isArray(value)) throw new Error('草稿数据损坏，未覆盖原记录')
  return value.filter(d => d?.owner === owner && typeof d.id === 'string' && typeof d.content === 'string' && typeof d.title === 'string')
}
export function saveCommunityDraft(draft: CommunityDraft) {
  if (!draft.owner) throw new Error('请先登录再保存草稿')
  const all = readCommunityDrafts(draft.owner), index = all.findIndex(d => d.id === draft.id)
  if (index < 0 && all.length >= 30) throw new Error('本地草稿已达 30 篇，请先删除不需要的草稿')
  if (index < 0) all.unshift({ ...draft }); else all[index] = { ...draft }
  localStorage.setItem(key(draft.owner), JSON.stringify(all))
}
export function removeCommunityDraft(owner: string, id: string) {
  localStorage.setItem(key(owner), JSON.stringify(readCommunityDrafts(owner).filter(d => d.id !== id)))
}
/** Pure selection transforms shared by toolbar and keyboard shortcuts. */
export function markdownEdit(text: string, start: number, end: number, before: string, after = '', placeholder = '文字') {
  const selected = text.slice(start, end) || placeholder
  return { text: text.slice(0, start) + before + selected + after + text.slice(end), start: start + before.length, end: start + before.length + selected.length }
}
export function communityFlag(value: unknown) { return value === true || value === 1 || value === '1' }
