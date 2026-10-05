/**
 * 内核语义测试：inject 等待/回滚、服务级联卸载、effect 清理
 * 用法： node test-kernel.mjs
 */
import { createContext, Service } from './src/core/context'

const log = []
const ctx = createContext()

/* A：提供一个服务 */
class Foo extends Service {
  constructor(ctx) { super(ctx, 'foo', true); this.value = 1 }
}

/* B：依赖 foo，记录加载/卸载 */
const pluginB = {
  name: 'B',
  inject: ['foo'],
  apply(ctx) {
    log.push('B loaded, foo=' + ctx.foo.value)
    ctx.effect(() => () => log.push('B disposed'))
  },
}

/* C：不依赖，随便一个插件 */
const pluginC = { name: 'C', apply(ctx) { log.push('C loaded'); ctx.effect(() => () => log.push('C disposed')) } }

const fA = ctx.plugin(Foo)
const fB = ctx.plugin(pluginB)
const fC = ctx.plugin(pluginC)
log.push('services after mount: ' + [...ctx.app.services.keys()].join(','))

/* 卸载 A → foo 消失 → B 应被级联卸载，C 不受影响 */
fA.dispose()
log.push('services after unmount A: ' + ([...ctx.app.services.keys()].join(',') || '(空)'))

/* 重新装载 A → B 应自动恢复 */
const fA2 = ctx.plugin(Foo)
log.push('services after remount A: ' + [...ctx.app.services.keys()].join(','))

/* 服务值变化 → 依赖它的插件应回滚重载 */
const old = ctx.foo
ctx.set('foo', { value: 2, tag: 'v2' })
log.push('after foo replaced: services=' + ([...ctx.app.services.keys()].join(',')))

console.log(log.map((l, i) => `${String(i + 1).padStart(2)}. ${l}`).join('\n'))
console.log('\nC 是否仍然活着：', fC.state)
console.log('B 当前状态：', ctx.app.fibers.has(fB) ? 'old fiber' : '已被替换/回收')
