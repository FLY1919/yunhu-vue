import { createApp, reactive } from 'vue'
import StickerPanel from '../../src/components/StickerPanel.vue'
import '../../src/styles.css'
import '../../src/styles-m3.css'

const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%23677cb5"/%3E%3C/svg%3E'
const state = reactive({ panelOpen: true, list: [{ id: 101, name: '收藏一', url: image }, { id: 102, name: '收藏二', url: image }],
  packs: [{ id: 1, name: '我创建的', createBy: 'me', items: [{ id: 11, name: '我的表情', url: image }] },
    { id: 2, name: '其他合集', createBy: 'other', items: [{ id: 21, name: '别人的表情', url: image }] }],
  keyword: '', activeTab: 'fav' as string | number, locateSticker: null as any, browsePack: null as any, loading: false, packsLoading: false })
const calls: any[] = []
const ctx: any = {
  auth: { state: reactive({ user: { id: 'me' } }) }, confirmResult: true,
  api: {
    stickerRemovePack: async (id: number) => calls.push(['removePack', id]),
    stickerDeletePack: async (id: number) => calls.push(['deletePack', id]),
    stickerRemoveSticker: async (packId: number, id: number) => { calls.push(['removeSticker', packId, id]); const pack = state.packs.find(p => p.id === packId); if (pack) pack.items = pack.items.filter(i => i.id !== id) },
    stickerRenamePack: async (id: number, name: string) => { const pack = state.packs.find(p => p.id === id); if (pack) pack.name = name },
    stickerRenameSticker: async () => {},
  },
  ui: { toast: (...args: any[]) => calls.push(['toast', ...args]), confirm: async (...args: any[]) => { calls.push(['confirm', ...args]); return ctx.confirmResult } },
  stickers: { state, suggestPack: { id: 0 }, load: async () => {}, loadPacks: async () => {}, closeBrowse: () => { state.browsePack = null },
    send: (item: any) => calls.push(['send', item.id]), close: () => { state.panelOpen = false },
    topping: (item: any) => calls.push(['topFavorite', item.id]),
    remove: async (item: any) => { calls.push(['removeFavorite', item.id]); state.list = state.list.filter(i => i.id !== item.id) },
    addFromUrl: (url: string) => calls.push(['addFromUrl', url]), addFileToTarget: () => {}, },
}
createApp(StickerPanel).provide('ctx', ctx).mount('#app')
;(window as any).__stickerQA = { ctx, state, calls }
