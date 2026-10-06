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
    })

    async function loadBook() {
      state.loading = true
      try {
        state.book = await api.addressBook()
      } catch (e: any) {
        ui.toast('通讯录加载失败：' + e.message, 'error')
      } finally { state.loading = false; state.loaded = true }
    }

    async function loadRequests() {
      try { state.requests = await api.friendRequests({ size: 30, page: 1 }) }
      catch { state.requests = [] }
    }

    /** 发申请：chatType 1-用户 2-群聊 3-机器人 */
    async function apply(targetId: string, chatType = 1, message = '') {
      if (!targetId) return ui.toast('要填对方 ID', 'warn')
      try {
        await api.applyFriend(targetId, chatType, message)
        ui.toast('申请已发送', 'success')
      } catch (e: any) { ui.toast('发送失败：' + e.message, 'error') }
    }

    async function handleRequest(kind: 'agree' | 'ignore' | 'delete', id: number) {
      try {
        await api.handleRequest(kind, id)
        ui.toast(kind === 'agree' ? '已同意' : kind === 'ignore' ? '已忽略' : '已删除', 'success')
        await loadRequests()
        if (kind === 'agree') await loadBook()
      } catch (e: any) { ui.toast('操作失败：' + e.message, 'error') }
    }

    async function createGroup(name: string, introduction = '') {
      try {
        const id: string = await api.createGroup(name, introduction)
        ui.toast(id ? `群聊已创建（ID ${id}）` : '群聊已创建', 'success')
        ctx.emit('chat/refresh' as any)
        await loadBook()
      } catch (e: any) { ui.toast('创建失败：' + e.message, 'error') }
    }

    ctx.set('social', {
      state, loadBook, loadRequests, apply, handleRequest, createGroup,
      /** 通讯录分类 → 云湖 chatType */
      chatTypeOf(tab: 'users' | 'groups' | 'bots') { return tab === 'groups' ? 2 : tab === 'bots' ? 3 : 1 },
      users: () => state.book.users || [],
      groups: () => state.book.groups || [],
      bots: () => state.book.bots || [],
    })

    loadBook()
    loadRequests()
    ctx.setTimeout(loadRequests, 4000)

    ctx.logger?.info('social 插件已加载（通讯录 / 添加 / 创建群聊）')

    ctx.console.addEntry((cc: any) => {
      cc.page({ name: '通讯录', path: '/contacts', icon: 'contacts', order: 150, component: ContactsPage })
    })
  },
}
