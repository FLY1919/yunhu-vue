<script setup lang="ts">
/**
 * 消息编辑历史
 * 接口：POST /v1/msg/list-message-edit-record  { msgId, size, page }
 * 返回的 contentOld 是转义后的 JSON（{"text":"..."}），这里解开后按时间倒序显示。
 */
import { inject, ref, watch } from 'vue'
import { fmtTime } from '../core/util'

const ctx = inject<any>('ctx')
const api = ctx.api
const ma = ctx.messageActions

const list = ref<any[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  const m = ma.state.historyFor
  if (!m) { list.value = []; return }
  loading.value = true
  error.value = ''
  try {
    list.value = await api.editRecords(m.id, { size: 30, page: 1 })
  } catch (e: any) {
    error.value = e.message
    list.value = []
  } finally { loading.value = false }
}

watch(() => ma.state.historyFor, load)
</script>

<template>
  <div v-if="ma.state.historyFor" class="eh-mask" @click.self="ma.closeHistory()">
    <div class="eh">
      <header>
        <b>编辑历史</b>
        <span class="dim small">共 {{ list.length }} 条</span>
        <span class="grow"></span>
        <button class="ghost small" @click="load">刷新</button>
        <button class="eh-x" @click="ma.closeHistory()">×</button>
      </header>

      <div class="eh-body">
        <!-- 当前版本 -->
        <div class="eh-cur">
          <div class="eh-meta">当前版本 · {{ fmtTime(ma.state.historyFor.ts) }}</div>
          <div class="eh-text">{{ ma.state.historyFor.content?.text || '（非文本）' }}</div>
        </div>

        <div v-if="loading" class="dim center">加载中…</div>
        <div v-else-if="error" class="err center">{{ error }}</div>
        <template v-else>
          <div v-for="(r, i) in list" :key="r.id ?? i" class="eh-item">
            <div class="eh-meta">
              第 {{ list.length - i }} 次修改前 · {{ fmtTime(r.msgTime || r.createTime) }}
              <span class="dim">（类型 {{ r.contentType }}）</span>
            </div>
            <div class="eh-text">{{ r.text || '（非文本）' }}</div>
          </div>
          <div v-if="!list.length" class="dim center">没有历史编辑记录</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eh-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 125; display: flex; align-items: center; justify-content: center; }
.eh { width: 520px; max-width: 94vw; max-height: 80vh; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
.eh > header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.eh > header .grow { flex: 1; }
.eh-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.eh-x:hover { color: var(--err); background: transparent; }
.eh-body { overflow: auto; padding: 12px 14px; }
.eh-cur { background: var(--acc-soft); border-radius: 9px; padding: 10px; margin-bottom: 12px; }
.eh-item { border-bottom: 1px dashed var(--line); padding: 9px 0; }
.eh-meta { font-size: 11.5px; color: var(--fg2); margin-bottom: 3px; }
.eh-text { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.center { text-align: center; padding: 14px 0; }
</style>
