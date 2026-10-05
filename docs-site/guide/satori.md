# 消息元素（Satori）

内核把云湖各种 `content_type` 统一解析成 **Satori 元素树**，所以：

- **收**：消息会变成 `msg.elements`（元素数组）
- **发**：构造元素数组交给 `chat.sendMedia`，内核负责转成云湖格式

收发是同一种结构，不需要写两套代码。

## 元素与 contentType 对照

| 元素 | contentType | 说明 |
| --- | --- | --- |
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

## 发送示例

```ts
import { h } from '../satori/element'

// 文本
await ctx.chat.sendMedia([h.text('你好')])

// 图片：先上传拿到 key（裸文件名，不要加目录前缀）
const { key } = await ctx.api.uploadFile(file, 'image')
await ctx.chat.sendMedia([h.img(key)])

// 混排：一条消息里既有文字又有图片
await ctx.chat.sendMedia([h.text('看看这张：'), h.br(), h.img(key)])

// 语音（第二个参数是秒数）
await ctx.chat.sendMedia([h.audio(key, 12)])

// 视频
await ctx.chat.sendMedia([h.video(key, 30)])

// 表情
await ctx.chat.sendMedia([h.sticker(key, itemId, packId)])

// Markdown / HTML
await ctx.chat.sendMedia([h.md('**粗体**')])
await ctx.chat.sendMedia([h.html('<b>hi</b>')])
```

## 富文本渲染（看板 / 机器人输出）

看板与机器人输出常是「Markdown 与 HTML 混排」。内核提供两个函数：

```ts
import { renderRich, detectRichType } from '../core/render'

renderRich(text)      // 按片段自动判断：HTML 块净化保留，其余片段走 Markdown
detectRichType(text)  // 返回 'markdown' | 'html' | 'mixed' | 'plain'
```

> ⚠️ 早期实现是「整块二选一」：只要含一个 `<tag>` 就全部当 HTML，
> 里面的 Markdown 表格、标题会**完全不渲染**。现在是按片段判断，两边都能正确显示。

## 自定义气泡渲染器

想接管某类消息的渲染，注册一个渲染器即可：

```ts
ctx.chat.renderer({
  id: 'my-video',
  order: 10,
  match: ({ msg }) => msg.type === 10,
  render: MyVideoBubble,
}, ctx)
```

没有人认领时才会走内置渲染。插件卸载后渲染器自动移除。

## A2UI 卡片（content_type 14）

云湖的 A2UI 是 **v0.9 扁平组件协议**：

```json
{ "id": "root", "component": "Column", "children": ["t1", "b1"] }
{ "id": "b1", "component": "Button", "label": "点我", "action": { "name": "go" } }
```

`src/satori/a2ui.ts` 负责解析，`A2uiNode.vue` 负责递归渲染。
按钮点击会发出 `action` 事件，最终由 `api.a2uiFormReport` 回传给机器人。

> ⚠️ 曾经踩过的坑：解析器**只按单行**解析 JSON，而机器人发的多半是多行美化过的 JSON，
> 导致整块退化成纯文本、没有按钮。现在会先整体解析，失败再逐行尝试。
