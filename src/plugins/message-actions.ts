/**
 * message-actions 插件 —— 消息操作（撤回 / 多选 / 转发 / 引用 / 全选）及其菜单
 * ------------------------------------------------------------------
 * 这个插件演示「不碰内核、只靠扩展点加功能」：
 *   chat.menu('message', [...])    往消息右键菜单塞条目
 *   chat.menu('selection', [...])  往多选工具栏塞条目
 *   chat.action(id, { action })    实现动作
 * 卸载本插件，所有菜单条目与动作会一起消失（副作用绑定在调用方上下文）。
 */
import { downloadMedia, revealMedia } from '../core/media'
import { copyImage } from '../core/image-clipboard'
import { resUrl } from '../core/res'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import ForwardDialog from '../components/ForwardDialog.vue'
import EditHistoryDialog from '../components/EditHistoryDialog.vue'
import EditDialog from '../components/EditDialog.vue'
import SelectAllButton from '../components/SelectAllButton.vue'

const messageImage = ({ msg, image }: any) => image || resUrl(
  msg?.elements?.find((el: any) => ['img', 'sticker'].includes(el.type) && el.attrs?.src)?.attrs.src
)

export const messageActionsPlugin = {
  name: 'message-actions',
  inject: ['chat', 'ui'],
  provide: ['messageActions'],

  apply(ctx: Context) {
    const chat = ctx.chat
    const ui = ctx.ui

    const state = reactive({
      forwardOpen: false,
      historyFor: null as any,      // 正在查看编辑历史的消息
      editingId: '',                // 正在编辑的消息 id
      forwardIds: [] as string[],
      targets: [] as Array<{ id: string; type: number; name?: string }>,
      keywords: '',
    })

    const service = {
      state,
      openForward(ids: string[]) {
        if (!ids.length) return ui.toast('先选中消息', 'warn')
        state.forwardIds = [...ids]
        state.targets = []
        state.keywords = ''
        state.forwardOpen = true
      },
      closeForward() { state.forwardOpen = false },
      toggleTarget(c: any) {
        const i = state.targets.findIndex(t => t.id === c.id)
        if (i >= 0) state.targets.splice(i, 1)
        else state.targets.push({ id: c.id, type: c.type, name: c.name })
      },
      isTarget(id: string) { return state.targets.some(t => t.id === id) },
      openHistory(msg: any) { state.historyFor = msg },
      closeHistory() { state.historyFor = null },
      async confirmForward() {
        if (!state.targets.length) return ui.toast('先选转发目标', 'warn')
        try {
          await chat.forward(state.forwardIds, state.targets)
          state.forwardOpen = false
        } catch (e: any) {
          ui.toast('转发失败：' + e.message, 'error')
        }
      },
    }
    ctx.set('messageActions', service)

    /* ---------------- 菜单 ---------------- */
    chat.menu('message', [
      { id: 'msg.reply', label: '引用', icon: 'quote', order: 10 },
      { id: 'msg.forward', label: '转发', icon: 'forward', order: 20 },
      { id: 'msg.copy', label: '复制文本', icon: 'copy', order: 30 },
      { id: 'msg.copy-image', label: '复制图片', icon: 'image', order: 31, when: p => !!messageImage(p) },
      {
        // 图片/表情消息右键收藏：表情直接收藏，图片转成表情收藏（云湖 /v1/expression/create）
        id: 'msg.fav', label: '添加到收藏', icon: 'star', order: 35,
        when: (p: any) => !!(p?.msg?.elements || []).some((e: any) => e.type === 'img' || e.type === 'sticker'),
      },
      {
        id: 'msg.edit', label: '编辑', icon: 'pencil', order: 25,
        // 只能编辑自己的文本 / markdown / html 消息
        when: (p: any) => !!p?.msg?.right && !p?.msg?.recalled && [1, 3, 8].includes(p.msg.type),
      },
      {
        id: 'msg.history', label: '查看编辑历史', icon: 'undo', order: 26,
        when: (p: any) => !!p?.msg?.edited,
      },
      { id: 'msg.select', label: '多选', icon: 'check', order: 40 },
      {
        // Reveal the attachment using the system file manager.
        id: 'msg.locate', label: '在文件夹中打开', icon: 'folder', order: 45,
        when: (p: any) => !!p?.msg && ['file', 'video', 'audio'].some((t) =>
          (p.msg.elements || []).some((e: any) => e.type === t)),
      },
      {
        id: 'msg.recall', label: '撤回', icon: 'undo', order: 90, danger: true,
        // 云湖允许管理员撤回他人消息，这里不再限制只有自己的；服务端会校验权限
        when: (p: any) => !!p?.msg && !p?.msg?.recalled,
      },
    ], ctx)

    chat.menu('selection', [
      { id: 'sel.all', label: '全选', order: 10 },
      { id: 'sel.invert', label: '反选', order: 11 },
      { id: 'sel.forward', label: '转发', order: 20 },
      {
        id: 'sel.recall', label: '撤回', order: 90, danger: true,
        when: () => chat.selectedMessages.length > 0 && chat.selectedMessages.every((m: any) => !m.recalled),
      },
      { id: 'sel.cancel', label: '取消', order: 100 },
    ], ctx)

    /* ---------------- 动作 ---------------- */
    chat.action('msg.reply', { action: ({ msg }: any) => chat.setReply(msg) }, ctx)

    /** 编辑自己的文本消息：打开编辑对话框（QQ 式轻量交互，无弹窗确认） */
    chat.action('msg.edit', {
      action: ({ msg }: any) => { state.editingId = msg.id },
    }, ctx)

    /** Download and reveal are distinct operations. */
    chat.menu('message', [{ id: 'msg.save', label: '下载文件 / 视频', icon: 'download', order: 65,
      when: (p: any) => !!p?.msg?.elements?.some((e: any) => ['file', 'video', 'audio'].includes(e.type)) }], ctx)
    chat.action('msg.save', { action: async ({ msg }: any) => {
      const media = msg.elements.find((e: any) => ['file', 'video', 'audio'].includes(e.type))
      try { if (await downloadMedia(media, ctx.api?.token)) ui.toast('下载完成', 'success') }
      catch (e: any) { if (e?.name !== 'AbortError') ui.toast('保存失败：' + e.message, 'error') }
    } }, ctx)

    chat.action('msg.locate', {
      action: async ({ msg }: any) => {
        const el = (msg.elements || []).find((e: any) => ['file', 'video', 'audio'].includes(e.type))
        if (!el) return
        try { await revealMedia(el) }
        catch (e: any) { ui.toast('打开文件位置失败：' + (e?.message || String(e)), 'error') }
      },
    }, ctx)

    chat.action('msg.forward', { action: ({ msg }: any) => service.openForward([msg.id]) }, ctx)

    chat.action('msg.copy', {
      action: async ({ msg }: any) => {
        const text = msg.content?.text || chat.previewOf(msg)
        try {
          await navigator.clipboard.writeText(text)
          ui.toast('已复制到剪贴板', 'success')
        } catch {
          // 非安全上下文没有 clipboard API，退化成 prompt
          ui.toast('复制失败，请检查系统剪贴板权限', 'error')
        }
      },
    }, ctx)

    chat.action('msg.copy-image', { action: async (payload: any) => {
      const image = messageImage(payload)
      if (!image) return
      try { await copyImage(image); ui.toast('图片已复制到剪贴板', 'success') }
      catch (error: any) { ui.toast('复制图片失败：' + (error?.message || '请检查剪贴板权限'), 'error') }
    } }, ctx)

    /** 收藏表情：取消息里第一张图/表情，直接进表情收藏（图片转表情） */
    chat.action('msg.fav', {
      action: ({ msg }: any) => {
        const el = (msg.elements || []).find((e: any) => e.type === 'img' || e.type === 'sticker')
        const src = el?.attrs?.src || ''
        // src 可能是裸 key，补成完整 URL（expression/create 要完整地址）
        const url = /^https?:/.test(src) ? src : `https://chat-img.jwznb.com/${src}`
        return (ctx as any).stickers?.addFromUrl?.(url)
      },
    }, ctx)

    chat.action('msg.select', { action: ({ msg }: any) => chat.startSelecting(msg.id) }, ctx)

    /** 查看历史编辑内容 */
    chat.action('msg.history', {
      action: ({ msg }: any) => { service.state.historyFor = msg },
    }, ctx)

    chat.action('msg.recall', {
      action: async ({ msg }: any) => {
        // 用户要求：撤回前弹确认对话框（防误触，撤回不可逆）
        if (!(await ui.confirm('撤回消息', `确定撤回这条消息？撤回后所有人都不再可见。`, { danger: true }))) return
        try {
          await chat.recall([msg.id])
          ui.toast(msg.right ? '已撤回' : `已撤回「${msg.sender}」的消息`, 'success')
        } catch (e: any) { ui.toast('撤回失败（可能没有管理员权限）：' + e.message, 'error') }
      },
    }, ctx)

    chat.action('sel.all', { action: () => chat.selectAll() }, ctx)

    chat.action('sel.invert', {
      action: () => {
        const all = chat.state.messages.map((m: any) => m.id)
        chat.state.selected = all.filter(id => !chat.state.selected.includes(id))
        chat.state.selecting = chat.state.selected.length > 0
      },
    }, ctx)

    chat.action('sel.forward', { action: () => service.openForward(chat.state.selected.slice()) }, ctx)

    chat.action('sel.recall', {
      action: async () => {
        const ids = chat.state.selected.slice()
        if (!(await ui.confirm('批量撤回', `确定撤回选中的 ${ids.length} 条消息？`, { danger: true }))) return
        await chat.recall(ids)
      },
    }, ctx)

    chat.action('sel.cancel', { action: () => chat.clearSelection() }, ctx)

    /* ---------------- 快捷键 ---------------- */
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (!chat.state.selecting) return
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); chat.selectAll() }
        if (e.key === 'Escape') chat.clearSelection()
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    })

    /* 演示插槽：往聊天标题栏右侧塞一个真实组件（证明其他插件能改这个页面） */
    ctx.effect(() => chat.slot({
      type: 'chat-header-extra',
      component: SelectAllButton,
      order: 10,
    }, ctx))

    ctx.logger?.info('message-actions 插件已加载（引用/转发/撤回/多选/全选）')

    /* ---------------- 控制台扩展：转发弹窗通过插槽挂到全局 ---------------- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addEntry((cc: any) => {
        cc.slot({ type: 'global', component: ForwardDialog, order: 50 })
        cc.slot({ type: 'global', component: EditHistoryDialog, order: 51 })
        cc.slot({ type: 'global', component: EditDialog, order: 52 })
      })
    })
  },
}
