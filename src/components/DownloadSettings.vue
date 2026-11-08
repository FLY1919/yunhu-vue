<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
const ui = inject<any>('ctx')?.ui
const directory = ref('')
const custom = ref(false)
const mode = ref<'ask' | 'direct'>('direct')
const input = ref('')
const busy = ref(false)
const failed = ref(false)

onMounted(async () => {
  try {
    const response = await fetch('/file-dir')
    if (!response.ok) throw new Error('无法读取下载目录')
    const data = await response.json()
    directory.value = data.dir
    custom.value = data.custom
    mode.value = data.mode === 'ask' ? 'ask' : 'direct'
  } catch { failed.value = true }
})
type DownloadSetting = { dir: string } | { reset: true } | { mode: string }
async function change(setting: DownloadSetting) {
  busy.value = true
  try {
    const response = await fetch('/file-dir', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(setting) })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.msg || '无法保存下载目录')
    directory.value = data.dir
    custom.value = data.custom
    mode.value = data.mode === 'ask' ? 'ask' : 'direct'
    if ('mode' in setting) ui?.toast('下载位置选项已保存', 'success')
    else {
      input.value = ''
      ui?.toast('下载目录已更新', 'success')
    }
  } catch (error: any) { ui?.toast(error.message, 'error') }
  finally { busy.value = false }
}
function setMode(event: Event) {
  const control = event.currentTarget as HTMLSelectElement
  const value = control.value
  control.value = mode.value
  void change({ mode: value })
}
async function browse() {
  busy.value = true
  try {
    const response = await fetch('/pick-dir')
    const data = await response.json()
    if (data.dir) input.value = data.dir
  } catch { ui?.toast('无法打开目录选择框，可手动输入路径', 'warn') }
  finally { busy.value = false }
}
</script>
<template>
  <div class="download-settings">
    <p v-if="failed" class="dim small">桌面下载目录暂不可用。</p>
    <template v-else>
      <label class="download-mode">
        <span>下载时的保存位置</span>
        <select :value="mode" :disabled="busy || !directory" @change="setMode">
          <option value="ask">每次询问保存位置</option>
          <option value="direct">直接保存到指定目录</option>
        </select>
      </label>
      <p>默认目录 <strong>{{ directory || '读取中…' }}</strong><span v-if="directory && !custom">（系统默认）</span></p>
      <form @submit.prevent="change({ dir: input.trim() })">
        <input v-model="input" aria-label="下载目录" placeholder="输入目录的绝对路径" :disabled="busy || !directory" />
        <button type="button" class="ghost small" :disabled="busy || !directory" @click="browse">浏览…</button>
        <button class="small" :disabled="busy || !input.trim()">保存</button>
        <button v-if="custom" type="button" class="ghost small" :disabled="busy" @click="change({ reset: true })">恢复默认</button>
      </form>
      <p class="dim small">{{ mode === 'ask' ? '每次下载时弹出系统文件夹选择窗口。' : '下载会直接保存到上述目录。' }}</p>
    </template>
  </div>
</template>
<style scoped>
.download-settings { display:grid; gap:8px; }
.download-settings p { margin:0; overflow-wrap:anywhere; }
.download-settings form { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.download-mode { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.download-settings :is(input, select) { flex:1 1 190px; min-width:0; padding:6px 9px; color:var(--fg); background:var(--card2); border:1px solid var(--line); border-radius:6px; }
</style>
