/**
 * config 插件 —— 配置文件支持（对标 koishi.yml）
 * ------------------------------------------------------------------
 * · 配置存在项目根的 yunhu.config.yml，由 server 暴露 /config（GET/PUT）
 * · ctx.cfg 提供 get/set/all/toYaml/save/load
 * · 应用启动时先加载配置，再把 config.plugins.<key> 作为插件 config 传入
 * · 控制台「配置」页可直接编辑 YAML 并保存 / 应用重载
 */
import { reactive } from 'vue'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import type { Context } from '../core/context'
import ConfigPage from '../console/pages/ConfigPage.vue'

export interface AppConfig {
  app?: { theme?: string; title?: string; pollMs?: number }
  plugins?: Record<string, any>
  [key: string]: any
}

export const DEFAULT_CONFIG: AppConfig = {
  app: { theme: 'dark', title: '云湖 · 第三方客户端', pollMs: 4000 },
  plugins: {},
}

export const configPlugin = {
  name: 'config',
  provide: ['cfg'],

  apply(ctx: Context) {
    const state = reactive({
      data: { ...DEFAULT_CONFIG } as AppConfig,
      text: '',
      loaded: false,
      dirty: false,
      error: '',
      source: '',
    })

    const config = {
      state,

      all(): AppConfig { return state.data },

      /** 支持 'a.b.c' 路径取值 */
      get<T = any>(path: string, fallback?: T): T {
        const v = path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), state.data)
        return v === undefined ? (fallback as T) : (v as T)
      },

      plug(key: string) { return state.data?.plugins?.[key] ?? {} },

      toYaml() { return yamlDump(state.data, { lineWidth: 120, noRefs: true }) },

      /** 从 server 拉取 yunhu.config.yml */
      async load() {
        try {
          const res = await fetch('./config', { cache: 'no-store' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const text = await res.text()
          state.text = text
          const parsed = yamlLoad(text)
          state.data = (parsed && typeof parsed === 'object')
            ? { ...DEFAULT_CONFIG, ...(parsed as AppConfig) }
            : { ...DEFAULT_CONFIG }
          state.source = 'yunhu.config.yml'
          ctx.logger?.info('已加载配置文件 yunhu.config.yml')
        } catch (e: any) {
          state.data = { ...DEFAULT_CONFIG }
          state.source = '默认值（未找到配置文件）'
          ctx.logger?.warn('配置文件加载失败，使用默认值：' + e.message)
        }
        state.text = config.toYaml()
        state.loaded = true
        return state.data
      },

      /** 解析编辑框里的 YAML，暂存 */
      parse(text: string) {
        const parsed = yamlLoad(text)
        if (!parsed || typeof parsed !== 'object') throw new Error('配置不是一个对象')
        state.data = parsed as AppConfig
        state.dirty = true
        return state.data
      },

      /** 写回 server */
      async save() {
        const body = config.toYaml()
        const res = await fetch('./config', {
          method: 'PUT',
          headers: { 'Content-Type': 'text/yaml; charset=utf-8' },
          body,
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        state.dirty = false
        state.text = body
        return true
      },

      /**
       * 把某个插件的配置合并写回 yunhu.config.yml。
       * 这样界面上改的东西（快捷回复、主题…）才会真正落到配置文件里，
       * 而不是只存在浏览器 localStorage。
       */
      async savePlugin(key: string, patch: Record<string, any>) {
        if (!state.data.plugins) state.data.plugins = {}
        state.data.plugins[key] = { ...(state.data.plugins[key] || {}), ...patch }
        state.dirty = false
        await config.save()
        state.text = config.toYaml()
        return true
      },

      /** 应用到已装载插件：重挂载并带上新配置 */
      applyToApp() {
        const app = ctx.app as any
        for (const item of app.registry) {
          if (item.key === 'config') continue
          item.config = { ...(state.data.app || {}), ...config.plug(item.key) }
          if (item.fiber && item.fiber.state !== 'disposed') {
            item.fiber.dispose()
            item.fiber = null
          }
          app.mount(item)
        }
        // 重挂载会重建 auth/api/ws，这里恢复登录态
        setTimeout(() => { try { (ctx as any).auth?.restore?.() } catch { /* ignore */ } }, 0)
        ctx.logger?.info('配置已应用，插件已按新配置重载')
      },
    }

    ctx.set('cfg', config)   // 注意：'config' 已被 cordis 内置占用，只能用 cfg

    /* ---- 控制台扩展：配置页 ---- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addListener('config/current', () => ({
        text: config.toYaml(),
        source: state.source,
        dirty: state.dirty,
      }))
      ctx.console.action('config.save', {
        action: async () => { await config.save(); ctx.ui?.toast('配置已保存', 'success') },
      })
      ctx.console.addEntry((cc: any) => {
        cc.page({ name: '配置', path: '/config', icon: 'fileSettings', order: 880, component: ConfigPage })
      })
    })
  },
}
