/**
 * botconsole 插件 —— 机器人管理控制台
 *
 *   ctx.botconsole.load()                 拉「我创建的机器人」
 *   ctx.botconsole.create(name, intro)    创建机器人
 *   ctx.botconsole.edit(id, patch)        改名称/简介/头像
 *   ctx.botconsole.resetToken(id)         重置 token
 *   ctx.botconsole.loadInstructions(bot)  看机器人指令
 *
 * 注册控制台页面「机器人」。
 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import BotConsolePage from '../console/pages/BotConsolePage.vue'

export const name = 'botconsole'

export interface BotConsoleCfg {
  autoLoad: boolean
}

export const botConsoleConfig: Schema<BotConsoleCfg> = Schema.object({
  autoLoad: Schema.boolean().default(true).description('进入时自动加载机器人列表'),
})

export const botConsolePlugin = {
  Config: botConsoleConfig,
  name: 'botconsole',
  inject: ['api', 'ui', 'console'],
  provide: ['botconsole'],

  apply(ctx: Context) {
    const api: any = ctx.api
    const ui: any = ctx.ui

    const state = reactive({
      list: [] as any[],
      total: 0,
      loading: false,
      createdId: '',
      instructions: [] as any[],
      instructionsOf: null as any,
      showInstructions: null as any,
    })

    async function load() {
      state.loading = true
      try {
        const r = await api.myBots()
        state.list = r.list
        state.total = r.total
      } catch (e: any) {
        ui.toast('机器人列表加载失败：' + e.message, 'error')
      } finally { state.loading = false }
    }

    async function create(name: string, introduction = '', isPrivate = false) {
      try {
        await api.createBot(name, introduction, '', isPrivate)
        // 响应是 protobuf，字段号没文档化；直接重新拉列表，把「新出现的那个」当成刚创建的
        const before = new Set(state.list.map((b: any) => b.id))
        await load()
        const fresh = state.list.find((b: any) => !before.has(b.id))
        state.createdId = fresh?.id || ''
        ui.toast('机器人已创建' + (state.createdId ? `（ID ${state.createdId}）` : ''), 'success')
      } catch (e: any) { ui.toast('创建失败：' + e.message, 'error') }
    }

    async function edit(botId: string, patch: any) {
      try {
        await api.editBot(botId, patch)
        ui.toast('已保存', 'success')
        await load()
      } catch (e: any) { ui.toast('保存失败：' + e.message, 'error') }
    }

    async function resetToken(botId: string) {
      if (!window.confirm('重置 Token 会让旧 Token 立刻失效，确定？')) return
      try {
        const t = await api.resetBotToken(botId)
        if (t) window.prompt('新 Token（已复制到提示框）：', t)
        ui.toast('Token 已重置', 'success')
        await load()
      } catch (e: any) { ui.toast('重置失败：' + e.message, 'error') }
    }

    async function loadInstructions(bot: any) {
      state.instructionsOf = bot
      state.showInstructions = bot
      state.instructions = []
      try { state.instructions = await api.botInstructions(bot.id || bot.botId) }
      catch (e: any) { ui.toast('指令加载失败：' + e.message, 'error') }
    }

    ctx.set('botconsole', { state, load, create, edit, resetToken, loadInstructions })

    load()
    ctx.logger?.info('botconsole 插件已加载（机器人控制台）')

    ctx.console.addEntry((cc: any) => {
      cc.page({ name: '机器人', path: '/bots', icon: 'robot', order: 160, component: BotConsolePage })
    })
  },
}
