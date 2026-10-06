<script setup lang="ts">
/** 配置页：直接编辑 yunhu.config.yml */
import { inject, ref, computed, onMounted, watch } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import SchemaForm from '../components/SchemaForm.vue'

const ctx = inject<any>('ctx')
const cfg = ctx.cfg
const ui = ctx.ui
const app = ctx.app

const text = ref('')
const msg = ref('')
const busy = ref(false)
/** form = 按插件 Schema 自动生成表单（对标 Koishi 控制台）；yaml = 直接编辑文本 */
const mode = ref<'form' | 'yaml'>('form')

/** 声明了 Config Schema 的插件 */
const schemas = computed(() => (app?.schemas?.() || []) as Array<{ key: string; schema: any }>)
/** 表单草稿：key -> 配置对象 */
const draft = ref<Record<string, any>>({})

function syncDraft() {
  const next: Record<string, any> = {}
  for (const { key } of schemas.value) {
    next[key] = JSON.parse(JSON.stringify(cfg.state?.data?.plugins?.[key] ?? {}))
  }
  draft.value = next
}

onMounted(async () => {
  try { await cfg.load() } catch { /* 忽略 */ }
  text.value = cfg.toYaml()
  syncDraft()
})
watch(() => [cfg.state?.data, cfg.state?.dirty], () => {
  if (!cfg.state?.dirty) {
    text.value = cfg.toYaml()
    syncDraft()
  }
}, { deep: true })

/** 保存表单：把草稿按 key 写回 plugins，再落盘 */
async function saveForm() {
  busy.value = true
  msg.value = ''
  try {
    const data = JSON.parse(JSON.stringify(cfg.state?.data || {}))
    data.plugins = data.plugins || {}
    for (const k of Object.keys(draft.value)) data.plugins[k] = draft.value[k]
    cfg.state.data = data
    await cfg.save?.()
    msg.value = '已保存'
    ui?.toast?.('配置已保存', 'success')
  } catch (e: any) {
    msg.value = '保存失败：' + (e?.message || e)
  } finally { busy.value = false }
}

// 打开时从服务器重新读一次，之后跟随 cfg.state 实时刷新（有未保存改动时不覆盖）
onMounted(async () => {
  try { await cfg.load() } catch { /* 忽略 */ }
  text.value = cfg.toYaml()
})
watch(() => [cfg.state.data, cfg.state.dirty], () => {
  if (!cfg.state.dirty) text.value = cfg.toYaml()
}, { deep: true })

async function reload() {
  msg.value = ''
  await cfg.load()
  text.value = cfg.toYaml()
  ui.toast('已从 yunhu.config.yml 重新读取', 'success')
}

function apply() {
  msg.value = ''
  try {
    cfg.parse(text.value)
    msg.value = '已解析（尚未保存）'
  } catch (e: any) { msg.value = '解析失败：' + e.message }
}

async function save() {
  busy.value = true
  try { apply(); await cfg.save(); text.value = cfg.toYaml(); ui.toast('已保存到 yunhu.config.yml', 'success') }
  catch (e: any) { msg.value = '保存失败：' + e.message }
  finally { busy.value = false }
}

function saveAndReload() {
  busy.value = true
  try {
    apply()
    cfg.applyToApp()
    text.value = cfg.toYaml()
    ui.toast('配置已应用，插件已重载', 'success')
  } catch (e: any) { msg.value = '应用失败：' + e.message }
  finally { busy.value = false }
}
</script>

<template>
  <KLayout title="配置" desc="对应项目根目录的 yunhu.config.yml（对标 koishi.yml）">
    <template #actions>
      <button class="ghost small" :class="{ on: mode === 'form' }" @click="mode = 'form'">表单</button>
      <button class="ghost small" :class="{ on: mode === 'yaml' }" @click="mode = 'yaml'">YAML</button>
      <span class="pill">{{ cfg.state.source }}</span>
      <span class="pill" :class="{ warn: cfg.state.dirty }">{{ cfg.state.dirty ? '未应用' : '已应用' }}</span>
      <button class="ghost small" :disabled="busy" @click="reload">重新读取</button>
      <button class="ghost small" :disabled="busy" @click="apply">解析</button>
      <button class="ghost small" :disabled="busy" @click="mode === 'form' ? saveForm() : save()">保存</button>
      <button class="small" :disabled="busy" @click="saveAndReload">应用并重载插件</button>
    </template>

    <!-- 表单模式：按各插件的 Config Schema 自动生成（对标 Koishi 控制台设置页） -->
    <template v-if="mode === 'form'">
      <KCard v-for="it in schemas" :key="it.key" :title="it.key" class="mt">
        <SchemaForm :schema="it.schema" :model-value="draft[it.key] || {}" @update:model-value="v => draft[it.key] = v" />
      </KCard>
      <p v-if="!schemas.length" class="dim small">
        还没有插件声明 Config Schema。插件里导出 <code>export const Config = Schema.object({...})</code>
        后这里会自动出现表单。
      </p>
    </template>

    <!-- YAML 模式：直接编辑 -->
    <KCard v-else :pad="false">
      <textarea v-model="text" class="yaml" spellcheck="false"></textarea>
    </KCard>

    <p class="dim small mt" v-if="msg">{{ msg }}</p>
    <p class="dim small mt">
      保存会写回服务器上的 <code>yunhu.config.yml</code>；「应用并重载插件」会把
      <code>plugins.&lt;插件名&gt;</code> 作为配置传给对应插件并重新装载，
      所以能立刻看到行为变化（比如改 <code>chat.pollMs</code>、改快捷回复列表）。
    </p>
  </KLayout>
</template>

<style scoped>
.mt { margin-top: 12px; }
.ghost.on, .small.on { background: var(--acc); color: #fff; border-color: transparent; }
.yaml {
  width: 100%; min-height: 52vh; border: 0; border-radius: 0; background: var(--card);
  font: 12.5px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 16px; resize: vertical; color: var(--fg);
}
.yaml:focus { box-shadow: none; }
</style>
