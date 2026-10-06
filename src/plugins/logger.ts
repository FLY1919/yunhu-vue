/**
 * logs 插件 —— 包装 **cordis 自带的 logger**，把日志同时记进一份响应式列表给 UI 看。
 *
 * 为什么不能直接 ctx.set('logger', ...)：
 *   cordis 里 logger 是内核自带服务，重复注册会报 "service logger has been registered"。
 *   所以这里改成「在 cordis logger 上挂一层记录」，服务名用 `logs`（存日志列表）。
 *
 * 用法完全不变：
 *   ctx.logger.info('...')
 *   ctx.logger('插件名').warn('...')      ← cordis 原生支持带作用域
 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import LogsPage from '../console/pages/LogsPage.vue'

export const name = 'logger'

export interface LoggerCfg {
  maxLines: number
  level: string
}

export const loggerConfig: Schema<LoggerCfg> = Schema.object({
  maxLines: Schema.number().default(500).description('日志最多保留行数'),
  level: Schema.string().default('info').description('默认日志级别'),
})

export const loggerPlugin = {
  Config: loggerConfig,
  name: 'logger',
  provide: ['logs'],

  apply(ctx: any) {
    const state = reactive({ logs: [] as Array<{ level: string; text: string; t: number }> })

    const push = (level: string, args: any[]) => {
      state.logs.push({
        level,
        text: args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' '),
        t: Date.now(),
      })
      if (state.logs.length > 500) state.logs.shift()
    }

    // cordis 的 logger：本身是可调用函数（ctx.logger('名字') 拿子 logger），且带 .info/.warn/...
    const root: any = ctx.logger
    const LEVELS = ['debug', 'info', 'warn', 'error', 'success'] as const

    /** 给一个 logger 实例（含子 logger）挂上记录钩子 */
    const hook = (logger: any): any => {
      if (!logger || logger.__hooked) return logger
      for (const lv of LEVELS) {
        const orig = logger[lv]
        if (typeof orig !== 'function') continue
        logger[lv] = (...a: any[]) => {
          push(lv, a)
          try { return orig.apply(logger, a) } catch { /* 忽略 */ }
        }
      }
      const origExtend = logger.extend?.bind(logger)
      if (origExtend) {
        logger.extend = (...a: any[]) => hook(origExtend(...a))
      }
      try { Object.defineProperty(logger, '__hooked', { value: true, enumerable: false }) } catch { /* 忽略 */ }
      return logger
    }

    hook(root)

    const logs = {
      state,
      info: (...a: any[]) => root.info(...a),
      warn: (...a: any[]) => root.warn(...a),
      error: (...a: any[]) => root.error(...a),
      debug: (...a: any[]) => root.debug(...a),
      clear: () => state.logs.splice(0),
    }
    ctx.set('logs', logs)

    root.info('logger 插件已加载（包装 cordis logger）')
    ctx.effect(() => () => { /* 卸载：cordis 自动回收 logs 服务 */ })

    /* ---- 控制台扩展 ---- */
    ctx.inject(['console'], (c: any) => {
      c.console.menu('logger', [{ id: 'logger.clear', label: '清空' }])
      c.console.action('logger.clear', { action: () => logs.clear() })
      c.console.addEntry((cc: any) => {
        cc.page({ name: '日志', path: '/logs', icon: 'terminal', order: 800, component: LogsPage })
      })
    })
  },
}
