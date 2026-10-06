# 插件开发指南

> 本文以「撤回消息」插件为完整案例，带你从零写一个能用的插件。
> 阅读前建议先看 `src/core/context.ts`（内核）与 `src/satori/element.ts`（消息元素）。

---

## 0. 一分钟写个插件

```ts
// src/plugins/hello.ts
import type { Context } from '../core/context'

export const helloPlugin = {
  name: 'hello',
  apply(ctx: Context) {
    ctx.logger?.info('hello 插件已加载')
    ctx.on('message-created', (session: any) => {
      if (session.content === '你好') session.send('你好呀')
    })
  },
}
```

注册它（`src/app.ts` 的 `registry`）：

```ts
{ key: 'hello', plugin: helloPlugin, desc: '示例插件' },
```

配置它（`yunhu.config.yml`）：

```yaml
plugins:
  hello: {}
```

完成。刷新页面即可在控制台「插件」页看到它，可装卸、可配置。

---

## 1. 内核概念

内核在 `src/core/context.ts`，对齐 [cordis](https://cordis.moe) / Koishi。

| 概念 | 说明 |
|---|---|
| `Context` | 上下文。`ctx.extend()` 派生子上下文；`ctx.root` 是根；`ctx.<服务名>` 直接访问服务 |
| `Fiber` | 一次插件加载实例，状态 `pending / active / disposed`，可 `reload()` / `deactivate()` / `dispose()` |
| `ctx.plugin(p, cfg)` | 装载插件，返回 Fiber |
| `Service` | 服务基类。**构造完成后**框架才会调 `start()` 注册服务 |
| `ctx.set(name, value)` | 注册（提供）一个服务 |
| `inject` | 声明依赖：`['a']` 或 `{ required: ['a'], optional: ['b'] }` |
| `ctx.inject(deps, cb)` | 语法糖，等于「带 using 的子插件」 |
| `ctx.effect(fn)` | 注册副作用，插件卸载时自动清理。`fn` 可返回清理函数 |
| `ctx.on / ctx.emit` | 全局事件总线 |

### inject 的三种行为（重点）

```ts
export const p = { name: 'p', inject: ['database'], apply(ctx) { ctx.database.find() } }
```

1. **服务不存在 → 插件不加载**（挂起在 `awaiting`，不是报错）
2. **服务实例被替换 → 插件自动回滚并重新加载**
3. **服务消失 → 插件回滚挂起；服务恢复 → 自动重新加载**

`optional` 依赖不会阻塞加载，也不会触发回滚：

```ts
export const inject = { required: ['database'], optional: ['console'] }
export function apply(ctx: Context) {
  if (ctx.console) ctx.console.addEntry(/* … */)   // 有控制台才注册
}
```

> 推荐写法：**整体依赖用 `inject` 声明；局部功能用 `ctx.inject([...], cb)` 包成子插件**。
> 这样子插件在服务热重载时会被正确卸载与重建，不会泄漏。

### 服务是「稳定转发代理」

`ctx.<服务名>` 返回的是一个按名字缓存的转发代理：

- 插件重载换掉服务实例后，**你早先缓存的引用依然有效**，会自动转发到新实例
- 代理取值会读 `app.revision`，所以 Vue 的 `computed` 能正确建立依赖

所以组件里可以放心写 `const chat = ctx.chat`，不必每次重新取。

---

## 2. 插件形态

三种都支持：

```ts
// ① 函数
export function apply(ctx: Context, config: Config) {}

// ② 对象（推荐，能带 name/inject/provide）
export const myPlugin = { name: 'my', inject: ['api'], provide: ['my'], apply(ctx, config) {} }

// ③ Service 类
export class MyService extends Service {
  constructor(ctx: Context) { super(ctx, 'my') }      // 不要在 super() 里注册！
  start() { super.start(); /* 字段初始化完之后再干别的 */ }
}
```

### 生命周期钩子

```ts
export const p = {
  name: 'p',
  apply(ctx) {
    ctx.logger?.info('加载')
    ctx.effect(() => {
      const stop = setInterval(tick, 1000)
      return () => clearInterval(stop)      // 卸载 / 重载时执行
    })
    ctx.on('dispose', () => ctx.logger?.info('卸载'))   // 也能监听 dispose 事件
  },
}
```

---

## 3. 读配置

插件 `apply(ctx, config)` 的第二个参数就是配置：

```yaml
# yunhu.config.yml
plugins:
  my:
    interval: 2000
    keywords: [你好, hi]
```

```ts
export const myPlugin = {
  name: 'my',
  apply(ctx: Context, config: any = {}) {
    const interval = config.interval ?? 1000
    const keywords = config.keywords ?? []
  },
}
```

`app` 段的公共配置（`title` / `theme` / `pollMs`）会与插件自己的配置合并后传入。

改完配置在控制台「配置」页点 **应用并重载插件** 即可生效。

---

## 4. 处理消息（Satori 元素树）

云湖的消息有 `content_type`（文本/图片/markdown/html/文件/A2UI…）。适配器已经把它们统一成 **元素树**，插件不用关心底层协议。

```ts
import { h } from '../satori'

ctx.on('message-created', (session) => {
  session.platform            // 'yunhu'
  session.selfId              // 自己的 id
  session.user                // { id, name, avatar }
  session.channel             // { id, type, name }  type: 1 用户 / 2 群 / 3 机器人
  session.isDirect            // 是否私聊
  session.id                  // 消息 id
  session.content             // 纯文本
  session.elements            // Element[]
  session.timestamp
  session.quoteId             // 引用的消息 id
  session.send(content)       // 回复（字符串或元素数组）
})

ctx.on('message-updated', (s) => {})
ctx.on('message-recalled', (s) => {})
```

### 构造消息

```ts
h.text('你好')
h.at('5546917', 'FLY_HX')
h.image('https://chat-img.jwznb.com/xxx.jpg')
h.a('https://example.com', [h.text('点我')])
h.markdown('# 标题\n**粗体**')
h.html('<b>HTML</b>')
h.file(url, 'a.zip', 1024)
h.audio(url, 3) / h.video(url, 10)
h.sticker(url, itemId, packId)
h.a2ui(json)
h.br()
```

多元素会按优先级选择云湖的 `content_type`；单元素（图片/表情/文件/语音/md/html/A2UI）会走对应的原生消息类型。

### 主动发送

```ts
const bot = ctx.bots[0]                       // adapter 插件提供
await bot.sendMessage({ id: '418769995', type: 2 }, [h.text('hi')])
await bot.sendMessage('418769995', 'hi', 2)   // 简写，默认群聊
await bot.recall({ id: '418769995', type: 2 }, msgId)
```

---

## 5. 扩展控制台（给插件加页面）

```ts
import MyPage from '../console/pages/MyPage.vue'

ctx.inject(['console'], (ctx) => {
  // ① 后端接口：前端用 send('my/xxx') 调
  ctx.console.addListener('my/list', () => ['a', 'b'])

  // ② 菜单动作（页面标题栏右侧）
  ctx.console.menu('my', [{ id: 'my.clear', label: '清空' }])
  ctx.console.action('my.clear', { action: () => {} })

  // ③ 客户端入口：注册页面 / 插槽
  ctx.console.addEntry((c) => {
    c.page({ name: '我的', path: '/my', icon: 'bolt', order: 200, component: MyPage })
    c.slot({ type: 'global', component: SomeWidget, order: 50 })   // 全局插槽
    c.slot({ type: 'status-left', component: StatusWidget })       // 状态栏左侧
  })
})
```

页面组件：

```vue
<script setup lang="ts">
import { inject, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'

const ctx = inject<any>('ctx')
const list = computed(() => ctx.config.plug('my'))
</script>

<template>
  <KLayout title="我的" desc="说明文字" menu="my">
    <KCard title="卡片"><pre>{{ list }}</pre></KCard>
  </KLayout>
</template>
```

可用的插槽：`global`（整个控制台）、`status-left`（状态栏左侧）。

---

## 6. 扩展聊天 UI（菜单 + 动作）

聊天页有一套和 `ctx.console` 同构的扩展点，挂在 `ctx.chat` 上：

```ts
// 注册菜单条目
ctx.chat.menu('message', [
  { id: 'my.pin', label: '置顶', order: 50, when: (p) => !p.msg.recalled },
])

ctx.chat.menu('selection', [        // 多选工具栏
  { id: 'my.export', label: '导出', order: 50 },
])

// 实现动作
ctx.chat.action('my.pin', { action: ({ msg }) => {} })
ctx.chat.action('my.export', { action: () => {} })
```

菜单条目字段：

| 字段 | 说明 |
|---|---|
| `id` | 动作 id |
| `label` | 显示文字 |
| `order` | 排序，小的在前（默认 100） |
| `danger` | 危险操作，显示为红色 |
| `when(payload)` | 返回 false 则不显示 |

动作 payload：消息菜单是 `{ msg, chat, ids }`；多选工具栏是 `{}`（自己去 `ctx.chat.state.selected` 取）。**它们都绑定在你的插件上下文里，卸载插件菜单项会一起消失。**

调试时打开浏览器控制台执行 `__yunhu.chat.menuOf('message', { msg: __yunhu.chat.state.messages[0] })` 就能看到当前菜单条目。

---

## 7. 完整案例：写一个「撤回消息」插件

目标：右键自己的消息 → 出现「撤回」→ 点击后调接口撤回，界面上标记为「消息已撤回」。

### 第 1 步：确认接口

`src/plugins/api.ts` 已经封装好了：

```ts
async recall(chatId, chatType, msgIds)   // 单条走 /v1/msg/recall-msg，多条走 /v1/msg/recall-msg-batch
```

对应 proto：

```protobuf
message RecallMsg {
  repeated string msg_id = 2;   // 要撤回的消息 id
  string chat_id = 3;
  ChatType chat_type = 4;
}
```

### 第 2 步：确认 chat 服务提供的能力

```ts
ctx.chat.state.current        // 当前会话 { id, type }
ctx.chat.state.messages       // 当前消息列表
ctx.chat.state.selected       // 多选 ids
ctx.chat.recall(ids)          // 撤回（含本地状态更新 + toast）
ctx.chat.menu(group, items)   // 注册菜单
ctx.chat.action(id, impl)     // 注册动作
```

### 第 3 步：写插件

```ts
// src/plugins/recall.ts
import type { Context } from '../core/context'

export const recallPlugin = {
  name: 'recall',
  inject: ['chat', 'ui'],        // 依赖 chat 与 ui 服务，缺一个就不加载
  provide: ['recall'],

  apply(ctx: Context, config: any = {}) {
    const chat = ctx.chat
    const ui = ctx.ui
    const confirmFirst = config.confirm !== false

    /* ---- 1. 注册菜单条目 ---- */
    chat.menu('message', [
      {
        id: 'recall.one',
        label: '撤回',
        order: 90,
        danger: true,
        // 只有「自己发的、还没被撤回的」消息才显示
        when: (p: any) => !!p?.msg?.right && !p?.msg?.recalled,
      },
    ])

    chat.menu('selection', [
      {
        id: 'recall.many',
        label: '撤回',
        order: 90,
        danger: true,
        // 选中的必须全是自己的、且都还没撤回
        when: () => {
          const list = chat.selectedMessages
          return list.length > 0 && list.every((m: any) => m.right && !m.recalled)
        },
      },
    ])

    /* ---- 2. 实现动作 ---- */
    chat.action('recall.one', {
      action: async ({ msg }: any) => {
        if (confirmFirst && !window.confirm('确定撤回这条消息？')) return
        await doRecall([msg.id])
      },
    })

    chat.action('recall.many', {
      action: async () => {
        const ids = chat.state.selected.slice()
        if (confirmFirst && !window.confirm(`确定撤回选中的 ${ids.length} 条消息？`)) return
        await doRecall(ids)
      },
    })

    async function doRecall(ids: string[]) {
      try {
        await chat.recall(ids)          // 内部：调接口 + 本地标记 + 清空选择 + toast
        ctx.emit('recall/done', ids)     // 广播事件，方便别的插件挂钩
      } catch (e: any) {
        ui.toast('撤回失败：' + e.message, 'error')
      }
    }

    /* ---- 3. 顺便加个快捷键：Ctrl+Z 撤回最近一条自己的消息 ---- */
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
        if (!chat.state.current) return
        const mine = [...chat.state.messages].reverse().find((m: any) => m.right && !m.recalled)
        if (mine) doRecall([mine.id])
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)   // 卸载自动解绑
    })

    ctx.logger?.info('recall 插件已加载')
  },
}
```

### 第 4 步：注册 & 配置

```ts
// src/app.ts
import { recallPlugin } from './plugins/recall'
// registry 里加一行：
{ key: 'recall', plugin: recallPlugin, desc: '撤回消息', provide: ['recall'], deps: ['chat', 'ui'] },
```

```yaml
# yunhu.config.yml
plugins:
  recall:
    confirm: true    # 撤回前二次确认
```

### 第 5 步：验证

1. `npm run dev`，登录
2. 右键自己发的一条消息 → 菜单里出现红色「撤回」
3. 点它 → 确认 → 消息变成「已撤回」
4. 在控制台「插件」页卸载 `recall` → 菜单里的「撤回」立刻消失（这就是副作用回收）
5. 控制台「事件」页能看到服务端推回的 `message-recalled`

### 第 6 步：扩展它

- 想加「批量撤回所有自己的消息」：`chat.state.messages.filter(m => m.right).map(m => m.id)` 一把梭
- 想加权限判断：`ctx.auth.state.user` 里判断 vip/角色
- 想加审计日志：`ctx.emit('recall/done', ids)` 这个事件已经被广播了，写另一个插件监听即可

---

## 8. 调试技巧

| 手段 | 用法 |
|---|---|
| 根上下文 | 浏览器控制台输入 `__yunhu` |
| 插件列表 | `__yunhu.app.list()` |
| 服务表 | `[...__yunhu.app.services.keys()]` |
| 已注册页面 | `__yunhu.console.state.pages` |
| 当前菜单 | `__yunhu.chat.menuOf('message', { msg: __yunhu.chat.state.messages[0] })` |
| 日志 | 控制台「日志」页，或 `ctx.logger.info()` |
| 运行时装载 | `__yunhu.app.mount(__yunhu.app.registry.find(r => r.key === 'my'))` |

---

## 9. 目录约定

```
src/plugins/<name>.ts          插件本体
src/console/pages/<Name>Page.vue   它注册的控制台页面
src/components/<Name>.vue      它注册的 UI 组件（插槽用）
```

新增插件的检查清单：

- [ ] 有 `name`
- [ ] 依赖用 `inject` 声明，局部功能用 `ctx.inject` 包成子插件
- [ ] 所有副作用都通过 `ctx.effect()` / `ctx.on()` 注册（保证卸载能回收）
- [ ] 配置项有默认值（`config.x ?? 默认`）
- [ ] 在 `src/app.ts` 的 registry 里加一行
- [ ] 在 `yunhu.config.yml` 里加上默认配置
- [ ] `npm run typecheck` 无错误


---

## 10. 发富消息（图片 / 文件 / 语音 / 视频 / 表情 / A2UI）

不要直接拼云湖的 `{content_type, content}` —— 构造 **Satori 元素树**，剩下交给内核：

```ts
import { h } from '../satori/element'

// 图片：先上传拿到 key（裸文件名，千万别加目录前缀）
const { key } = await ctx.api.uploadFile(file, 'image')
await ctx.chat.sendMedia([h.img(key)])

await ctx.chat.sendMedia([h.file(key, file.name, file.size)])   // 文件
await ctx.chat.sendMedia([h.audio(key, 12)])                   // 语音（12 秒）
await ctx.chat.sendMedia([h.video(key, 30)])                   // 视频
await ctx.chat.sendMedia([h.sticker(key, itemId, packId)])     // 表情
await ctx.chat.sendMedia([h.md('**粗体**')])                   // markdown
await ctx.chat.sendMedia([h.html('<b>hi</b>')])                // HTML
await ctx.chat.sendMedia([h.a2ui(json)])                       // A2UI 卡片

// 混排也行：一条消息里既有文字又有图片
await ctx.chat.sendMedia([h.text('看看这张：'), h.br(), h.img(key)])
```

对应关系（内核里 `ContentType`）：

| 元素 | contentType | 说明 |
|---|---|---|
| `h.text` | 1 | 纯文本 |
| `h.img` | 2 | 图片 |
| `h.markdown` | 3 | Markdown |
| `h.file` | 4 | 文件 |
| `h.form` | 5 | 表单 |
| `h.post` | 6 | 文章 |
| `h.sticker` | 7 | 表情 |
| `h.html` | 8 | HTML |
| `h.video` | 10 | 视频 |
| `h.audio` | 11 | 语音 |
| `h.a2ui` | 14 | A2UI 卡片 |

> 收到的消息已经统一成元素树了（`msg.elements`），所以**收和发是同一种结构**，不用写两套。

---

## 11. 常见坑清单（都是我踩出来的）

写插件前扫一眼，能省你几个小时：

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **模板用了变量没 import** | 组件整块不渲染，控制台还不一定报错 | 跑 `node scripts/preflight.mjs`（已接进 `npm run build`）|
| **给上传的 key 加目录前缀** | 发出去的图片 404 | 云湖约定 key 是**裸文件名**；只有表情包 zip 用 `stickerZip/` |
| **给 `/api` 代理加长缓存** | 改完资料读回来还是旧值 | `/api` 必须 `no-store`，只有 `/res` 能长缓存 |
| **`/v1/conversation/list` 带 body** | 只返回一部分会话 | body **必须完全留空** |
| **`ctx.config` / `ctx.logger`** | 静默拿到 cordis 内置对象，不是你的服务 | 本项目配置服务叫 **`cfg`**、日志叫 **`logs`** |
| **`ctx.plugin()` 后立刻取服务** | 拿到 undefined | cordis 是异步调度，用 `ctx.inject([name], cb)` 等服务就绪 |
| **注册表里的对象用 `includes` 去重** | 卸载插件后按钮清不掉 | 容器是 Vue `reactive`，读出来是代理对象；用 `toRaw` 或按 `id` 比 |
| **代理不转发 `Range`** | 视频/音频播不了 | 透传 `content-range` / `accept-ranges` / `content-length` |
| **A2UI 只按单行解析 JSON** | 卡片退化成纯文本、没有按钮 | 先整体 `JSON.parse`，失败再逐行 |
| **录音/录像直接调 `getUserMedia`** | 手机上连权限弹窗都没有 | 必须是**安全上下文**（https 或 localhost），非安全时给提示 |
| **浮层用 `console` 全局插槽** | 盖住左侧导航栏 | 用 `chat.slot({ type: 'global' })`，它渲染在内容区内 |
| **`console.navigate()`** | 静默什么都不做 | 用 `ctx.console.goto('/path')` |

---

## 12. ctx.session / ctx.event（发消息 & 事件，最省事的两个）

这两个服务由 `src/plugins/session-event.ts` 提供，灵感来自 Koishi 的 `ctx.session()` 与事件层。

### 12.1 ctx.session() —— 拿一个能直接发的会话

```ts
export const inject = ['session']
export function apply(ctx: Context) {
  // 不传参 = 绑定「当前打开的会话 + 当前机器人」
  const s = ctx.session()
  await s.send('你好')            // s.reply('你好') 等价
  console.log(s.channel.id)       // 目标频道 ID
  console.log(s.selfId)           // 自己的 ID
}
```

三种用法：

| 写法 | 含义 |
|---|---|
| `ctx.session()` | 当前会话（`ctx.chat.state.current`）+ 当前机器人 |
| `ctx.session({ id, type, name })` | 指定会话 |
| `ctx.session(rawMsg, { chatType: 2 })` | 由一条原始云湖消息造 Session（处理推送时常用） |

> ⚠️ 踩坑记录：直接走 Bot 发送时，服务端收到了但**本地消息列表不会上屏**
> （只有 `chat.send` 才有乐观上屏），使用者会以为自己没发出去。
> 所以 `session.send` 在「目标是当前会话 + 纯文本」时会自动改走 `chat.send`。

### 12.2 ctx.event —— 统一事件层

```ts
export const inject = ['event']
export function apply(ctx: Context) {
  // 订阅（返回取消函数）
  const off = ctx.event.on('message-created', (session) => {
    if (session.content === 'ping') session.send('pong')
  })

  // 触发自己的事件
  ctx.event.emit('my-plugin/done', { ok: true })

  // 查询历史
  ctx.event.history        // 最近 300 条（新 → 旧）
  ctx.event.last('message-created')
  ctx.event.list('message-created', 20)
  ctx.event.count('message-created')
  ctx.event.stats()        // { 'message-created': 12, ... }
  ctx.event.clear()

  off()                    // 取消订阅
}
```

被自动记进历史的事件：`message-created/updated/recalled`、`auth/login|logout|ready`、
`chat/open|incoming|reply`、`ws/raw`。控制台「事件」页就是读 `ctx.event.history`。

### 12.3 最小可用插件（收到 @我就回一句）

```ts
// src/plugins/echo.ts
import type { Context } from '../core/context'

export const echoPlugin = {
  name: 'echo',
  inject: ['session', 'event'],
  provide: ['echo'],
  apply(ctx: Context) {
    const off = ctx.event.on('message-created', async (s: any) => {
      if (!s?.content?.includes('@' + s.selfId)) return
      await s.send(`收到：${s.content}`)
    })
    ctx.effect(() => () => off())      // 插件卸载自动退订
    ctx.logger?.info('echo 插件已加载')
  },
}
```

再在 `src/app.ts` 的 `registry` 里加一行即可（`provide` / `deps` 写清楚，cordis 会自动处理依赖顺序）。


## 13. 插件市场：用户自己安装插件（运行时插件）

除了「源码里内置、随应用启动」的插件，用户还能在**运行时**安装插件：
控制台 → **插件市场**。

### 安装方式
| 方式 | 说明 |
| --- | --- |
| 从 URL 安装 | 填一个可直接访问的 `.js` 直链（GitHub raw / jsDelivr / 自建） |
| 粘贴代码 | 直接把插件源码粘进文本框 |

装好的插件存在 **IndexedDB**，刷新页面会自动重新装载；可**启用/禁用/卸载**。

### 插件格式
```js
export const name = 'my-plugin'        // 可选：插件名

export function apply(ctx) {           // 必需：入口
  // 注册页面 / 插槽 / 菜单 / 动作 …
}
```

装载机制：源码 → Blob URL → 浏览器原生 `import()` → 用 cordis `ctx.plugin()` fork 装载。
**卸载时 cordis 会自动回收插件注册的一切**（页面、插槽、菜单、按钮）。

### ⚠️ 运行时插件的两个关键限制（务必看）
1. **没有 Vue 编译器**：不能用 `template` 字符串写组件，必须用**渲染函数**：
   ```js
   component: {
     render() { return ctx.h('p', { style: 'color:var(--fg2)' }, 'Hello') }
   }
   ```
   `ctx.h` 由 market 插件挂载（就是 Vue 的 `h`）。
2. **服务可能还没就绪**：用 `ctx.inject(['console'], (c) => { ... })` 等服务可用后再注册。

### 安全提示
第三方插件运行在你的浏览器里，**能读到登录 token**。只安装你信任的来源。

## 14. 插槽（Slot）：往任意页面注入内容

对标 Koishi 的 `ctx.slot()`。页面用 `<KSlot :name="..." />` 声明扩展点，
插件用 `ctx.console.slot({ type, component, order })` 注入组件。

### 内置插槽
| 插槽 | 位置 |
| --- | --- |
| `global` | 整个应用（浮层、全局组件） |
| `status-left` | 底部状态栏左侧 |
| `chat-header-extra` | 聊天页标题栏右侧 |

### 页面级插槽（每个页面都有三个）
控制台页面通过 `KLayout` 的 `ns` 命名空间自动获得：

```
<ns>-header    页面标题栏（右侧按钮区）
<ns>-top       内容区上方
<ns>-bottom    内容区下方
```

`ns` 取值：`theme` / `settings` / `contacts` / `config` / `plugins` /
`community` / `stickers` / `bots` / `quickreply` / `logs` / `events` / `account` / `market`

例：往「主题」页底部注入内容 → `type: 'theme-bottom'`。

### 完整示例（可直接粘贴安装）
```js
export const name = 'hello-slot'
export function apply(ctx) {
  ctx.inject(['console'], (c) => {
    c.console.slot({
      type: 'theme-bottom',
      order: 100,
      component: {
        render() {
          return ctx.h('p', { style: 'padding:8px 12px' }, '插件注入的内容')
        },
      },
    })
  })
}
```

更多示例见仓库 `examples/plugins/`：
- `hello-slot.js` —— 往主题页注入内容（演示插槽）
- `quick-actions.js` —— 往输入区加按钮（演示 composer 扩展）


## 15. 各插件的配置项（控制台「配置 → 表单」可视化编辑）

以下插件都声明了 `Config: Schema<Config>`，配置页会**自动生成表单**，
改完点「保存」写回 `yunhu.config.yml`（实测落盘）。

| 插件 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `chat` | `pollMs` | 4000 | 轮询间隔（毫秒），调大省流 |
| `chat` | `pageSize` | 30 | 每次拉取消息条数 |
| `theme` | `preset` | dark | 默认配色预设 |
| `theme` | `radius` | 8 | 圆角（滑杆） |
| `social` | `autoLoad` | true | 进入时自动加载通讯录 |
| `social` | `pageSize` | 50 | 通讯录每页条数 |
| `community` | `pageSize` | 20 | 板块文章每页条数 |
| `community` | `autoLoadMine` | true | 启动时加载我的板块 |
| `stickers` | `panelOnStart` | false | 启动时展开表情面板 |
| `botconsole` | `autoLoad` | true | 自动加载机器人列表 |
| `logger` | `maxLines` | 500 | 日志保留行数 |
| `logger` | `level` | info | 默认日志级别 |
| `quickreply` | `enabled` | true | 是否启用快捷回复 |
| `quickreply` | `items` | 5 条 | 默认快捷回复（新增存 IndexedDB） |

### 给自己的插件加配置
```ts
export const name = 'my-plugin'
export const Config = Schema.object({
  foo: Schema.string().default('bar').description('一句话说明'),
  n: Schema.number().default(1).role('slider'),
})
// 然后在 app.ts 的 schemas() 映射表里登记：myplugin: myPluginConfig
```

⚠️ 两个已踩过的坑：
1. `interface Config` 与 `const Config` **同名**会让对象里的 `Config` 简写失效
   （被当成类型），改名如 `myPluginConfig` 再 `Config: myPluginConfig`。
2. `cfg.save()` 必须用**绝对路径** `/config`，相对路径 `./config` 在
   `/config` 路由下会变成 `/config/config`，导致保存假成功但不落盘。
