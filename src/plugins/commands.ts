/**
 * commands 插件 —— 机器人指令
 *
 *   ctx.commands.load()      拉当前会话的指令（群指令 / 机器人指令）
 *   ctx.commands.open()      打开指令面板（含 X 关闭）
 *   ctx.commands.close()
 *   ctx.commands.use(it)     把一条指令塞进输入框（直发指令直接发出去）
 *
 * 交互：
 *   1) 聊天标题栏有「指令」入口（走 chat.slot 插槽，由本插件注入）
 *   2) 输入框里敲 `/` 自动弹出面板
 *   3) 面板按机器人归类（「指令机器人」分组），带搜索和 X
 */
import { reactive } from 'vue'
import type { Context } from '../core/context'
import CommandPanel from '../components/CommandPanel.vue'
import CommandButton from '../components/CommandButton.vue'

export const commandsPlugin = {
  name: 'commands',
  inject: ['api', 'chat', 'ui', 'console'],
  provide: ['commands'],

  apply(ctx: Context) {
    const api: any = ctx.api
    const chat: any = ctx.chat
    const ui: any = ctx.ui

    const state = reactive({
      list: [] as any[],
      loading: false,
      panelOpen: false,
      keyword: '',
      lastChatId: '',
    })

    /** 拉当前会话的指令 */
    async function load() {
      const cur = chat.state.current
      if (!cur) { state.list = []; return }
      state.loading = true
      state.lastChatId = cur.id
      try {
        // 群聊走 /v1/group/instruction-list；私聊/机器人走它自己的指令列表
        if (cur.type === 2) {
          state.list = await api.groupInstructions(cur.id, cur.type)
        } else {
          const list = await api.botInstructionsWeb(cur.id).catch(() => [])
          state.list = list.map((x: any) => ({ ...x, botId: cur.id, botName: cur.name }))
        }
      } catch (e: any) {
        state.list = []
      } finally { state.loading = false }
    }

    function open() { state.panelOpen = true; if (state.lastChatId !== chat.state.current?.id) load() }
    /** 输入框里打「/xxx」时调用：打开面板并把 xxx 当筛选词 */
    function openWith(kw: string) {
      state.panelOpen = true
      state.keyword = kw
      if (state.lastChatId !== chat.state.current?.id) load()
    }
    function close() { state.panelOpen = false }

    /**
     * 用一条指令（仿 TG / QQ）：
     *   1-普通指令      → 输入框插入「/指令名 」，光标停后面等用户补参数
     *   2-直发指令      → 直接发出去（这类指令不需要参数）
     *   5-自定义输入指令 → customJson 里是表单，插入「/指令名 」并提示需要填的字段
     *   其它/未知       → 一律按普通指令插入（不吞掉用户的输入）
     */
    function use(it: any) {
      const name = String(it.name || '').trim()
      if (!name) return
      const text = name.startsWith('/') ? name : '/' + name

      if (it.type === 2) {
        chat.send(text).catch((e: any) => ui.toast('发送失败：' + e.message, 'error'))
        close()
        return
      }

      // 自定义输入指令：把要填的字段名提示出来
      let hint = ''
      if (it.type === 5 && it.customJson) {
        try {
          const f = JSON.parse(it.customJson)
          const fields = (Array.isArray(f) ? f : (f.fields || f.components || [])).map((x: any) => x.title || x.name || x.id).filter(Boolean)
          if (fields.length) hint = '（需要填：' + fields.join(' / ') + '）'
        } catch { /* 忽略 */ }
      }

      // 用「斜杠 + 名字 + 空格」塞进输入框，光标停在末尾
      ctx.emit('commands/pick' as any, text + ' ')
      close()
      ui.toast(hint ? '已填入输入框 ' + hint : '已填入输入框，继续输入参数即可', 'success', 1800)
    }

    ctx.set('commands', { state, load, open, openWith, close, use })

    // 换会话时重拉
    ctx.on('chat/open' as any, () => { state.list = []; state.lastChatId = '' })

    load()
    ctx.logger?.info('commands 插件已加载（机器人指令）')

    /* 标题栏入口（插槽，卸载自动移除） */
    ctx.effect(() => chat.slot({ type: 'chat-header-extra', component: CommandButton, order: 5 }, ctx))

    // 用**聊天插槽**而不是 console 全局插槽：
    // console 的 global 渲染在 .page-area 外面，浮层会盖住左侧导航栏。
    ctx.effect(() => chat.slot({ type: 'global', component: CommandPanel, order: 61 }, ctx))
  },
}
