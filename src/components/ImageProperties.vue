<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../console/components/Icon.vue'
import { imagePropertyRows, propertyValue, readImageProperties, type ImageProperties } from '../core/image-properties'
const props = defineProps<{ file?: File; url?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const ctx = inject<any>('ctx')
const source = ref<File>(), info = ref<ImageProperties>(), expanded = ref(new Set<string>())
const loading = ref(true), error = ref(''), search = ref('')
const dialog = ref<HTMLElement>(), trigger = document.activeElement as HTMLElement
let request: AbortController, generation = 0, disposed = false
const sizeLabel = (size: number) => `${size.toLocaleString()} 字节（${(size / 1024).toFixed(1)} KB）`
const allRows = computed(() => imagePropertyRows(info.value?.metadata || {}))
const rows = computed(() => allRows.value.filter(row => `${row.group} ${row.key} ${row.label} ${row.value}`.toLowerCase().includes(search.value.toLowerCase())))
function isBinary(value: any) { return ArrayBuffer.isView(value) && value.byteLength > 256 }
function expandRow(id: string, open: boolean) { if (open) expanded.value.add(id); else expanded.value.delete(id) }
async function load() {
  const seq = ++generation; request?.abort(); request = new AbortController()
  loading.value = true; error.value = ''; expanded.value.clear(); info.value = undefined; source.value = undefined
  try {
    let file = props.file
    if (!file) {
      const response = await fetch(props.url!, { signal: request.signal })
      if (!response.ok) throw new Error('读取图片失败 HTTP ' + response.status)
      const blob = await response.blob()
      let name = /^(data|blob):/.test(props.url!) ? 'image' : props.url!.split('?')[0].split('/').pop() || 'image'
      try { name = decodeURIComponent(name) } catch {}
      file = new File([blob], name, { type: blob.type })
    }
    const result = await readImageProperties(file)
    if (!disposed && seq === generation) { source.value = file; info.value = result }
  } catch (e: any) { if (!disposed && seq === generation && e.name !== 'AbortError') error.value = e.message || '读取失败' }
  finally { if (!disposed && seq === generation) loading.value = false }
}
watch(() => [props.file, props.url], load, { immediate: true })
function keydown(e: KeyboardEvent) {
  if (ctx?.lock?.isLocked) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); emit('close') }
  if (e.key !== 'Tab') return
  const items = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || [])
  const first = items[0], last = items.at(-1)
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
}
onMounted(async () => { window.addEventListener('keydown', keydown, true); await nextTick(); dialog.value?.focus() })
onBeforeUnmount(() => { disposed = true; request?.abort(); window.removeEventListener('keydown', keydown, true); trigger?.focus() })
</script>
<template>
  <Teleport to="body">
    <Transition name="properties" appear>
      <div class="properties-mask" @click.self="emit('close')" @wheel.stop @mousedown.stop>
        <section ref="dialog" class="properties-dialog" role="dialog" aria-modal="true" aria-label="图片属性" tabindex="-1">
          <header><span class="properties-icon"><Icon name="info" :size="22" /></span><div><h2>图片属性</h2><p>基本信息与 EXIF</p></div><button class="properties-close" aria-label="关闭属性" @click="emit('close')"><Icon name="close" :size="20" /></button></header>
          <div class="properties-body">
            <p v-if="loading" role="status">正在读取图片属性…</p>
            <template v-else-if="info && source">
              <dl class="properties-basic">
                <dt>文件名</dt><dd>{{ source.name }}</dd><dt>格式</dt><dd>{{ info.format }} · {{ info.mime }}</dd>
                <dt>尺寸</dt><dd>{{ info.width && info.height ? `${info.width} × ${info.height} 像素` : '当前环境无法解码尺寸' }}</dd>
                <dt>大小</dt><dd>{{ sizeLabel(info.size) }}</dd><dt v-if="props.file?.lastModified">本地文件修改时间</dt><dd v-if="props.file?.lastModified">{{ new Date(props.file.lastModified).toLocaleString() }}</dd>
              </dl>
              <div class="properties-exif-head"><h3>EXIF / 元数据 <span>{{ allRows.length }} 个字段</span></h3><input v-if="allRows.length" v-model="search" aria-label="搜索 EXIF" placeholder="搜索属性…" /></div>
              <p v-if="!Object.keys(info.exif).length" class="properties-note">EXIF：无</p>
              <dl v-if="rows.length" class="properties-tags"><template v-for="row in rows" :key="row.group + '.' + row.key"><dt :title="row.group + '.' + row.key">{{ row.label }}<small>{{ row.group }} · {{ row.key }}</small></dt><dd><details v-if="row.value.length > 220 || isBinary(row.raw)" @toggle="expandRow(row.group + '.' + row.key, ($event.target as HTMLDetailsElement).open)"><summary>{{ row.value.slice(0, 160) }}{{ row.value.length > 160 ? '…' : '' }}</summary><pre v-if="expanded.has(row.group + '.' + row.key)">{{ propertyValue(row.raw, true) }}</pre></details><template v-else>{{ row.value }}</template></dd></template></dl>
              <p v-if="allRows.length && !rows.length" class="properties-note">没有匹配的字段。</p>
              <p class="properties-note">设备型号、软件、GPS 与拍摄信息优先显示。厂商私有数据以原始内容提供；清除 EXIF 请使用图片编辑器。</p>
            </template>
            <p v-if="error" class="properties-error" role="alert">{{ error }}</p>
          </div>
          <footer>
            <button v-if="!info && !loading" @click="load">重试</button>
            <button @click="emit('close')">关闭</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
.properties-mask{position:fixed;inset:0;z-index:16000;display:grid;place-items:center;padding:16px;background:#0008;color:var(--fg);box-sizing:border-box}
.properties-dialog{display:flex;flex-direction:column;width:min(560px,100%);max-height:85dvh;border:1px solid var(--line);border-radius:20px;background:var(--card,var(--bg));box-shadow:0 24px 80px #0006;outline:none;overflow:hidden}
header{display:flex;align-items:center;gap:12px;padding:20px 22px;border-bottom:1px solid var(--line)}h2{font-size:18px;margin:0}header p{margin:3px 0 0;color:var(--fg2);font-size:12px}.properties-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;color:var(--acc);background:var(--acc-soft)}
button{font:inherit;cursor:pointer;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 13px;transition:background .16s,transform .16s}button:hover:enabled{background:var(--acc-soft)}button:active:enabled{transform:scale(.97)}button:disabled{opacity:.45;cursor:default}.properties-close{margin-left:auto;padding:7px;display:grid;place-items:center;border:0;background:transparent}.properties-body{overflow:auto;padding:18px 22px;overscroll-behavior:contain}.properties-basic,.properties-tags{display:grid;grid-template-columns:minmax(100px,35%) minmax(0,1fr);gap:12px;margin:0;font-size:13px}dt{color:var(--fg2)}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap;user-select:text}small{display:block;font-size:10px;opacity:.8;overflow-wrap:anywhere}.properties-exif-head{display:flex;gap:12px;align-items:center;margin:22px 0 14px}h3{font-size:14px;margin:0;white-space:nowrap}h3 span{font-size:11px;font-weight:400;color:var(--fg2);margin-left:6px}input{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg);color:var(--fg);font:inherit;font-size:12px}.properties-tags{font-size:12px}summary{cursor:pointer;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.7 monospace;max-height:280px;overflow:auto}.properties-note{font-size:12px;line-height:1.7;color:var(--fg2);margin:16px 0 0}.properties-error{color:var(--danger,#d74747);font-size:13px;line-height:1.6}.properties-status{color:var(--acc);font-size:13px;line-height:1.6}footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:16px 22px;border-top:1px solid var(--line)}.properties-primary{background:var(--acc);color:var(--on-acc);border-color:transparent}.properties-primary:hover:enabled{background:var(--acc);filter:brightness(1.08)}.properties-enter-active,.properties-leave-active{transition:opacity .18s}.properties-enter-active .properties-dialog,.properties-leave-active .properties-dialog{transition:transform .2s}.properties-enter-from,.properties-leave-to{opacity:0}.properties-enter-from .properties-dialog,.properties-leave-to .properties-dialog{transform:translateY(10px) scale(.98)}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}@media(max-width:420px){header,.properties-body,footer{padding:14px}.properties-basic,.properties-tags{grid-template-columns:100px minmax(0,1fr)}}
</style>
