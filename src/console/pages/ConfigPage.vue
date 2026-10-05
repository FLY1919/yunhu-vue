<script setup lang="ts">
/** 配置页：直接编辑 yunhu.config.yml */
import { inject, ref, onMounted, watch } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'

const ctx = inject<any>('ctx')
const cfg = ctx.cfg
const ui = ctx.ui

const text = ref('')
const msg = ref('')
const busy = ref(false)

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
      <span class="pill">{{ cfg.state.source }}</span>
      <span class="pill" :class="{ warn: cfg.state.dirty }">{{ cfg.state.dirty ? '未应用' : '已应用' }}</span>
      <button class="ghost small" :disabled="busy" @click="reload">重新读取</button>
      <button class="ghost small" :disabled="busy" @click="apply">解析</button>
      <button class="ghost small" :disabled="busy" @click="save">保存</button>
      <button class="small" :disabled="busy" @click="saveAndReload">应用并重载插件</button>
    </template>

    <KCard :pad="false">
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
.yaml {
  width: 100%; min-height: 52vh; border: 0; border-radius: 0; background: var(--card);
  font: 12.5px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 16px; resize: vertical; color: var(--fg);
}
.yaml:focus { box-shadow: none; }
</style>
