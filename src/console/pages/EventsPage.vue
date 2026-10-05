<script setup lang="ts">
/** 事件页：展示 Satori 风格统一事件流 */
import { inject, computed, ref } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { fmtTime } from '../../core/util'

const ctx = inject<any>('ctx')
const adapter = ctx.adapter
const ws = ctx.ws

const filter = ref('all')
// 优先用统一的 ctx.event 历史（新），没有就退回 adapter 自己的事件流（旧）
const list = computed(() => {
  const ev = ctx.event
  const all = ev?.history?.length
    ? ev.history.map((h: any) => ({ type: h.type, t: h.t, content: h.text,
        channel: h.payload?.channel?.id || h.payload?.channel || '',
        user: h.payload?.user?.name || '' }))
    : [...adapter.events]
  return filter.value === 'all' ? all : all.filter((e: any) => e.type === filter.value)
})
const pending = computed(() => Math.max(0, (ctx.chat?.state.conversations?.reduce?.((n: number, c: any) => n + (c.unread || 0), 0) || 0)))
</script>

<template>
  <KLayout title="事件" desc="适配器把云湖推送统一成 Satori 风格会话事件">
    <template #actions>
      <button class="ghost small" :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
      <button class="ghost small" :class="{ on: filter === 'message-created' }" @click="filter = 'message-created'">新消息</button>
      <button class="ghost small" :class="{ on: filter === 'message-updated' }" @click="filter = 'message-updated'">编辑</button>
      <button class="ghost small" :class="{ on: filter === 'message-recalled' }" @click="filter = 'message-recalled'">撤回</button>
      <span class="pill">共 {{ adapter.state.events }} 条</span>
    </template>

    <KCard title="统一事件流">
      <div class="evts">
        <div v-for="(e, i) in list" :key="i" class="evt">
          <span class="etype">{{ e.type }}</span>
          <span class="etime">{{ fmtTime(e.t) }}</span>
          <span class="echan">{{ e.channel }}</span>
          <span class="euser">{{ e.user }}</span>
          <span class="etext">{{ e.content }}</span>
        </div>
        <p v-if="!list.length" class="dim" style="padding: 6px 0">还没有事件。有人在群里说话就会出现。</p>
      </div>
    </KCard>

    <KCard title="插件如何消费" class="mt">
      <pre class="code">ctx.on('message-created', (session) => {
  if (session.channel.type !== 2) return           // 只看群聊
  if (session.content.includes('你好')) {
    session.send(h.text('你好呀 ') && [h.text('你好呀 '), h.at(session.user.id, session.user.name)])
  }
})</pre>
      <p class="dim small mt-sm">
        发消息统一用元素树：<code>bot.sendMessage(channel, [h.text('hi'), h.image(url)])</code>，
        适配器负责转成云湖的 protobuf 与 content_type。
      </p>
    </KCard>
  </KLayout>
</template>

<style scoped>
.evts { display: flex; flex-direction: column; max-height: 46vh; overflow: auto; }
.evt { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 12.5px; align-items: baseline; }
.evt:last-child { border-bottom: 0; }
.etype { flex: 0 0 130px; color: var(--acc); font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; }
.etime { flex: 0 0 74px; color: var(--fg2); font-size: 11px; }
.echan { flex: 0 0 150px; color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.euser { flex: 0 0 110px; color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.etext { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code {
  background: var(--card2); border: 1px solid var(--line); border-radius: 8px; padding: 12px;
  font: 12px/1.7 ui-monospace, Menlo, Consolas, monospace; overflow: auto; margin: 0;
}
</style>
