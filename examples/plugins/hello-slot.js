/**
 * 示例插件：hello-slot
 * 演示「用户插件如何通过插槽往页面注入内容」
 *
 * 安装方式：控制台 → 插件市场 → 粘贴代码（或填 URL 指向本文件）
 *
 * ⚠️ 运行时插件的两个要点：
 *   1. 没有 Vue 编译器，必须用渲染函数 ctx.h(...)，不能用 template 字符串
 *   2. 用 ctx.inject(['console']) 等 console 服务就绪再注册插槽
 */
export const name = 'hello-slot'

export function apply(ctx) {
  ctx.inject(['console'], (c) => {
    c.console.slot({
      type: 'theme-bottom',   // 主题页的底部插槽
      order: 100,
      component: {
        render() {
          return ctx.h(
            'p',
            { style: 'padding:8px 12px;color:var(--fg2)' },
            '这是用户插件通过 theme-bottom 插槽注入的内容'
          )
        },
      },
    })
  })
  ctx.logger?.info('hello-slot 插件已加载')
}
