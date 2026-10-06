<script setup lang="ts">
/**
 * SchemaForm —— 按 schemastery 的 Schema **自动生成表单**（对标 Koishi 控制台设置页）
 *
 * schemastery 的真实结构（已实测）：
 *   Schema = { type: 'object'|'string'|'number'|'boolean'|'array'|..., meta: {...}, dict: {...} }
 *   · object 的子字段在 .dict；array 的元素 schema 是 .inner（或 .list）
 *   · meta 里有 default / description / role / required
 *
 * 支持：string/number/boolean/array/object；role 影响控件（slider/textarea/radio 等）
 */
import { computed } from 'vue'

const props = defineProps<{ schema: any; modelValue: any }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>()

const s = computed(() => props.schema || {})
const type = computed(() => s.value.type)
const meta = computed(() => s.value.meta || {})
/** object 的子字段 */
const dict = computed(() => s.value.dict || null)
/** array 的元素 schema */
const inner = computed(() => s.value.inner || s.value.list || null)
const isArray = computed(() => type.value === 'array' || !!s.value.list)
const desc = computed(() => meta.value.description || '')
const role = computed(() => meta.value.role || '')

const val = computed({
  get: () => props.modelValue,
  set: (v: any) => emit('update:modelValue', v),
})

function child(k: string) { return dict.value ? dict.value[k] : undefined }
function keys(): string[] { return dict.value ? Object.keys(dict.value) : [] }

function setKey(k: string, v: any) { val.value = { ...(val.value || {}), [k]: v } }

function addItem() {
  const arr = Array.isArray(val.value) ? [...val.value] : []
  const t = inner.value?.type
  arr.push(t === 'number' ? 0 : t === 'boolean' ? false : '')
  val.value = arr
}
function removeItem(i: number) {
  const arr = [...(val.value || [])]
  arr.splice(i, 1)
  val.value = arr
}
function defaultOf(sch: any) {
  const m = sch?.meta || {}
  if (m.default !== undefined) return typeof m.default === 'object' ? JSON.parse(JSON.stringify(m.default)) : m.default
  const t = sch?.type
  if (t === 'number') return 0
  if (t === 'boolean') return false
  if (t === 'array') return []
  if (t === 'object') return {}
  return ''
}
/** 对象模式下若值是空，用 schema 默认值填充一次（让表单有内容可编辑） */
function ensureDefaults() {
  if (!dict.value) return
  const base = { ...(val.value || {}) }
  let changed = false
  for (const k of keys()) {
    if (base[k] === undefined) { base[k] = defaultOf(child(k)); changed = true }
  }
  if (changed) val.value = base
}
</script>

<template>
  <div class="sf">
    <!-- object -->
    <template v-if="dict">
      <div v-for="k in keys()" :key="k" class="sf-row">
        <label class="sf-key">
          {{ k }}
          <span v-if="child(k)?.meta?.description" class="sf-desc">{{ child(k).meta.description }}</span>
        </label>
        <SchemaForm v-if="child(k) && (child(k).dict || child(k).type === 'array' || child(k).inner || child(k).list)"
                    :schema="child(k)" :model-value="(val || {})[k]" @update:model-value="v => setKey(k, v)" />
        <template v-else-if="child(k)?.type === 'boolean'">
          <label class="sf-bool">
            <input type="checkbox" :checked="!!(val || {})[k]" @change="setKey(k, ($event.target as HTMLInputElement).checked)" />
            <span>{{ (val || {})[k] ? '是' : '否' }}</span>
          </label>
        </template>
        <template v-else-if="child(k)?.type === 'number'">
          <input type="number" :value="(val || {})[k] ?? 0" @input="setKey(k, Number(($event.target as HTMLInputElement).value))" />
        </template>
        <template v-else>
          <input :value="(val || {})[k] ?? ''" @input="setKey(k, ($event.target as HTMLInputElement).value)" />
        </template>
      </div>
      <button v-if="!Object.keys(val || {}).length" class="sf-add" @click="ensureDefaults">填入默认值</button>
    </template>

    <!-- array -->
    <template v-else-if="isArray">
      <div class="sf-list">
        <div v-for="(it, i) in (val || [])" :key="i" class="sf-item">
          <template v-if="inner && (inner.dict || inner.type === 'array' || inner.inner || inner.list)">
            <SchemaForm :schema="inner" :model-value="it" @update:model-value="v => { const a = [...(val || [])]; a[i] = v; val = a }" />
          </template>
          <template v-else-if="inner?.type === 'boolean'">
            <label class="sf-bool">
              <input type="checkbox" :checked="!!it" @change="{ const a = [...(val || [])]; a[i] = ($event.target as HTMLInputElement).checked; val = a }" />
            </label>
          </template>
          <template v-else-if="inner?.type === 'number'">
            <input type="number" :value="it ?? 0" @input="{ const a = [...(val || [])]; a[i] = Number(($event.target as HTMLInputElement).value); val = a }" />
          </template>
          <template v-else>
            <input :value="it ?? ''" @input="{ const a = [...(val || [])]; a[i] = ($event.target as HTMLInputElement).value; val = a }" />
          </template>
          <button class="sf-x" @click="removeItem(i)">×</button>
        </div>
        <button class="sf-add" @click="addItem">+ 添加一项</button>
      </div>
    </template>

    <!-- 基础类型（作为独立控件时） -->
    <template v-else-if="type === 'boolean'">
      <label class="sf-bool">
        <input type="checkbox" :checked="!!val" @change="val = ($event.target as HTMLInputElement).checked" />
        <span>{{ desc || '启用' }}</span>
      </label>
    </template>
    <template v-else-if="type === 'number'">
      <input v-if="role === 'slider'" type="range" :value="val ?? 0" @input="val = Number(($event.target as HTMLInputElement).value)" />
      <input v-else type="number" :value="val ?? 0" @input="val = Number(($event.target as HTMLInputElement).value)" />
    </template>
    <template v-else-if="role === 'textarea'">
      <textarea :value="val ?? ''" @input="val = ($event.target as HTMLTextAreaElement).value" />
    </template>
    <template v-else>
      <input :value="val ?? ''" @input="val = ($event.target as HTMLInputElement).value" />
    </template>

    <div v-if="desc && !dict" class="sf-tip">{{ desc }}</div>
  </div>
</template>

<style scoped>
.sf { display: flex; flex-direction: column; gap: 8px; }
.sf-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.sf-key { font-size: 12.5px; font-weight: 600; }
.sf-desc { font-weight: 400; color: var(--fg2); font-size: 11.5px; margin-left: 6px; }
.sf-tip { font-size: 11.5px; color: var(--fg2); }
.sf-list { display: flex; flex-direction: column; gap: 6px; }
.sf-item { display: flex; gap: 6px; align-items: center; }
.sf-item > *:first-child { flex: 1; }
.sf-x { background: transparent; color: var(--fg2); padding: 2px 6px; }
.sf-x:hover { color: var(--err); }
.sf-add { align-self: flex-start; font-size: 12px; }
.sf-bool { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; }
input[type="range"] { width: 100%; }
</style>
