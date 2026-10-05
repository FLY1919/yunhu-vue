<script setup lang="ts">
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
import { ref, computed, watch, onMounted, nextTick, inject } from 'vue'
import { resUrl } from '../core/res'
import { renderMarkdown, sanitizeHtml, postProcess, linkify } from '../core/render'
import { analyzeA2ui } from '../satori/a2ui'
import type { Element } from '../satori/element'
import A2uiNode from './A2uiNode.vue'

const props = defineProps<{
  elements: Element[]
  /** 引用块：{ sender, preview } */
  quote?: { sender: string; preview: string } | null
  /** 原始消息（自定义渲染器要用到） */
  msg?: any
}>()
const emit = defineEmits<{ (e: 'a2ui-action', a: any): void; (e: 'quote-jump', id: string): void }>()

const ctx = inject<any>('ctx')
const body = ref<HTMLElement | null>(null)

/**
 * 自定义气泡渲染器（消息气泡插件化的落点）
 * 插件用 ctx.chat.renderer({ id, match, render }) 注册，谁先认领就用谁的组件；
 * 没人认领才走下面内置的这套元素渲染。
 */
const custom = computed(() => {
  try { return ctx?.chat?.rendererFor?.({ msg: props.msg, elements: props.elements, quote: props.quote }) || null }
  catch { return null }
})

const list = computed(() => props.elements || [])

/**
 * A2UI 完整版：HTML 里内嵌的按钮（data-a2ui-action）也要能点。
 * 用事件委托一次性覆盖整个元素容器，不需要给每个按钮单独绑。
 */
function onHtmlClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
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
const mdHtml = (el: Element) => renderMarkdown(el.attrs.content)
const htmlHtml = (el: Element) => sanitizeHtml(el.attrs.content)

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
  return { aspectRatio: `${w} / ${h}` }
}

/** 点击图片看原图 */
function openRaw(src: string) {
  const u = resUrl(src)
  if (u) window.open(u, '_blank', 'noopener')
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
      <!-- 图片：带上宽高能提前占位，避免加载时跳动；点击可看原图 -->
      <img v-else-if="el.type === 'img'" class="media" :src="resUrl(el.attrs.src)" loading="lazy"
           :style="ratioOf(el)" alt="[图片]" @click="openRaw(el.attrs.src)"
           @error="(e: any) => (e.target.style.display = 'none')" />
      <img v-else-if="el.type === 'sticker'" class="sticker" :src="resUrl(el.attrs.src)" loading="lazy" alt="[表情]" />
      <div v-else-if="el.type === 'video'" class="video-wrap">
        <video class="media" :src="resUrl(el.attrs.src)" controls preload="metadata"></video>
        <span v-if="el.attrs.time" class="vtime">{{ el.attrs.time }}s</span>
      </div>
      <audio v-else-if="el.type === 'audio'" :src="resUrl(el.attrs.src)" controls preload="metadata" />

      <!-- 文件 -->
      <a v-else-if="el.type === 'file'" class="file" :href="resUrl(el.attrs.src)" target="_blank" rel="noreferrer"
         :download="el.attrs.name || undefined">
        <span class="fico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/></svg></span>
        <span class="fmeta">
          <b>{{ el.attrs.name || '文件' }}</b>
          <small v-if="el.attrs.size">{{ (el.attrs.size / 1024).toFixed(1) }} KB</small>
        </span>
      </a>

      <!-- 云湖扩展 -->
      <span v-else-if="el.type === 'tip'" class="tip">{{ el.attrs.content }}</span>
      <span v-else-if="el.type === 'call'" class="tip">📞 {{ el.attrs.content || '语音通话' }}</span>
      <a v-else-if="el.type === 'post'" class="post" href="#" @click.prevent>
        <b>{{ el.attrs.title || '文章' }}</b>
        <small v-if="el.attrs.content">{{ String(el.attrs.content).slice(0, 80) }}</small>
      </a>

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
</template>

<style scoped>
.els { display: block; }
.els > * { vertical-align: bottom; }

.quote {
  display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px;
  padding: 4px 8px; border-radius: 6px; font-size: 12px;
  background: rgba(127, 127, 127, .16); max-width: 100%;
}
.q-bar { width: 3px; align-self: stretch; border-radius: 2px; background: var(--acc); flex: 0 0 3px; }
.q-name { color: var(--acc); flex: 0 0 auto; }
.q-text { color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quote.clickable { cursor: pointer; }
.quote.clickable:hover { background: var(--acc-soft); }

.at { color: var(--acc); background: var(--acc-soft); border-radius: 5px; padding: 0 4px; }
.rich :deep(p) { margin: 4px 0; }
.rich :deep(a) { color: var(--acc); }
.rich :deep(code) { background: rgba(127, 127, 127, .18); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.rich :deep(pre) { background: rgba(0, 0, 0, .25); padding: 8px; border-radius: 8px; overflow-x: auto; }
.rich :deep(img) { max-width: 100%; border-radius: 8px; }
.rich :deep(blockquote) { margin: 4px 0; padding-left: 8px; border-left: 3px solid var(--line); opacity: .85; }
.media { max-width: min(320px, 100%); max-height: 460px; border-radius: 10px; display: block; object-fit: contain; cursor: zoom-in; background: var(--card2); }
.sticker { max-width: 140px; max-height: 140px; display: block; object-fit: contain; }
.video-wrap { display: inline-flex; flex-direction: column; gap: 3px; }
.vtime { font-size: 11px; color: var(--fg2); }
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
