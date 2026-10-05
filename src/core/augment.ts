/**
 * cordis 类型补充（声明合并）
 *
 * cordis 是强类型的：`ctx.xxx` 和 `ctx.on('事件')` 都要求先在 Context/Events 接口里声明。
 * Koishi 的插件也是这么做的 —— 在自己的包里 declare module 'cordis' 补上服务与事件。
 * 这里把本项目所有自定义服务名和事件名一次性补全，让类型检查通过、也有补全提示。
 */
import 'cordis'

declare module 'cordis' {
  interface Context {
    /* ---- 本项目注册的服务 ---- */
    app: any
    /** 本项目自己的配置服务（cordis 内置的 config 已被占用，故用 cfg） */
    cfg: any
    /** 日志列表（包装 cordis 的 logger 得到） */
    logs: any
    ui: any
    theme: any
    console: any
    api: any
    /** 对标 Koishi 的 ctx.http */
    http: any
    auth: any
    bots: any
    satori: any
    adapter: any
    chat: any
    ws: any
    messageActions: any
    group: any
    quickreply: any
    charbg: any
    /** Koishi 风格：ctx.session() 造会话对象 */
    commands: any
    stickers: any
    social: any
    botconsole: any
    community: any
    session: any
    /** 统一事件层：ctx.event.on/emit/history */
    event: any
  }

  interface Events {
    ready: (...args: any[]) => void
    'auth/login': (...args: any[]) => void
    'auth/logout': (...args: any[]) => void
    'auth/ready': (...args: any[]) => void
    'chat/open': (...args: any[]) => void
    'chat/incoming': (...args: any[]) => void
    'chat/reply': (...args: any[]) => void
    'chat/scroll-bottom': (...args: any[]) => void
    'chat/selection': (...args: any[]) => void
    'ui/toast': (...args: any[]) => void
    'ws/raw': (...args: any[]) => void
    'ws/message': (...args: any[]) => void
    'ws/draft': (...args: any[]) => void
    'ws/stream': (...args: any[]) => void
    'message-created': (...args: any[]) => void
    'message-updated': (...args: any[]) => void
    'message-recalled': (...args: any[]) => void
    'commands/pick': (...args: any[]) => void
  }
}

export {}
