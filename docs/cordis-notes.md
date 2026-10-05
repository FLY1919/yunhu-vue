# 云湖第三方客户端 · 内核实测笔记（cordis 真实能力）

> 2026-10-05。为了把「Cordis 风格复刻」换成「真的 cordis」，我先写探针脚本问了 cordis 本人，
> 而不是凭记忆猜。以下全部是 3.18.1 的**实测结果**。

## 一、cordis 原生就有的能力（我原来是重复造轮子）

| ctx API | 说明 |
|---|---|
| `ctx.set(name, value)` / `ctx.get(name)` / `ctx.provide(name)` | 服务注册/读取 |
| `ctx.plugin(plugin, config)` | 装载插件，返回 `ForkScope`（可 `.dispose()`） |
| `ctx.inject(deps, cb)` | 依赖满足后执行（**等服务就绪的正规姿势**） |
| `ctx.effect(fn)` | fn 返回 disposer，插件卸载自动回滚 |
| `ctx.emit/on/once/parallel/bail/serial` | 事件系统（cordis 叫 **serial**，不叫 waterfall） |
| `ctx.setTimeout/setInterval/throttle/debounce` | timer 服务，随插件卸载自动清理 |
| `ctx.extend/scope/isolate` | 子上下文/作用域/隔离 |
| `ctx.logger` | **本身可调用**：`ctx.logger.info()` 和 `ctx.logger('作用域').info()` 都行 |

## 二、踩到的真坑（全部实测，不是猜的）

### 1. `logger` / `config` 是 cordis 内置名字，不能覆盖
```
ctx.set('logger', x)  → 抛错 "service logger has been registered"
ctx.set('config', x)  → 不抛错，但 ctx.get('config') 拿到的是 cordis 自己的 {}（没有 load）
                          我的配置服务被静默遮蔽 → 表现为 "ctx.config.load is not a function"
```
**解决**：日志服务改名 `logs`（用包装 cordis logger 的方式收集日志）；
配置服务改名 `cfg`。

### 2. `ctx.plugin()` 是异步调度的
```
appService.mount(configPlugin)
ctx.config.load()        // ✗ 此时插件还没跑完 apply，服务根本不存在
```
**解决**：装完用 `ctx.inject([name], cb)` 等服务就绪（加超时兜底）再装下一个。

### 3. `this.ctx` 在 Service 方法里会自动变成「调用方的 ctx」
这是 cordis 的 tracker 机制，和 Koishi 的 console 服务同一套。
所以**不需要**自己维护 `Context.current` 静态变量 —— 我原来的 600 行内核里那个就是多余的。
实测：插件里调 `svc.method()`，方法内 `this.ctx.get('callerFlag')` 能拿到调用方注册的服务。

### 4. 类型要在 `declare module 'cordis'` 里补
cordis 强类型：`ctx.xxx` 和 `ctx.on('事件')` 都要求先声明。
做法和 Koishi 插件一样 —— 见 `src/core/augment.ts`（补 20 个服务名 + 16 个事件名）。
补之前 77 个类型错误，补完 11 个，剩下的是 `effect` 回调必须返回 disposer。

## 三、迁移后的文件结构

```
src/core/context.ts   ← 从 600 行手写内核 变成 40 行 re-export（真的用 cordis）
src/core/augment.ts   ← cordis 服务/事件的声明合并
src/app.ts            ← 用 ctx.plugin() 装配插件 + app 服务（清单/热插拔）
src/plugins/logger.ts ← 包装 cordis logger，服务名 logs
```
