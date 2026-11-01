<script setup lang="ts">
import { vResourceMedia } from '../core/resource-media'
import { decodedImageUrl, downloadMedia } from '../core/media'
/**
 * Satori 元素树渲染器（消息正文的统一出口）。
 *
 * 内核把云湖各种 content_type 都 parse 成 Element[]，所以这里只处理一种结构，
 * 不再关心 content_type 是什么。包含：
 *   文本/Markdown/HTML/图片/表情/语音/视频/文件/提及/链接/引用/A2UI/表单/提示
 *
 * 自定义渲染器：先查 ctx.chat.rendererFor(...)（插件可注册气泡渲染器），
 * 没人认领才走下面这套内置分支。
 * A2UI 的 HTML 内嵌按钮（data-a2ui-action）用事件委托在根节点上统一接。
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick, inject, defineAsyncComponent } from 'vue'
import { resUrl, mediaUrl } from '../core/res'
import { renderMarkdown, sanitizeHtml, postProcess, linkify, renderRich } from '../core/render'
import { analyzeA2ui } from '../satori/a2ui'
import type { Element } from '../satori/element'
import A2uiNode from './A2uiNode.vue'
import Icon from '../console/components/Icon.vue'
import { saveImageCopy } from '../core/save-image'
import { openExternalUrl } from '../core/links'
const ImageEditor = defineAsyncComponent(() => import('./ImageEditor.vue'))

const props = defineProps<{
  elements: Element[]
  /** 引用块：{ sender, preview } */
  quote?: { sender: string; preview: string; id?: string; image?: string } | null
  /** 原始消息（自定义渲染器要用到） */
  msg?: any
}>()
const emit = defineEmits<{ (e: 'a2ui-action', a: any): void; (e: 'quote-jump', id: string): void }>()

const ctx = inject<any>('ctx')
const body = ref<HTMLElement | null>(null)
const failedImages = ref(new Set<string>())
const retryingImages = ref(new Set<string>())
function imageFailed(src: string, event: Event) {
  // Transparent offscreen placeholders are not upstream image failures.
  if ((event.target as HTMLImageElement).dataset.mediaState === 'source') failedImages.value.add(src)
}
async function retryImage(src: string) {
  if (retryingImages.value.has(src)) return
  retryingImages.value.add(src)
  try {
    const response = await fetch(resUrl(src), { cache: 'reload' })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    await response.blob()
    failedImages.value.delete(src)
  } catch (e: any) { ctx.ui?.toast?.('图片重试失败：' + (e?.message || String(e)), 'error') }
  finally { retryingImages.value.delete(src) }
}

/**
 * 自定义气泡渲染器（消息气泡插件化的落点）
 * 插件用 ctx.chat.renderer({ id, match, render }) 注册，谁先认领就用谁的组件；
 * 没人认领才走下面内置的这套元素渲染。
 */
const custom = computed(() => {
  try { return ctx?.chat?.rendererFor?.({ msg: props.msg, elements: props.elements, quote: props.quote }) || null }
  catch { return null }
})

const list = computed<Element[]>(() => {
  const result: Element[] = []
  for (const el of props.elements || []) {
    if (el.type === 'button' && Number.isInteger(el.attrs.rowIndex)) {
      let row = result[result.length - 1]
      if (!row || row.type !== 'button-row' || row.attrs.rowIndex !== el.attrs.rowIndex) {
        row = { type: 'button-row', attrs: { rowIndex: el.attrs.rowIndex }, children: [] }
        result.push(row)
      }
      row.children.push(el)
    } else result.push(el)
  }
  return result
})

/**
 * A2UI 完整版：HTML 里内嵌的按钮（data-a2ui-action）也要能点。
 * 用事件委托一次性覆盖整个元素容器，不需要给每个按钮单独绑。
 */
function onHtmlClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  // 群卡片深链：yunhu://chat-add?id=<群号>&type=group → 弹确认框（加入群聊/发消息/关闭）。
  // 双保险：href 万一被渲染管线剥掉，凭 data-yh-id 兜底识别
  const link = t?.closest?.('a[href^="yunhu://"], a[data-yh-id]') as HTMLAnchorElement | null
  if (link) {
    e.preventDefault()
    e.stopPropagation()
    openYunhuLink(link.getAttribute('href') || '', link.getAttribute('data-yh-id') || '', link.getAttribute('data-yh-type') || '')
    return
  }
  const btn = t?.closest?.('[data-a2ui-action]') as HTMLElement | null
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  emit('a2ui-action', {
    name: btn.getAttribute('data-a2ui-action') || '',
    sourceComponentId: btn.getAttribute('data-a2ui-id') || btn.getAttribute('data-a2ui-source') || '',
    context: {},
  })
}

/** 解析 yunhu:// 深链：chat-add（群卡片）→ 弹确认框（加入群聊 / 发消息 / 关闭）。
 *  已加入 → 按钮「发消息」直接进会话；未加入 → 「加入群聊」走官方
 *  /v1/friend/apply（chatType=2，官方注释「添加好友/加入群聊/机器人」同端点）。 */
const cardAsk = ref<{ id: string; type: number; name: string; joined: boolean } | null>(null)
async function openYunhuLink(href: string, dataId = '', dataType = '') {
  try {
    let id = dataId
    let type = Number(dataType) || 2
    if (href) {
      const u = new URL(href)
      if (u.protocol === 'yunhu:') {
        id = u.searchParams.get('id') || id
        type = Number(u.searchParams.get('type')) || type
      }
    }
    if (!id) return
    if (ctx.chat?.state?.current?.id === id) return   // 已在该群：无需弹窗
    await ctx.social?.loadBook?.()
    const hit = (ctx.social?.state?.book?.groups || []).find((g: any) => String(g.id) === id)
    cardAsk.value = { id, type, name: hit?.name || `群 ${id}`, joined: !!hit }
  } catch (e: any) {
    ctx.ui?.toast?.('打开群卡片失败：' + (e?.message || '链接无效'), 'error')
  }
}
/** 弹窗动作：发消息=进会话；加入群聊=发申请 */
function cardGo() {
  const c = cardAsk.value
  cardAsk.value = null
  if (!c) return
  const hit = (ctx.social?.state?.book?.groups || []).find((g: any) => String(g.id) === c.id)
  ctx.chat?.open?.({ id: c.id, type: c.type, name: hit?.name || c.name, avatar: hit?.avatar })
}
async function cardJoin() {
  const c = cardAsk.value
  cardAsk.value = null
  if (!c) return
  try {
    await ctx.social?.apply?.(c.id, 2, '通过群聊卡片申请加入')
    ctx.ui?.toast?.('加群申请已发送（开放群会直接加入）', 'success')
  } catch (e: any) { ctx.ui?.toast?.('加群失败：' + e.message, 'error') }
}
const renderedBodies = new WeakMap<Element, { source: any; html: string }>()
function cachedBody(el: Element, render: (source: any) => string) {
  const source = el.attrs.content, cached = renderedBodies.get(el)
  if (cached?.source === source) return cached.html
  const html = render(source); renderedBodies.set(el, { source, html }); return html
}
const mdHtml = (el: Element) => cachedBody(el, renderMarkdown)
const htmlHtml = (el: Element) => cachedBody(el, sanitizeHtml)

/** A2UI：可能是组件流 / HTML / 文本 */
function a2uiOf(el: Element) {
  return analyzeA2ui(el.attrs.data)
}

function formFields(el: Element) {
  const raw = el.attrs.data
  if (!raw) return null
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(j) ? j : (j.fields || j.components || null)
  } catch { return null }
}

/** 有宽高就用 aspect-ratio 占位（截图这种长图不会先撑成 0 高再跳） */
function ratioOf(el: Element) {
  const w = Number(el.attrs.width) || 0
  const h = Number(el.attrs.height) || 0
  if (!w || !h) return {}
  // 只用来占位，实际尺寸交给 CSS 的 max-width/max-height
  return { aspectRatio: `auto ${w} / ${h}` }
}

/** 点击图片/视频 → 页内灯箱查看（QQ 式），点空白处收起 */
const viewer = ref<{ kind: 'image' | 'video'; url: string } | null>(null)
const viewerVideo = ref<HTMLVideoElement | null>(null)
const editingImage = ref<File | null>(null)
const editLoading = ref(false)
const savingEdited = ref(false)
let editRequest: AbortController | undefined
let editedPreview = ''
let stopPan: (() => void) | undefined
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
function openRaw(src: string) {
  const u = resUrl(src)
  if (u) { viewer.value = { kind: 'image', url: u }; zoom.value = 1; pan.value = { x: 0, y: 0 } }
}
function openVideo(src: string) {
  const u = mediaUrl(src, 'video')
  if (u) { viewer.value = { kind: 'video', url: u }; zoom.value = 1; pan.value = { x: 0, y: 0 } }
}
/** 放大播放：开灯箱并直接进伪全屏（视频原生全屏键在 WebView2 常被拒） */
function openVideoFull(src: string) {
  openVideo(src)
  videoFull.value = true
  nextTick(() => {
    const v = viewerVideo.value
    if (v?.requestFullscreen) v.requestFullscreen().catch(() => {})
  })
}
/** 视频全屏：CSS 伪全屏铺满灯箱（WebView2 里 Fullscreen API 常被拒），原生全屏作增强 */
const videoFull = ref(false)
function toggleVideoFull() {
  videoFull.value = !videoFull.value
  const v = viewerVideo.value
  if (videoFull.value && v?.requestFullscreen) v.requestFullscreen().catch(() => {})
  if (!videoFull.value && document.fullscreenElement) document.exitFullscreen().catch(() => {})
}
function closeViewer() {
  editRequest?.abort(); editRequest = undefined; editLoading.value = false; editingImage.value = null
  stopPan?.(); viewer.value = null; videoFull.value = false
  if (editedPreview) { URL.revokeObjectURL(editedPreview); editedPreview = '' }
}
async function editImage() {
  if (editLoading.value || viewer.value?.kind !== 'image') return
  const target = viewer.value
  const request = new AbortController(); editRequest = request; editLoading.value = true
  try {
    const response = await fetch(target.url, { signal: request.signal })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const blob = await response.blob()
    if (request.signal.aborted || viewer.value !== target) return
    const name = /^(data|blob):/.test(target.url) ? 'image.png' : (target.url.split('?')[0].split('/').pop() || 'image.png')
    editingImage.value = new File([blob], name, { type: blob.type.startsWith('image/') ? blob.type : 'image/png' })
  } catch (e: any) { if (e.name !== 'AbortError') ctx.ui?.toast?.('图片打开失败：' + e.message, 'error') }
  finally { if (editRequest === request) { editLoading.value = false; editRequest = undefined } }
}
async function saveEdited(file: File) {
  if (savingEdited.value) return
  savingEdited.value = true
  const target = viewer.value
  let nextPreview = ''
  try {
    nextPreview = await decodedImageUrl(file)
    const path = await saveImageCopy(file, ctx.api?.token || '')
    if (viewer.value !== target) return
    const previousPreview = editedPreview
    editedPreview = nextPreview; nextPreview = ''
    viewer.value = { kind: 'image', url: editedPreview }; zoom.value = 1; pan.value = { x: 0, y: 0 }
    await nextTick()
    editingImage.value = null
    if (previousPreview) URL.revokeObjectURL(previousPreview)
    ctx.ui?.toast?.(path ? '图片副本已保存：' + path : '已导出图片副本', 'success', 5000)
  } catch (e: any) { if (e.name !== 'AbortError') ctx.ui?.toast?.('图片保存失败：' + e.message, 'error') }
  finally { if (nextPreview) URL.revokeObjectURL(nextPreview); savingEdited.value = false }
}
function viewerKey(e: KeyboardEvent) { if (e.key === 'Escape' && !editingImage.value && !ctx.lock?.isLocked) closeViewer() }
watch(viewer, value => { window.removeEventListener('keydown', viewerKey); if (value) window.addEventListener('keydown', viewerKey) })
onUnmounted(() => { closeViewer(); window.removeEventListener('keydown', viewerKey) })

/** 聊天里左键点表情 → 打开表情面板并定位到它所属合集中的那一张（圈线高亮）。
 *  传完整 attrs：packId 决定合集、itemId/expressionId 决定高亮哪张。 */
function openStickerPack(el: any, event?: MouseEvent) {
  if (event?.ctrlKey || event?.metaKey) { openRaw(el.attrs.src); return }
  const a = el.attrs || {}
  ctx.stickers?.openPackOf?.({
    packId: Number(a.packId) || 0,
    itemId: Number(a.itemId) || 0,
    expressionId: Number(a.expressionId) || 0,
  })
}
/** 滚轮缩放（以 1.25 步进，限 0.2–8 倍） */
function setMediaZoom(next: number, x = innerWidth / 2, y = innerHeight / 2) {
  const old = zoom.value
  zoom.value = Math.min(8, Math.max(.2, next))
  const factor = zoom.value / old
  pan.value = { x: (pan.value.x - x + innerWidth / 2) * factor + x - innerWidth / 2,
    y: (pan.value.y - y + innerHeight / 2) * factor + y - innerHeight / 2 }
}
function onWheel(e: WheelEvent) {
  if (!viewer.value || (e.target as HTMLElement)?.closest('.viewer-bar')) return
  e.preventDefault()
  // Mouse wheels commonly report pixel deltas too; plain wheel must zoom as requested.
  setMediaZoom(zoom.value * Math.exp(-e.deltaY * (e.deltaMode === 1 ? .08 : e.deltaMode === 2 ? .8 : .01)), e.clientX, e.clientY)
}
/** 拖拽平移（放大后看局部）。
 *  ⚠️ 拖完松手的 click 会命中 mask/img 的关闭逻辑——用户报「按住图片滑动松鼠标把灯箱关了」。
 *    记录本次是否真拖过（位移>3px），拖过则吞掉紧随的那一次 click。 */
let justDragged = false
function startPan(e: MouseEvent) {
  if (e.button !== 0 || zoom.value <= 1) return
  if (viewer.value?.kind === 'video' && e.offsetY >= (e.currentTarget as HTMLElement).clientHeight - 48) return
  stopPan?.()
  const sx = e.clientX, sy = e.clientY
  const ox = pan.value.x, oy = pan.value.y
  let moved = false
  const move = (ev: MouseEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy
    if (!moved && Math.hypot(dx, dy) > 3) { moved = true; justDragged = true }
    pan.value = { x: ox + dx, y: oy + dy }
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    stopPan = undefined
    // 稍后清标记：click 在 mouseup 之后同步派发，下一个宏任务再复位才吞得到
    setTimeout(() => { justDragged = false }, 0)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  stopPan = up
}
/** 灯箱关闭点击的统一守卫：刚拖过图则吞掉这次 click */
function closeViewerGuarded() {
  if (justDragged) return
  closeViewer()
}
/** 视频应用内全屏（requestFullscreen，不跳外部播放器） */
function fullVideo() {
  viewerVideo.value?.requestFullscreen?.().catch(() => {})
}

/** 文章卡片：页内弹窗看正文（markdown/HTML 净化渲染） */
const postView = ref<any>(null)
const postLoading = ref(false)
const postBody = ref<HTMLElement | null>(null)
// 弹窗正文渲染后把图片/资源链接改写到 /res 代理（防盗链 Referer，否则带图文章图全裂）
watch(postView, async (v) => {
  if (!v) return
  await nextTick()
  if (postBody.value) postProcess(postBody.value)
})
async function openPost(el: any) {
  const a = el.attrs || {}
  // 消息里可能只带 post_id 不带正文 → 拉详情补全（之前空弹窗的根因）
  if (!a.content && a.id) {
    postLoading.value = true
    postView.value = { ...a, content: '', loading: true }
    try {
      const d = await ctx.api?.baPostDetail?.(Number(a.id))
      // ⚠️ 详情响应正文常嵌套在 d.post 里（community.openPost 已验证）：
      //    只查 d.content 会拿到空正文 → 聊天里文章「打不开」。逐层兼容取值。
      const p = d?.post || d
      const body = p?.content ?? p?.body ?? p?.text ?? d?.content ?? d?.postContent ?? ''
      const title = p?.title ?? d?.title ?? a.title ?? '文章'
      postView.value = { title, content: body, id: a.id }
      if (!body) ctx.ui?.toast?.('这篇正文为空或已删除', 'warn')
    } catch (e: any) {
      postView.value = { title: a.title || '文章', content: `正文加载失败：${e.message}`, id: a.id }
    } finally { postLoading.value = false }
    return
  }
  postView.value = a
}
function closePost() { postView.value = null }

/** 消息按钮：1=链接，2=复制，3=回调；旧插件生成的无类型按钮仍按回调处理。 */
async function onMsgButton(el: any) {
  const m = props.msg
  if (!m) return
  try {
    const type = el.attrs.actionType
    if (type === 1) {
      if (!el.attrs.url) throw new Error('按钮没有可打开的链接')
      const link = new URL(el.attrs.url)
      if (link.protocol === 'yunhu:' && link.hostname === 'chat-add') await openYunhuLink(link.href)
      else await openExternalUrl(link.href)
      return
    }
    if (type === 2) {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持复制')
      await navigator.clipboard.writeText(String(el.attrs.value ?? ''))
      ctx.ui?.toast?.('已复制', 'success')
      return
    }
    if (type !== 3 && type !== null && type !== undefined) throw new Error('不支持的按钮类型')
    const current = ctx.chat?.state?.current
    const chatId = m.chatId || current?.id
    const chatType = m.chatType || current?.type
    const userId = ctx.auth?.state?.user?.id
    if (!m.id || !chatId || !chatType || !userId) throw new Error('消息或账号信息不完整')
    const value = type === null || type === undefined ? (el.attrs.value || el.attrs.text || '') : (el.attrs.value ?? '')
    await ctx.api.buttonReport({
      chatId, chatType, msgId: m.id, userId: String(userId), value: String(value),
    })
  } catch (e: any) { ctx.ui?.toast?.('按钮操作失败：' + (e?.message || '未知错误'), 'error') }
}

/**
 * 保存文件：优先系统「另存为」对话框（showSaveFilePicker，用户自己选目录、保留原文件名）；
 * 不支持时回退 server /local-open（GET，下载到文件保存目录并弹资源管理器）。
 * ⚠️ /local-open 只注册了 GET：POST 会落 SPA fallback 回 index.html（200 非 JSON）→ 旧版报「HTTP 200」失败。
 */
async function saveFile(el: any) {
  try { await downloadMedia(el); ctx.ui?.toast('已保存', 'success') }
  catch (e: any) { if (e?.name !== 'AbortError') ctx.ui?.toast('保存失败：' + e.message, 'error') }
}

async function fix() { await nextTick(); postProcess(body.value) }
onMounted(fix)
watch(() => props.elements, fix, { deep: true })
</script>

<template>
  <!-- 插件注册的自定义渲染器优先 -->
  <component v-if="custom" :is="custom.render"
             :msg="msg" :elements="elements" :quote="quote"
             v-bind="custom.props || {}" />

  <div v-else ref="body" class="els" @click="onHtmlClick">
    <!-- 引用块：点一下回到被引用的消息 -->
    <div v-if="quote" class="quote" :class="{ clickable: !!quote.id }" title="点击回到被引用的消息"
         @click.stop="quote.id && emit('quote-jump', quote.id)">
      <span class="q-bar"></span>
      <span class="q-name">{{ quote.sender }}</span>
      <img v-if="quote.image" class="q-thumb" v-resource-media="{ src: resUrl(quote.image), animated: true, width: 48, height: 48 }" alt="引用图片" />
      <span class="q-text">{{ quote.preview }}</span>
    </div>

    <template v-for="(el, i) in list" :key="i">
      <!-- 文本 / 换行 / 样式 -->
      <span v-if="el.type === 'text'" v-html="linkify(el.attrs.content)"></span>
      <br v-else-if="el.type === 'br'" />
      <b v-else-if="el.type === 'b'"><MessageElements :elements="el.children" /></b>
      <i v-else-if="el.type === 'i'"><MessageElements :elements="el.children" /></i>
      <code v-else-if="el.type === 'code'">{{ el.attrs.content }}</code>
      <pre v-else-if="el.type === 'pre'" class="pre">{{ el.attrs.content }}</pre>

      <!-- 提及 / 链接 -->
      <span v-else-if="el.type === 'at'" class="at">@{{ el.attrs.name || el.attrs.id }}</span>
      <a v-else-if="el.type === 'a'" :href="el.attrs.href" target="_blank" rel="noreferrer">
        <MessageElements :elements="el.children" />
      </a>

      <!-- 富文本 -->
      <div v-else-if="el.type === 'markdown'" class="rich" v-html="mdHtml(el)"></div>
      <div v-else-if="el.type === 'html'" class="rich" v-html="htmlHtml(el)"></div>

      <!-- 媒体 -->
      <!-- Shared viewport observation loads nearby media explicitly and releases offscreen decoders. -->
      <template v-else-if="el.type === 'img'">
        <img v-if="!failedImages.has(el.attrs.src)" class="media" v-resource-media="{ src: resUrl(el.attrs.src), animated: /(?:\.gif|\.webp)(?:[?#]|$)|^data:image\/(?:gif|webp)/i.test(el.attrs.src || ''), width: Number(el.attrs.width), height: Number(el.attrs.height) }" decoding="async"
             :style="ratioOf(el)" alt="[图片]" @click="openRaw(el.attrs.src)" @error="imageFailed(el.attrs.src, $event)" />
        <button v-else class="media-retry ghost" :disabled="retryingImages.has(el.attrs.src)" @click.stop="retryImage(el.attrs.src)"><Icon name="image" :size="22" /><span>{{ retryingImages.has(el.attrs.src) ? '正在重试…' : '图片加载失败 · 点击重试' }}</span></button>
      </template>
      <img v-else-if="el.type === 'sticker'" class="sticker" v-resource-media="{ src: resUrl(el.attrs.src), animated: true, width: 96, height: 96 }" decoding="async" alt="[表情]"
           title="点击查看所属合集 · Ctrl + 左键查看图片" style="cursor:pointer" @click.stop="openStickerPack(el, $event)" />
      <div v-else-if="el.type === 'video'" class="video-wrap">
        <video class="media" v-resource-media="{ src: mediaUrl(el.attrs.src, 'video') }" controls preload="none"></video>
        <!-- 放大按钮：WebView2 里视频原生控件的全屏键常被拒，给显式入口
             （开灯箱并直接进伪全屏），不再依赖原生 controls -->
        <button class="vfull" title="放大播放" @click.stop="openVideoFull(el.attrs.src)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
        <div class="video-actions"><span v-if="el.attrs.time" class="vtime">{{ el.attrs.time }}s</span><button class="ghost tiny" @click.stop="saveFile(el)"><Icon name="download" :size="14" /> 下载视频</button></div>
      </div>
      <audio v-else-if="el.type === 'audio'" v-resource-media="{ src: mediaUrl(el.attrs.src, 'audio') }" controls preload="none" />

      <!-- 文件（链接 + 保存按钮同属一个条件分支：⚠️ 必须用 template 包裹，
           中间插 v-if 会截断 v-else-if 链，导致每条消息多渲染一个兜底 pre） -->
      <template v-else-if="el.type === 'file'">
        <a class="file" :href="mediaUrl(el.attrs.src, 'file')" target="_blank" rel="noreferrer"
           :download="el.attrs.name || undefined">
          <span class="fico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/></svg></span>
          <span class="fmeta">
            <b>{{ el.attrs.name || '文件' }}</b>
            <small v-if="el.attrs.size">{{ (el.attrs.size / 1024).toFixed(1) }} KB</small>
          </span>
        </a>
        <button class="file-save" title="保存到本地文件目录" @click.stop="saveFile(el)">
          <Icon name="download" :size="14" /> 保存
        </button>
      </template>

      <!-- 云湖扩展 -->
      <div v-else-if="el.type === 'button-row'" class="msg-btn-row">
        <button v-for="(button, j) in el.children" :key="j" class="msg-btn" @click="onMsgButton(button)">{{ button.attrs.text }}</button>
      </div>
      <button v-else-if="el.type === 'button'" class="msg-btn"
              @click="onMsgButton(el)">{{ el.attrs.text || el.attrs.content || '按钮' }}</button>
      <span v-else-if="el.type === 'tip'" class="tip">{{ el.attrs.content }}</span>
      <span v-else-if="el.type === 'call'" class="tip"><Icon name="phone" :size="14" class="inline-icon" aria-hidden="true" /> {{ el.attrs.content || '语音通话' }}</span>
      <!-- 文章卡片：点击在页内打开正文（之前是死链接 @click.prevent 无处理 → 「点不开」） -->
      <button v-else-if="el.type === 'post'" class="post" @click.stop="openPost(el)">
        <b>{{ el.attrs.title || '文章' }}</b>
        <small v-if="el.attrs.content">{{ String(el.attrs.content).slice(0, 80) }}</small>
      </button>

      <!-- A2UI：组件流 / HTML / markdown 文本 -->
      <template v-else-if="el.type === 'a2ui'">
        <template v-if="a2uiOf(el)?.kind === 'a2ui'">
          <div class="a2ui">
            <div v-for="s in (a2uiOf(el) as any).surfaces" :key="s.id" class="a2ui-surface">
              <A2uiNode :id="s.root" :surface="s" @action="a => emit('a2ui-action', a)" />
            </div>
          </div>
          <div v-if="(a2uiOf(el) as any).rest" class="rich" v-html="renderMarkdown((a2uiOf(el) as any).rest)"></div>
        </template>
        <div v-else-if="a2uiOf(el)?.kind === 'html'" class="rich" v-html="sanitizeHtml((a2uiOf(el) as any).html)"></div>
        <div v-else class="rich" v-html="renderMarkdown((a2uiOf(el) as any)?.text || '')"></div>
      </template>

      <div v-else-if="el.type === 'form'" class="form">
        <template v-if="formFields(el)">
          <label v-for="(f, j) in formFields(el)" :key="j" class="ffield">
            <span class="flabel">{{ f.title || f.propsValue?.label || f.id }}</span>
            <input v-if="f.type === 'input'" :placeholder="f.propsValue?.placeholder || ''" disabled />
            <textarea v-else-if="f.type === 'textarea'" :placeholder="f.propsValue?.placeholder || ''" disabled></textarea>
            <select v-else-if="f.type === 'select' || f.type === 'radio'" disabled>
              <option v-for="(o, k) in String(f.propsValue?.options || '').split('#')" :key="k">{{ o }}</option>
            </select>
            <span v-else class="flabel">{{ f.propsValue?.defaultValue || f.type }}</span>
          </label>
        </template>
        <pre v-else class="pre">{{ el.attrs.data }}</pre>
      </div>

      <pre v-else class="pre">{{ el.attrs.content || ('[未支持的元素 ' + el.type + ']') }}</pre>
    </template>
  </div>

  <!-- 图片/视频灯箱：点空白收起；图片滚轮缩放+拖拽平移；视频可应用内全屏 -->
  <Teleport to="body">
    <div v-if="viewer" class="viewer-mask" :class="{ 'video-full': videoFull }" @click.self="closeViewerGuarded" @wheel="onWheel">
      <img v-if="viewer.kind === 'image'" :src="viewer.url" alt=""
           :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
           class="viewer-img" @click.self="closeViewerGuarded"
           @mousedown.prevent="startPan" @dblclick="zoom = zoom > 1 ? 1 : 2" />
      <video v-else ref="viewerVideo" :src="viewer.url" controls autoplay :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }" @mousedown="startPan"></video>
      <div class="viewer-bar">
        <template v-if="viewer">
          <button class="viewer-ctl" title="缩小" @click="setMediaZoom(zoom / 1.25)">−</button>
          <span class="viewer-zoom">{{ Math.round(zoom * 100) }}%</span>
          <button class="viewer-ctl" title="放大" @click="setMediaZoom(zoom * 1.25)">＋</button>
          <button class="viewer-ctl" title="还原" @click="zoom = 1; pan = { x: 0, y: 0 }">1:1</button>
          <button v-if="viewer.kind === 'image'" class="viewer-ctl" :disabled="editLoading" aria-label="编辑图片" :title="editLoading ? '加载中…' : '编辑图片'" @click="editImage"><Icon name="pencil" :size="15" /></button>
        </template>
        <template v-if="viewer.kind === 'video'">
          <!-- 全屏：CSS 伪全屏铺满灯箱（WebView2 里 Fullscreen API 常被拒），再试原生全屏作增强 -->
          <button class="viewer-ctl" :title="videoFull ? '退出全屏' : '全屏播放'" @click="toggleVideoFull">
            {{ videoFull ? '退出' : '全屏' }}
          </button>
        </template>
        <span class="grow"></span>
        <button class="viewer-ctl" title="关闭" @click="closeViewer">×</button>
      </div>
    </div>
    <ImageEditor v-if="editingImage" :file="editingImage" :saving="savingEdited" confirm-label="保存副本" @done="saveEdited" @close="editingImage = null" />
    <!-- 文章弹窗：标题 + 净化渲染正文，右上 × 关闭 -->
    <div v-if="postView" class="post-mask" @click.self="closePost">
      <div class="post-box">
        <div class="post-head">
          <b>{{ postView.title || '文章' }}</b>
          <button class="post-x" title="关闭" @click="closePost">×</button>
        </div>
        <div ref="postBody" class="post-body rich" v-html="renderRich(postView.content || '')"></div>
      </div>
    </div>
    <!-- 群卡片确认弹窗：加入群聊 / 发消息（已加入）/ 关闭 -->
    <div v-if="cardAsk" class="post-mask" @click.self="cardAsk = null">
      <div class="card-ask">
        <b>群聊卡片</b>
        <p>{{ cardAsk.name }}（群号 {{ cardAsk.id }}）</p>
        <div class="card-ask-row">
          <button v-if="cardAsk.joined" class="ca-btn primary" @click="cardGo">发消息</button>
          <button v-else class="ca-btn primary" @click="cardJoin">加入群聊</button>
          <button class="ca-btn" @click="cardAsk = null">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.els { display: block; }
.els > * { vertical-align: bottom; }
.msg-btn-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.msg-btn { flex: 1 1 auto; min-width: 0; max-width: 100%; padding: 6px 12px; border: 1px solid var(--line2); border-radius: 8px; background: var(--acc-soft); color: var(--acc); font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.msg-btn:hover { background: var(--acc); color: var(--on-acc); }

.quote {
  display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px;
  padding: 4px 8px; border-radius: 6px; font-size: 12px;
  background: rgba(127, 127, 127, .16); max-width: 100%;
}
.q-bar { width: 3px; align-self: stretch; border-radius: 2px; background: var(--acc); flex: 0 0 3px; }
.q-name { color: var(--acc); flex: 0 0 auto; }
.q-text { color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quote.clickable { cursor: pointer; }
.q-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.quote.clickable:hover { background: var(--acc-soft); }

.at { color: var(--acc); background: var(--acc-soft); border-radius: 5px; padding: 0 4px; }
.rich { color: var(--fg); }
.rich :deep(a) { color: var(--link, var(--acc)); text-decoration: underline; text-underline-offset: 2px; }
.rich :deep(code) { background: rgba(127, 127, 127, .18); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.rich :deep(pre) { background: rgba(0, 0, 0, .25); padding: 8px; border-radius: 8px; overflow-x: auto; }
.rich :deep(img) { max-width: 100%; border-radius: 8px; }
.rich :deep(blockquote) { padding-left: 8px; border-left: 3px solid var(--line); opacity: .85; }
.media { max-width: min(320px, 100%); max-height: 460px; border-radius: 10px; display: block; object-fit: contain; cursor: zoom-in; background: var(--card2); }
.media-retry { display: flex; align-items: center; gap: 10px; min-height: 72px; max-width: 100%; padding: 16px; white-space: normal; text-align: left; border: 1px solid var(--line); border-radius: 10px; }
/* 两个 HTML 尺寸属性不能各自被 max-width/max-height 截断成固定黑框。 */
img.media { width: min(320px, 100%, var(--media-natural-width, 320px), var(--media-fit-width, 320px)); height: auto; max-height: none; }
/* 文件气泡旁的保存按钮 */
.file-save {
  align-self: center; margin-left: 6px; padding: 4px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--card2); color: var(--fg2);
  font-size: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
}
.file-save:hover { color: var(--acc); border-color: var(--acc); }
/* markdown 消息行距收紧（用户反馈隔行空太大）：
   段落只留下边距、不留上边距，避免相邻段 margin 叠加成双倍空隙 */
.rich { line-height: 1.5; }
.rich :deep(p) { margin: 0 0 2px; }
.rich :deep(p:last-child) { margin-bottom: 0; }
.rich :deep(h1), .rich :deep(h2), .rich :deep(h3) { margin: 4px 0 2px; }
.rich :deep(ul), .rich :deep(ol) { margin: 2px 0; padding-left: 20px; }
.rich :deep(li) { margin: 0; }
.rich :deep(pre) { margin: 4px 0; }
.rich :deep(blockquote) { margin: 2px 0; }
/* 灯箱（Teleport 到 body，scoped 样式需 :deep 或直接写全局类） */
.viewer-mask {
  position: fixed; inset: 0; z-index: 92; background: rgba(0, 0, 0, .82);
  display: grid; place-items: center; cursor: zoom-out; backdrop-filter: blur(3px);
  overflow: hidden;
}
.viewer-img { transition: transform .08s linear; cursor: grab; }
.viewer-mask img, .viewer-mask video {
  max-width: 92vw; max-height: 86vh; border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .6);
}
.viewer-bar {
  position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 6px 12px;
  background: rgba(20, 20, 24, .8); border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 999px; backdrop-filter: blur(8px);
}
.viewer-bar .grow { flex: 1; }
.viewer-ctl {
  min-width: 30px; height: 30px; padding: 0 8px; border-radius: 50%; border: none;
  background: rgba(255, 255, 255, .12); color: #fff; font-size: 15px; line-height: 1;
  display: inline-grid; place-items: center; cursor: pointer;
}
.viewer-ctl:hover { background: rgba(255, 255, 255, .24); }
.viewer-zoom { color: rgba(255, 255, 255, .8); font-size: 12px; min-width: 42px; text-align: center; }
/* 视频伪全屏：铺满灯箱（不依赖 Fullscreen API） */
.viewer-mask.video-full video {
  position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none;
  border-radius: 0; z-index: 93; background: #000; object-fit: contain;
}
.viewer-mask.video-full .viewer-bar { z-index: 94; }
.sticker { max-width: 96px; max-height: 96px; display: block; object-fit: contain; }
.video-wrap { display: flex; flex-direction: column; gap: 3px; position: relative; width: 320px; max-width: 100%; min-width: 0; }
.video-wrap video { width: 100%; height: auto; max-height: 360px; }
.video-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
/* 视频放大悬浮按钮：右上角小圆钮，hover 视频时显现 */
.vfull {
  position: absolute; top: 6px; right: 6px; width: 26px; height: 26px;
  border-radius: 50%; border: none; background: rgba(0, 0, 0, .55); color: #fff;
  display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity .12s;
}
.video-wrap:hover .vfull { opacity: 1; }
.vfull:hover { background: var(--acc); }
.vtime { font-size: 11px; color: var(--fg2); }
/* 群卡片确认弹窗（居中紧凑） */
.card-ask {
  width: min(320px, 88vw); background: var(--card); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .5);
}
.card-ask b { font-size: 15px; }
.card-ask p { font-size: 13px; color: var(--fg2); margin: 0; word-break: break-all; }
.card-ask-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.ca-btn {
  padding: 7px 16px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--card2); color: var(--fg); font-size: 13px; cursor: pointer;
}
.ca-btn.primary { background: var(--acc); border-color: transparent; color: #fff; }
.ca-btn:hover { filter: brightness(1.1); }
.pre { font-size: 12px; white-space: pre-wrap; margin: 0; }
.file { display: flex; gap: 8px; align-items: center; text-decoration: none; color: inherit; }
.fico { font-size: 22px; }
.fmeta { display: flex; flex-direction: column; }
.fmeta small { color: var(--fg2); }
.post { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
.post small { color: var(--fg2); }
.form { display: flex; flex-direction: column; gap: 8px; min-width: 200px; }
.ffield { display: flex; flex-direction: column; gap: 3px; }
.flabel { font-size: 12px; color: var(--fg2); }
.a2ui { display: flex; flex-direction: column; gap: 8px; min-width: 200px; }
.a2ui-surface { display: flex; flex-direction: column; gap: 6px; }
.tip { opacity: .85; }
</style>

/* 文章弹窗 */
.post-mask {
  position: fixed; inset: 0; z-index: 93; background: rgba(0, 0, 0, .5);
  display: grid; place-items: center; backdrop-filter: blur(4px);
}
.post-box {
  width: min(680px, 92vw); max-height: 84vh; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .45); overflow: hidden;
}
.post-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 15px;
}
.post-x {
  width: 26px; height: 26px; border-radius: 7px; border: none; background: none;
  color: var(--fg2); font-size: 17px; line-height: 1; cursor: pointer;
}
.post-x:hover { background: var(--card2); color: var(--fg); }
.post-body { padding: 16px 18px; overflow: auto; font-size: 13.5px; line-height: 1.75; }
