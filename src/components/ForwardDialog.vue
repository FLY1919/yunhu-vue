<script setup lang="ts">
/**
 * 转发目标选择弹窗（message-actions 插件通过 console 的 global 插槽挂载）。
 * 会话列表带上类型标签（用户/群聊/机器人），多选后调 api.forward。
 */
import { inject, computed, ref } from 'vue'
import { fallbackAvatar, CHAT_TYPE_LABEL } from '../core/util'
import { resUrl } from '../core/res'

const ctx = inject<any>('ctx')
const ma = ctx.messageActions
const chat = ctx.chat

/** 页签：全部(会话) / 好友(通讯录用户) / 群聊 / 机器人 */
const fdTab = ref<'all' | 'friends' | 'groups' | 'bots'>('all')

const list = computed(() => {
  const k = (ma.state.keywords || '').trim().toLowerCase()
  const convs = chat.state.conversations as any[]
  const friends = ((ctx.social?.state?.book?.users || []) as any[])
    .filter((u: any) => !convs.some((c: any) => c.id === u.id && c.type === 1))
    .map((u: any) => ({ id: u.id, name: u.remark || u.name, avatar: u.avatar, type: 1 }))
  let arr: any[] = []
  if (fdTab.value === 'all') arr = [...convs, ...friends]
  else if (fdTab.value === 'friends') arr = [...convs.filter((c: any) => c.type === 1), ...friends]
  else if (fdTab.value === 'groups') arr = convs.filter((c: any) => c.type === 2)
  else arr = convs.filter((c: any) => c.type === 3)
  const hit = k ? arr.filter(c => (c.name || '').toLowerCase().includes(k) || c.id.includes(k)) : arr
  return hit.slice(0, 80)
})
</script>

<template>
  <div v-if="ma.state.forwardOpen" class="fd-mask" @click.self="ma.closeForward()">
    <div class="fd">
      <header>
        <b>转发 {{ ma.state.forwardIds.length }} 条消息</b>
        <button class="ghost small" @click="ma.closeForward()">关闭</button>
      </header>

      <input v-model="ma.state.keywords" placeholder="搜索会话…" />

      <!-- 页签：全部 / 好友 / 群聊 / 机器人（QQ 式转发目标筛选） -->
      <div class="fd-tabs">
        <button v-for="t in (['all', 'friends', 'groups', 'bots'] as const)" :key="t"
                class="fd-tab" :class="{ on: fdTab === t }" @click="fdTab = t">
          {{ { all: '全部', friends: '好友', groups: '群聊', bots: '机器人' }[t] }}
        </button>
      </div>

      <ul class="fd-list">
        <li v-for="c in list" :key="c.id" :class="{ on: ma.isTarget(c.id) }" @click="ma.toggleTarget(c)">
          <img :src="c.avatar ? resUrl(c.avatar) : fallbackAvatar(c.name)" alt=""
               @error="(e: any) => (e.target.src = fallbackAvatar(c.name))" />
          <span class="nm">{{ c.name }}</span>
          <span class="ty">{{ CHAT_TYPE_LABEL[c.type] }}</span>
          <span class="ck">{{ ma.isTarget(c.id) ? '✓' : '' }}</span>
        </li>
        <li v-if="!list.length" class="empty">没有匹配的会话</li>
      </ul>

      <footer>
        <span class="dim small">已选 {{ ma.state.targets.length }} 个目标</span>
        <button :disabled="!ma.state.targets.length" @click="ma.confirmForward()">确认转发</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fd-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center; z-index: 120;
}
.fd {
  width: 420px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  overflow: hidden;
}
.fd header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.fd > input { margin: 12px 16px 8px; }
.fd-tabs { display: flex; gap: 4px; padding: 0 16px 8px; }
.fd-tab {
  padding: 4px 12px 5px; border: none; background: none; color: var(--fg2);
  font-size: 12.5px; cursor: pointer; border-bottom: 2px solid transparent;
}
.fd-tab:hover { color: var(--fg); }
.fd-tab.on { color: var(--acc); border-bottom-color: var(--acc); font-weight: 600; }
.fd-list { list-style: none; margin: 0; padding: 0 8px; overflow: auto; flex: 1; }
.fd-list li {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 9px; cursor: pointer;
}
.fd-list li:hover { background: var(--card2); }
.fd-list li.on { background: var(--acc-soft); }
.fd-list img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; background: var(--card2); }
.fd-list .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-list .ty { font-size: 11px; color: var(--fg2); }
.fd-list .ck { width: 18px; text-align: center; color: var(--acc); font-weight: 700; }
.fd-list .empty { justify-content: center; color: var(--fg2); cursor: default; }
.fd footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-top: 1px solid var(--line);
}
</style>
