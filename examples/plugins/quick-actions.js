/**
 * 示例插件：quick-actions
 * 演示「往聊天输入区加一个自定义按钮」
 *
 * 装好后：聊天输入框上方的按钮条会多一个「报时」按钮，点了发当前时间。
 */
export const name = 'quick-actions'

export function apply(ctx) {
  ctx.inject(['chat', 'ui'], (c) => {
    c.chat.composer('composer', [
      {
        id: 'qa.time',
        kind: 'quick',
        label: '报时',
        value: '',
        order: 150,
      },
    ], ctx)

    c.chat.action?.('composer.quick', {
      action: async () => {
        const t = new Date().toLocaleTimeString()
        await c.chat.send('现在时间：' + t)
        c.ui?.toast?.('已发送', 'success', 1200)
      },
    }, ctx)
  })
  ctx.logger?.info('quick-actions 插件已加载')
}
