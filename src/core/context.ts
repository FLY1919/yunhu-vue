/**
 * 内核 —— 直接用真正的 cordis，不再自己复刻
 *
 * 之前这个文件是 600 行手写的「Cordis 风格」实现（Context/Service/Fiber/effect 全是复刻），
 * 现在整个删掉，改为 re-export cordis 本体：
 *
 *   ctx.set/get/has/provide      → cordis 原生（服务自动随插件卸载回收）
 *   ctx.plugin/inject/effect     → cordis 原生（Fiber 依赖注入、自动回滚）
 *   ctx.on/emit/parallel/bail/serial → cordis 原生事件系统
 *   ctx.logger                   → cordis 的 Logger（本身可调用，ctx.logger('名字') 拿子 logger）
 *   ctx.setTimeout/setInterval/throttle/debounce → cordis 的 timer 服务
 *   ctx.extend/scope/isolate     → cordis 原生
 *
 * 也就是说：凡是 Koishi 文档里写的 ctx 用法，这里都能直接用，因为我们跑的就是同一套内核。
 */
import { Context as CordisContext } from 'cordis'

export { Context, Service } from 'cordis'
export type { Plugin, Disposable } from 'cordis'

/** 旧的取消函数签名（cordis 的 effect 返回一个可 dispose 的东西） */
export type Disposer = () => void

/**
 * 建根 Context。
 * cordis 的 `new Context()` 自带 logger / timer / schema 等基础服务，
 * 不需要我们再手动 provide。
 */
export function createContext(): CordisContext {
  return new CordisContext()
}

/** 兼容旧代码：把各种 disposer 形态统一成函数 */
export function toDisposer(x: any): Disposer {
  if (typeof x === 'function') return x
  if (x && typeof x.dispose === 'function') return () => x.dispose()
  return () => {}
}
