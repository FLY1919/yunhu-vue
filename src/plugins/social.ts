/**
 * social 插件 —— 通讯录 + 添加/创建
 *
 *   ctx.social.loadBook()                拉通讯录（用户 / 我加入的群聊 / 机器人）
 *   ctx.social.apply(id, chatType, msg)  发好友/群/机器人申请
 *   ctx.social.createGroup(name, intro)  创建群聊
 *   ctx.social.handleRequest(kind, id)   同意 / 忽略 / 删除申请
 *
 * 注册控制台页面「通讯录」。
 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import ContactsPage from '../console/pages/ContactsPage.vue'

export const name = 'social'

export interface SocialCfg {
  autoLoad: boolean
  pageSize: number
}

export const socialConfig: Schema<SocialCfg> = Schema.object({
  autoLoad: Schema.boolean().default(true).description('进入时是否自动加载通讯录'),
  pageSize: Schema.number().default(50).description('通讯录每页条数'),
})

export const socialPlugin = {
  Config: socialConfig,
  name: 'social',
  inject: ['api', 'ui', 'console'],
  provide: ['social'],

  apply(ctx: Context) {
    const api: any = ctx.api
    const ui: any = ctx.ui

    const state = reactive({
      book: { users: [], groups: [], bots: [] } as any,
      requests: [] as any[],
      loading: false,
      loaded: false,
      creation: { pending: false, error: '' },
    })
    let generation = 0
    let creating: AbortController | undefined
    ctx.on('auth/logout', () => {
      generation++
      creating?.abort(); creating = undefined
      state.creation.pending = false; state.creation.error = ''
      state.book = { users: [], groups: [], bots: [] }; state.requests = []; state.loading = false; state.loaded = false
    })
    ctx.effect?.(() => () => { generation++; creating?.abort(); creating = undefined })

    async function loadBook() {
      if (api.token === '' && !(ctx as any).auth?.state?.user?.id) return
      const version = generation
      state.loading = true
      try {
        const book = await api.addressBook()
        if (version === generation) { state.book = book; state.loaded = true }
      } catch (e: any) {
        if (version === generation) ui.toast('通讯录加载失败：' + e.message, 'error')
      } finally { if (version === generation) state.loading = false }
    }

    async function loadRequests() {
      if (api.token === '' && !(ctx as any).auth?.state?.user?.id) return
      const version = generation
      try { const requests = await api.friendRequests({ size: 30, page: 1 }); if (version === generation) state.requests = requests }
      catch { if (version === generation) state.requests = [] }
    }

    /** 发申请：chatType 1-用户 2-群聊 3-机器人 */
    async function apply(targetId: string, chatType = 1, message = '') {
      if (!targetId) return ui.toast('要填对方 ID', 'warn')
      try {
        await api.applyFriend(targetId, chatType, message)
        ui.toast('申请已发送', 'success')
      } catch (e: any) { ui.toast('发送失败：' + e.message, 'error'); throw e }
    }

    async function handleRequest(kind: 'agree' | 'ignore' | 'delete', id: number) {
      try {
        await api.handleRequest(kind, id)
        ui.toast(kind === 'agree' ? '已同意' : kind === 'ignore' ? '已忽略' : '已删除', 'success')
        await loadRequests()
        if (kind === 'agree') await loadBook()
      } catch (e: any) { ui.toast('操作失败：' + e.message, 'error') }
    }

    function cancelCreateGroup() { creating?.abort() }

    async function createGroup(name: string, introduction = '', avatarUrl?: string) {
      if (state.creation.pending) return null
      state.creation.error = ''
      const version = generation
      const controller = new AbortController()
      creating = controller
      state.creation.pending = true
      try {
        name = name.trim(); introduction = introduction.trim()
        const avatar = (avatarUrl ?? ctx.get('auth')?.state?.user?.avatar ?? '').trim()
        if (!name) throw new Error('群名称不能为空')
        if (!avatar) throw new Error('请填写群头像地址，或先设置个人头像')
        const id: string = await api.createGroup(name, introduction, avatar, { signal: controller.signal, timeout: 15000 })
        if (version !== generation || controller.signal.aborted) return null
        if (!id) throw new Error('缺少群 ID，请先刷新群列表确认，避免重复创建')
        // Commit the confirmed result immediately; background refresh must never hold the form open.
        if (!state.book.groups.some((g: any) => String(g.id) === id)) state.book.groups.unshift({ id, name, avatar, introduction })
        ui.toast(`群聊已创建（ID ${id}）`, 'success')
        void loadBook()
        void Promise.resolve().then(() => {
          if (version === generation) return (ctx as any).chat?.loadConversations?.(true)
        }).catch(() => { /* chat 插件负责刷新失败提示；建群已经成功 */ })
        return id
      } catch (e: any) {
        if (version !== generation) return null
        const uncertain = controller.signal.aborted || ['AbortError', 'TimeoutError', 'TypeError'].includes(e?.name)
        state.creation.error = uncertain
          ? '已停止等待，建群结果尚未确认。请先刷新群列表检查，避免重复创建。'
          : (e?.message || '创建群聊失败')
        ui.toast(state.creation.error, uncertain ? 'warn' : 'error')
        return null
      } finally {
        if (creating === controller) { creating = undefined; state.creation.pending = false }
      }
    }

    ctx.set('social', {
      state, loadBook, loadRequests, apply, handleRequest, createGroup, cancelCreateGroup,
      /** 通讯录分类 → 云湖 chatType */
      chatTypeOf(tab: 'users' | 'groups' | 'bots') { return tab === 'groups' ? 2 : tab === 'bots' ? 3 : 1 },
      users: () => state.book.users || [],
      groups: () => state.book.groups || [],
      bots: () => state.book.bots || [],
    })

    loadBook()
    loadRequests()
    ctx.on('auth/login', () => { generation++; state.loaded = false; loadBook(); loadRequests() })
    ctx.setTimeout(loadRequests, 4000)

    ctx.logger?.info('social 插件已加载（通讯录 / 添加 / 创建群聊）')

    ctx.console.addEntry((cc: any) => {
      cc.page({ name: '通讯录', path: '/contacts', icon: 'contacts', order: 150, component: ContactsPage })
    })
  },
}
