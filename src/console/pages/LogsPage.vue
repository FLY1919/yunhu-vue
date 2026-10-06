<script setup lang="ts">
/**
 * 日志页（由 logger 插件注册）
 *
 * ⚠️ 日志列表在 **ctx.logs** 里（logger 插件包了一层 cordis logger 得来的服务）；
 *    ctx.logger 是 cordis 自带的 Logger，它没有 state.logs ——
 *    之前这里写的是 ctx.logger，所以页面永远「暂无日志」。
 */
import { inject, computed, ref } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { fmtTime } from '../../core/util'

const ctx = inject<any>('ctx')
const logs = ctx.logs
const level = ref('all')
const keyword = ref('')

const all = computed(() => (logs?.state?.logs ? [...logs.state.logs].reverse() : []))

const list = computed(() => {
  let arr = all.value
  if (level.value !== 'all') arr = arr.filter((l: any) => l.level === level.value)
  const kw = keyword.value.trim()
  if (kw) arr = arr.filter((l: any) => String(l.text).includes(kw))
  return arr
})

const counts = computed(() => {
  const c: Record<string, number> = { all: all.value.length, info: 0, warn: 0, error: 0, debug: 0, success: 0 }
  for (const l of all.value) c[l.level] = (c[l.level] || 0) + 1
  return c
})

function clearAll() {
  try { logs?.clear?.() } catch { /* 忽略 */ }
}

function copyAll() {
  const text = list.value.map((l: any) => `[${l.level}] ${l.text}`).join('\n')
  navigator.clipboard?.writeText(text).then(
    () => ctx.ui?.toast('已复制当前列表', 'success'),
    () => window.prompt('复制：', text),
  )
}
</script>

<template>
  <KLayout ns="logs" title="日志" desc="记录插件生命周期与服务变化（来自 ctx.logs）">
    <template #actions>
      <button class="ghost small" :class="{ on: level === 'all' }" @click="level = 'all'">
        全部 <em>{{ counts.all }}</em>
      </button>
      <button class="ghost small" :class="{ on: level === 'info' }" @click="level = 'info'">
        信息 <em>{{ counts.info }}</em>
      </button>
      <button class="ghost small" :class="{ on: level === 'warn' }" @click="level = 'warn'">
        警告 <em>{{ counts.warn }}</em>
      </button>
      <button class="ghost small" :class="{ on: level === 'error' }" @click="level = 'error'">
        错误 <em>{{ counts.error }}</em>
      </button>
      <input v-model="keyword" placeholder="搜索…" style="max-width: 140px" />
      <button class="ghost small" @click="copyAll">复制</button>
      <button class="ghost small danger" @click="clearAll">清空</button>
    </template>

    <KCard :pad="false">
      <div class="logs">
        <div v-for="(l, i) in list" :key="i" :class="l.level">
          <span class="lvl">{{ l.level }}</span>
          <span class="ltime dim small">{{ fmtTime(l.t) }}</span>
          <span class="txt">{{ l.text }}</span>
        </div>
        <p v-if="!list.length" class="dim" style="padding: 14px">
          {{ all.length ? '没有匹配的日志' : '暂无日志（插件加载时会产生日志）' }}
        </p>
      </div>
    </KCard>

    <p class="dim small" style="margin-top: 10px">
      日志由 <code>ctx.logger.info(...)</code> 写入，同时也落到 <code>ctx.logs.state.logs</code>；
      插件里用 <code>ctx.logger('插件名')</code> 拿带作用域的 logger。
    </p>
  </KLayout>
</template>

<style scoped>
.logs { max-height: 62vh; overflow: auto; font-size: 12.5px; }
.logs > div { display: flex; gap: 8px; padding: 4px 12px; border-bottom: 1px dashed var(--line); align-items: baseline; }
.logs > div.error { color: var(--err); }
.logs > div.warn { color: var(--warn); }
.logs > div.success { color: var(--ok, #4ade80); }
.lvl { flex: 0 0 52px; opacity: .75; font-size: 11px; }
.ltime { flex: 0 0 64px; }
.txt { flex: 1; min-width: 0; word-break: break-all; white-space: pre-wrap; }
.ghost em { font-style: normal; opacity: .6; margin-left: 2px; }
</style>
