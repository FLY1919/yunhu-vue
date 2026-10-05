<script setup lang="ts">
/**
 * 机器人指令面板（输入框打 / 或在标题栏点「指令」唤起）。
 *
 * 数据：/v1/group/instruction-list（群聊，返回自带 botId/botName，所以能按机器人分组）
 *       /v1/instruction/web-list（私聊/机器人）
 * 交互：按机器人归类成「指令机器人」分组 · 支持搜索 · 右上角 X 关闭
 * 选中一条交给 commands.use() 处理：普通指令往输入框塞「/指令名 」，直发指令直接发。
 */
import { inject, computed } from 'vue'

const ctx = inject<any>('ctx')
const cm = ctx.commands
const s = cm.state

/** 按机器人分组 */
const groups = computed(() => {
  const map = new Map<string, { botId: string; botName: string; list: any[] }>()
  for (const it of s.list) {
    const k = it.botId || 'unknown'
    if (!map.has(k)) map.set(k, { botId: k, botName: it.botName || k, list: [] })
    map.get(k)!.list.push(it)
  }
  const kw = s.keyword.trim().toLowerCase()
  let arr = [...map.values()]
  if (kw) arr = arr.map((g) => ({ ...g, list: g.list.filter((i: any) => (i.name + i.desc).toLowerCase().includes(kw)) })).filter((g) => g.list.length)
  return arr
})

const total = computed(() => groups.value.reduce((n, g) => n + g.list.length, 0))

function authLabel(a: number) {
  return a === 1 ? '已禁用' : a === 2 ? '仅群主' : a === 3 ? '群管可用' : ''
}
</script>

<template>
  <div v-if="s.panelOpen" class="cmd-mask" @click.self="cm.close()">
    <div class="cmd">
      <header>
        <b>指令</b>
        <span class="dim small">{{ total }} 条 · {{ groups.length }} 个机器人</span>
        <span class="grow"></span>
        <input v-model="s.keyword" placeholder="搜索指令…" style="max-width: 150px" />
        <button class="ghost small" @click="cm.load()">刷新</button>
        <!-- X 关闭按钮 -->
        <button class="cmd-x" title="关闭" @click="cm.close()">×</button>
      </header>

      <div class="cmd-body">
        <div v-for="g in groups" :key="g.botId" class="grp">
          <div class="grp-head">
            <span class="bot">{{ g.botName }}</span>
            <span class="dim small">{{ g.list.length }} 条</span>
          </div>
          <div class="items">
            <button v-for="it in g.list" :key="it.id" class="item" @click="cm.use(it)">
              <span class="nm">{{ it.name }}</span>
              <span class="ds dim small">{{ it.desc }}</span>
              <em v-if="authLabel(it.auth)" class="bad">{{ authLabel(it.auth) }}</em>
            </button>
          </div>
        </div>
        <p v-if="!total" class="dim center">
          {{ s.loading ? '加载中…' : (s.list.length ? '没有匹配的指令' : '这个会话里还没有机器人注册指令') }}
        </p>
      </div>

      <footer class="dim small">
        点击一条指令会填进输入框；「直发指令」会直接发送。输入 <b>/</b> 可以随时再唤起这个面板。
      </footer>
    </div>
  </div>
</template>

<style scoped>
.cmd-mask { position: absolute; inset: 0; background: rgba(0, 0, 0, .28); z-index: 60; display: flex; align-items: flex-end; justify-content: center; }
.cmd { width: 760px; max-width: 96%; max-height: 66%; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px 14px 0 0; box-shadow: var(--shadow); overflow: hidden; }
.cmd > header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.cmd > header .grow { flex: 1; }
.cmd-x { background: transparent; color: var(--fg2); font-size: 20px; line-height: 1; padding: 0 8px; }
.cmd-x:hover { color: var(--fg); }
.cmd-body { overflow: auto; padding: 12px 14px; }
.grp + .grp { margin-top: 14px; }
.grp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.grp-head .bot { font-size: 12.5px; color: var(--fg2); border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; }
.items { display: flex; flex-direction: column; gap: 2px; }
.item { display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left; background: transparent; border: 0; padding: 7px 10px; border-radius: 8px; cursor: pointer; color: var(--fg); }
.item:hover { background: var(--card2); }
.item .nm { font-size: 13.5px; font-weight: 500; flex: 0 0 auto; }
.item .ds { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .bad { font-style: normal; font-size: 10.5px; color: var(--warn); }
.cmd > footer { padding: 8px 14px; border-top: 1px solid var(--line); }
.center { text-align: center; padding: 20px 0; }
</style>
