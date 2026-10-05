<script setup lang="ts">
/**
 * A2UI（content_type=14）组件递归渲染。
 *
 * 云湖的 A2UI 是 v0.9 扁平组件协议：{ id, component:"Button", ...props }，
 * 由 parseA2ui 还原成 surface（components: Map + root），这里按 root 递归展开。
 *
 * 支持的组件：Column/Row/Card/List/Text/Icon/Button/TextField/.../AudioPlayer/Video/Tabs
 * Button 点击 → emit('action') → 最终由 MessageItem 调 api.a2uiFormReport 回传给机器人。
 */
import { computed } from 'vue'
import Icon from '../console/components/Icon.vue'
import { resolveValue, getPath } from '../satori/a2ui'
import type { A2uiSurface, A2uiComponent } from '../satori/a2ui'
import { resUrl } from '../core/res'

defineOptions({ name: 'A2uiNode' })

const props = defineProps<{
  id: string
  surface: A2uiSurface
  itemData?: Record<string, any> | null
  depth?: number
}>()
const emit = defineEmits<{ (e: 'action', a: any): void }>()

const comp = computed<A2uiComponent | undefined>(() => props.surface?.components?.get(props.id))
const type = computed(() => comp.value?.component || 'Unknown')

const data = computed<Record<string, any>>(() =>
  props.itemData ? { ...(props.surface?.data || {}), ...props.itemData } : (props.surface?.data || {}))

/** 取值：支持字面量 / {path} / 直接字符串 */
function v(x: any): any { return resolveValue(x, data.value) }
const str = (x: any, fb = '') => {
  const r = v(x)
  return r === undefined || r === null ? fb : String(r)
}

/** children 支持：数组 | {componentId, path} 模板 | 单个 child 字段 */
const kids = computed<Array<{ id: string; item?: any }>>(() => {
  const c = comp.value
  if (!c) return []
  const ch = c.children
  if (Array.isArray(ch)) return ch.map(id => ({ id }))
  if (ch && typeof ch === 'object') {
    if (ch.componentId) {
      const arr: any[] = getPath(data.value, ch.path) || []
      return arr.map(item => ({ id: ch.componentId, item }))
    }
    if (Array.isArray(ch.explicitList)) return ch.explicitList.map((id: string) => ({ id }))
  }
  if (typeof c.child === 'string') return [{ id: c.child }]
  return []
})

const DIV = () => emit('action', {})
</script>

<template>
  <template v-if="(depth || 0) < 24 && comp">
    <!-- 布局 -->
    <div v-if="type === 'Column'" class="a2-col"
         :style="{ alignItems: comp.alignment === 'center' ? 'center' : (comp.alignment === 'end' ? 'flex-end' : 'stretch') }">
      <A2uiNode v-for="k in kids" :key="k.id + JSON.stringify(k.item || '')" :id="k.id"
                :surface="surface" :item-data="k.item" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
    </div>
    <div v-else-if="type === 'Row'" class="a2-row"
         :style="{ justifyContent: comp.distribution === 'spaceBetween' ? 'space-between' : (comp.alignment || 'flex-start') }">
      <A2uiNode v-for="k in kids" :key="k.id + JSON.stringify(k.item || '')" :id="k.id"
                :surface="surface" :item-data="k.item" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
    </div>
    <div v-else-if="type === 'List'" class="a2-list">
      <A2uiNode v-for="(k, i) in kids" :key="k.id + i" :id="k.id"
                :surface="surface" :item-data="k.item" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
    </div>
    <div v-else-if="type === 'Card'" class="a2-card">
      <A2uiNode v-for="k in kids" :key="k.id + JSON.stringify(k.item || '')" :id="k.id"
                :surface="surface" :item-data="k.item" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
    </div>
    <hr v-else-if="type === 'Divider'" class="a2-hr" />

    <!-- 文本 / 媒体 -->
    <component v-else-if="type === 'Text'"
               :is="['h1','h2','h3','h4','h5'].includes(comp.usageHint) ? comp.usageHint : 'p'"
               class="a2-text" :class="'a2-' + (comp.usageHint || 'body')">{{ str(comp.text) }}</component>
    <img v-else-if="type === 'Image'" class="a2-img" :src="resUrl(str(comp.url))" :alt="comp.alt || ''" loading="lazy" />
    <video v-else-if="type === 'Video'" class="a2-video" :src="resUrl(str(comp.url))" controls preload="metadata" />
    <div v-else-if="type === 'AudioPlayer'" class="a2-audio">
      <audio :src="resUrl(str(comp.url))" controls preload="metadata"></audio>
      <span v-if="comp.description" class="a2-audio-desc">{{ str(comp.description) }}</span>
    </div>
    <span v-else-if="type === 'Icon'" class="a2-icon">{{ str(comp.name) }}</span>

    <!-- 交互 -->
    <button v-else-if="type === 'Button'" class="a2-btn" :class="{ primary: comp.primary !== false }"
            @click="emit('action', { name: v(comp.action?.name), context: v(comp.action?.context), sourceComponentId: id })">
      <A2uiNode v-if="kids.length" :id="kids[0].id" :surface="surface" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
      <template v-else>{{ str(comp.label, '按钮') }}</template>
    </button>

    <label v-else-if="type === 'TextField'" class="a2-field">
      <span v-if="comp.label" class="a2-label">{{ str(comp.label) }}</span>
      <input :type="comp.textFieldType === 'number' ? 'number' : (comp.textFieldType || 'text')"
             :value="str(comp.text ?? comp.value)" :placeholder="str(comp.placeholder)" />
    </label>

    <label v-else-if="type === 'CheckBox'" class="a2-field a2-inline">
      <input type="checkbox" :checked="!!v(comp.value)" />
      <span>{{ str(comp.label) }}</span>
    </label>

    <label v-else-if="type === 'Slider'" class="a2-field">
      <span v-if="comp.label" class="a2-label">{{ str(comp.label) }}</span>
      <input type="range" :min="comp.minValue ?? 0" :max="comp.maxValue ?? 100" :value="v(comp.value) ?? 0" />
    </label>

    <div v-else-if="type === 'MultipleChoice'" class="a2-field">
      <span v-if="comp.label" class="a2-label">{{ str(comp.label) }}</span>
      <div class="a2-options">
        <label v-for="(o, i) in (comp.options || [])" :key="i" class="a2-inline">
          <input type="radio" :name="id" :value="o.value" />
          <span>{{ str(o.label) }}</span>
        </label>
      </div>
    </div>

    <label v-else-if="type === 'DateTimeInput'" class="a2-field">
      <span v-if="comp.label" class="a2-label">{{ str(comp.label) }}</span>
      <input type="datetime-local" />
    </label>

    <div v-else-if="type === 'Tabs'" class="a2-tabs">
      <div class="a2-tab-titles">
        <span v-for="(t, i) in (comp.tabs || [])" :key="i" class="a2-tab-title" :class="{ on: i === 0 }">{{ str(t.title) }}</span>
      </div>
      <A2uiNode v-if="comp.tabs?.[0]?.child" :id="comp.tabs[0].child" :surface="surface" :depth="(depth || 0) + 1" @action="e => emit('action', e)" />
    </div>

    <!-- 兜底：把组件名和属性显示出来，方便排错 -->
    <div v-else class="a2-unknown">
      <b>{{ type }}</b>
      <pre>{{ JSON.stringify({ ...comp, component: undefined }, null, 0).slice(0, 300) }}</pre>
    </div>
  </template>
</template>

<style scoped>
.a2-text { margin: 2px 0; }
.a2-h1 { font-size: 20px; } .a2-h2 { font-size: 18px; } .a2-h3 { font-size: 16px; }
.a2-h4, .a2-h5 { font-size: 15px; }
.a2-caption { font-size: 12px; opacity: .75; }
.a2-img, .a2-video { max-width: 100%; border-radius: 10px; display: block; }
.a2-video { max-height: 320px; }
.a2-audio { display: flex; flex-direction: column; gap: 4px; min-width: 220px; }
.a2-audio audio { width: 100%; }
.a2-audio-desc { font-size: 12px; color: var(--fg2); }
.a2-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.a2-col, .a2-list { display: flex; flex-direction: column; gap: 6px; }
.a2-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--bg2); }
.a2-hr { border: 0; border-top: 1px solid var(--line); margin: 8px 0; width: 100%; }
.a2-btn { background: var(--bg3); color: var(--fg); font-weight: 500; }
.a2-btn.primary { background: var(--acc); color: #fff; }
.a2-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.a2-inline { flex-direction: row; align-items: center; gap: 6px; display: flex; }
.a2-label { color: var(--fg2); font-size: 12px; }
.a2-options { display: flex; flex-direction: column; gap: 4px; }
.a2-icon { font-size: 18px; }
.a2-tabs { display: flex; flex-direction: column; gap: 6px; }
.a2-tab-titles { display: flex; gap: 10px; border-bottom: 1px solid var(--line); }
.a2-tab-title { font-size: 12.5px; color: var(--fg2); padding-bottom: 4px; }
.a2-tab-title.on { color: var(--acc); border-bottom: 2px solid var(--acc); }
.a2-unknown { font-size: 11.5px; color: var(--fg2); }
.a2-unknown pre { white-space: pre-wrap; word-break: break-all; margin: 2px 0 0; }
</style>
