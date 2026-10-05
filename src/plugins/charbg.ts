/**
 * 聊天背景插件
 * 接口：/v1/chat-background/{list,edit,delete}
 *   list   → [{ id, chatId, imgUrl, ... }]，chatId = 'all' 表示全局背景
 *   edit   → { userId, chatId, url }（url 是**文件名+扩展名**）
 * 优先级：当前会话专属背景 > 全局(all)背景 > 无
 */
import { reactive } from 'vue'
import type { Context } from '../core/context'
import BackgroundDialog from '../components/BackgroundDialog.vue'
import { resUrl } from '../core/res'

export const inject = ['api', 'chat', 'ui', 'console', 'auth']

export function apply(ctx: Context) {
  const api: any = ctx.get('api')
  const chat: any = ctx.get('chat')
  const ui: any = ctx.get('ui')

  const state = reactive({
    list: [] as any[],
    open: false,
    loading: false,
    urlInput: '',        // 手动填文件名/链接
  })

  async function load() {
    state.loading = true
    try { state.list = await api.chatBackgroundList() }
    catch (e: any) { ui.toast('背景列表加载失败：' + e.message, 'error') }
    finally { state.loading = false }
  }

  /** 当前会话该用哪张背景（会话专属优先，其次 all） */
  function bgUrlOf(chatId?: string) {
    const all = state.list.find((x: any) => x.chatId === 'all')
    const one = chatId ? state.list.find((x: any) => String(x.chatId) === String(chatId)) : null
    const hit = one || all
    return hit?.imgUrl || ''
  }

  /** 给聊天区域用的内联样式 */
  function bgStyleOf(chatId?: string) {
    const u = bgUrlOf(chatId)
    if (!u) return {}
    return {
      backgroundImage: `url("${resUrl(u)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'local',
    }
  }

  /** 设置背景：chatId 传 all 就是全局 */
  async function setBg(chatId: string, url: string) {
    const uid = ctx.get('auth')?.state?.user?.id
    if (!uid) return ui.toast('还没登录', 'error')
    try {
      await api.setChatBackground(uid, chatId || 'all', url)
      await load()
      ui.toast('背景已设置', 'success')
      state.open = false
    } catch (e: any) { ui.toast('设置失败：' + e.message, 'error') }
  }

  /**
   * 取消背景。
   * ⚠️ 云湖**没有删除背景的接口**（/v1/chat-background/delete 实测 404），
   *    正确做法是把 url 设成空字符串 —— edit 传空串会把这条设置直接清掉（实测有效）。
   */
  async function clearBg(chatId: string) {
    const uid = ctx.get('auth')?.state?.user?.id
    if (!uid) return ui.toast('还没登录', 'error')
    const hit = state.list.find((x: any) => String(x.chatId) === String(chatId))
    if (!hit) return ui.toast('这个范围没有设置过背景', 'warn')
    try {
      await api.setChatBackground(uid, chatId, '')
      await load()
      ui.toast('背景已取消', 'success')
    } catch (e: any) { ui.toast('取消失败：' + e.message, 'error') }
  }

  /** 上传一张图片当背景（复用 chat 的上传链路，拿裸文件名） */
  /**
   * 上传一张图当背景。
   * ⚠️ api.uploadFile 返回的是 **{ key, host } 对象**，不是字符串 ——
   *    之前直接当字符串用，url 变成 "[object Object]"，所以「上传背景」一直失败。
   * 云湖要求 url 是「文件名+扩展名」，uploadFile 给的裸 key 正好符合。
   */
  async function uploadBg(file: File) {
    const res: any = await api.uploadFile(file, 'image')
    const key: string = typeof res === 'string' ? res : (res?.key || '')
    if (!key) throw new Error('上传没有拿到文件名')
    state.urlInput = key
    ui.toast('上传好了，点「设为背景」应用', 'success')
    return key
  }

  ctx.set('charbg', {
    state, load, bgUrlOf, bgStyleOf, setBg, clearBg, uploadBg,
    openDialog() { state.open = true; load() },
    closeDialog() { state.open = false },
  })

  ctx.console.addEntry((cc: any) => {
    cc.slot({ type: 'global', component: BackgroundDialog, order: 52 })
  })

  // 插件装载时可能还没登录完，列表会拿到空 —— 所以会话一打开就补一次
  ctx.on('chat/open', () => { if (!state.list.length) load() })
  ctx.on('auth/ready', () => load())
  load()
  // 兜底：3 秒后再补一次（覆盖登录慢的情况）
  setTimeout(() => { if (!state.list.length) load() }, 3000)

  ctx.logger?.info('charbg 插件已加载（聊天背景）')
}
