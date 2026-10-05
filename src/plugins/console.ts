/**
 * console 插件：提供控制台服务，并注册控制台自带的「插件」页面
 * 这正是 Koishi 里 @koishijs/plugin-console 的角色。
 */
import { ConsoleService } from '../console/service'
import PluginsPage from '../console/pages/PluginsPage.vue'

export const consolePlugin = {
  name: 'console',
  provide: ['console'],

  apply(ctx) {
    ctx.plugin(ConsoleService)

    // 后端注册一个前端可调用的接口
    ctx.console.addListener('console/overview', () => ({
      plugins: ctx.app.list(),
      services: [...ctx.app.services.keys()],
      pages: ctx.console.pages.map(p => ({ name: p.name, path: p.path, icon: p.icon })),
      version: ctx.app.version,
    }))

    // 客户端入口：插件自己的页面就注册在这里
    ctx.console.addEntry((cc) => {
      cc.page({
        name: '插件',
        path: '/plugins',
        icon: 'puzzle',
        order: 900,
        component: PluginsPage,
      })
    })

    ctx.logger?.info('console 服务已就绪')
  },
}
