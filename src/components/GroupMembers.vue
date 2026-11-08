<script setup lang="ts">
import { computed, inject, ref, watch, onUnmounted } from 'vue'
import Icon from '../console/components/Icon.vue'
import { fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
const emit = defineEmits<{ manage: [member: any] }>()
const ctx = inject<any>('ctx'), g = ctx.group
const filter = ref('all'), botId = ref(''), botBusy = ref(false), addingBot = ref(false)
const me = computed(() => String(ctx.auth.state.user?.id || ''))
const canManage = computed(() => !!g.roleOf(me.value))
const visible = computed(() => {
  if (filter.value === 'bots') return g.state.bots || []
  return g.state.members.filter((m: any) => filter.value === 'all' || (filter.value === 'admins' ? m.level >= 2 : m.isGag))
    .slice().sort((a: any, b: any) => (b.level || 0) - (a.level || 0))
})
let searchTimer: ReturnType<typeof setTimeout>
watch(() => g.state.memberKeyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { if (filter.value !== 'bots') void g.loadMembers() }, 280)
})
onUnmounted(() => clearTimeout(searchTimer))
function search() { clearTimeout(searchTimer); void g.loadMembers() }
function message(m: any) { g.closeDock(); ctx.chat.open({ ...m, type: filter.value === 'bots' ? 3 : 1 }) }
function mention(m: any) { g.closeDock(); ctx.emit('composer/mention', { id: m.id, name: m.name }) }
async function copy(id: string) {
  try { await navigator.clipboard.writeText(String(id)); ctx.ui.toast('ID 已复制', 'success') }
  catch { ctx.ui.toast('复制失败', 'error') }
}
async function addBot() {
  const gid = ctx.chat.state.current?.id, id = botId.value.trim()
  if (!gid || !id || botBusy.value) return
  botBusy.value = true
  try {
    await ctx.api.inviteBotToGroup(id, gid)
    if (ctx.chat.state.current?.id !== gid) return
    botId.value = ''; addingBot.value = false; await g.loadBots()
    ctx.ui.toast('已发送机器人入群邀请', 'success')
  } catch (e: any) { ctx.ui.toast('邀请失败：' + e.message, 'error') }
  finally { botBusy.value = false }
}
async function removeBot(m: any) {
  const gid = ctx.chat.state.current?.id
  if (!gid || botBusy.value || !await ctx.ui.confirm('移除机器人', `将「${m.name}」移出本群？`, { danger: true })) return
  botBusy.value = true
  try {
    await ctx.api.removeGroupBot(gid, m.id)
    if (ctx.chat.state.current?.id === gid) await g.loadBots()
    ctx.ui.toast('机器人已移除', 'success')
  } catch (e: any) { ctx.ui.toast('移除失败：' + e.message, 'error') }
  finally { botBusy.value = false }
}
</script>
<template>
  <section class="group-ui members-workspace">
    <div class="members-heading"><div><h2>群成员 <span>{{ g.state.membersTotal || g.state.info?.headcount || 0 }}</span></h2><p class="group-caption">{{ ctx.chat.state.current?.name }} · 在这里查找和管理成员</p></div>
      <button class="ghost small" :disabled="g.state.membersLoading" @click="g.loadMembers(); g.loadBots()"><Icon name="refresh" :size="14" /> 刷新</button></div>
    <form v-if="filter !== 'bots'" class="members-search" @submit.prevent="search"><Icon name="search" :size="17" /><input v-model="g.state.memberKeyword" aria-label="搜索群成员" placeholder="搜索昵称或云湖 ID" /><button type="submit" class="ghost small" :disabled="g.state.membersLoading">搜索</button></form>
    <div class="members-toolbar" role="group" aria-label="成员筛选">
      <button v-for="item in [{ id:'all',name:'全部成员' },{ id:'admins',name:'群主与管理员' },{ id:'gag',name:'已禁言' },{ id:'bots',name:'机器人' }]" :key="item.id" :aria-pressed="filter === item.id" @click="filter = item.id">{{ item.name }}<span v-if="item.id === 'bots'">{{ g.state.bots?.length || 0 }}</span></button>
    </div>
    <div v-if="g.state.membersError && filter !== 'bots'" class="group-error" role="alert">{{ g.state.membersError }} <button class="ghost small" @click="search">重试</button></div>
    <div v-if="filter === 'bots' && g.state.botsError" class="group-error" role="alert">{{ g.state.botsError }} <button class="ghost small" @click="g.loadBots()">重试</button></div>
    <p v-if="filter === 'admins' || filter === 'gag'" class="group-caption filter-note">筛选当前已加载的 {{ g.state.members.length }} 名成员，可继续加载更多。</p>
    <div v-if="filter === 'bots'" class="bot-toolbar"><p class="group-caption">机器人拥有独立的资料和对话入口。</p><button class="ghost small" @click="addingBot = !addingBot">{{ addingBot ? '取消' : '添加机器人' }}</button></div>
    <form v-if="filter === 'bots' && addingBot" class="bot-invite" @submit.prevent="addBot"><label class="group-field">机器人 ID<input v-model="botId" placeholder="输入已添加为好友的机器人 ID" required /></label><button class="group-primary" :disabled="botBusy || !botId.trim()">{{ botBusy ? '邀请中…' : '发送邀请' }}</button></form>
    <Transition name="group-content" mode="out-in">
      <ul :key="filter" class="members-list" :aria-busy="g.state.membersLoading">
        <li v-for="m in visible" :key="m.id" class="member-row">
          <button class="member-identity" @click="g.openProfile({ ...m, isBot: filter === 'bots' })"><img :src="m.avatar ? resUrl(m.avatar) : fallbackAvatar(m.name)" alt="" @error="(e: any) => e.target.src = fallbackAvatar(m.name)" /><span><b>{{ m.name || m.id }}</b><small>ID {{ m.id }}</small></span></button>
          <span class="member-badges"><em v-if="m.level >= 100">群主</em><em v-else-if="m.level >= 2">管理员</em><em v-if="m.isGag">已禁言</em><em v-if="String(m.id) === me">我</em></span>
          <div class="member-actions"><button class="ghost small" :title="'复制 ' + m.id" aria-label="复制成员 ID" @click="copy(m.id)"><Icon name="copy" :size="14" /></button><button v-if="String(m.id) !== me" class="ghost small" @click="message(m)">发消息</button><button v-if="filter !== 'bots' && String(m.id) !== me" class="ghost small" @click="mention(m)">@ 他</button><button v-if="filter !== 'bots'" class="ghost small" @click="emit('manage', m)">{{ canManage ? '管理' : '更多' }}</button><button v-else class="ghost small" :disabled="botBusy" @click="removeBot(m)">移除</button></div>
        </li>
        <li v-if="!visible.length" class="members-empty"><Icon name="user" :size="28" /><b>{{ (filter === 'bots' ? g.state.botsLoading : g.state.membersLoading) ? '正在加载…' : filter === 'bots' ? '群内还没有机器人' : '没有符合条件的成员' }}</b><span class="group-caption">{{ filter === 'all' ? '试试其他昵称或 ID，或刷新列表。' : '可切换筛选，或继续加载更多成员。' }}</span></li>
      </ul>
    </Transition>
    <footer v-if="filter !== 'bots'" class="members-footer"><span class="group-caption" role="status">已加载 {{ g.state.members.length }} / {{ g.state.membersTotal }} 人</span><button v-if="g.state.members.length < g.state.membersTotal" class="ghost small" :disabled="g.state.membersLoading" @click="g.loadMoreMembers()">{{ g.state.membersLoading ? '加载中…' : '加载更多' }}</button></footer>
  </section>
</template>
<style scoped>
.members-heading { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:22px; }.members-heading h2 span { font-size:14px; color:var(--fg2); font-weight:400; margin-left:5px; }.members-heading p { margin-top:5px; }
.members-search { display:flex; align-items:center; gap:10px; background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:5px 8px 5px 13px; }.members-search input { flex:1; min-width:0; border:0; background:transparent; padding:7px 0; box-shadow:none; }.members-toolbar { display:flex; gap:5px; flex-wrap:wrap; padding:16px 0; }.members-toolbar button { display:flex; gap:6px; background:transparent; color:var(--fg2); font-size:12px; padding:7px 12px; border-radius:9px; }.members-toolbar button[aria-pressed=true] { color:var(--fg); background:var(--card2); }.members-toolbar button span { font-size:11px; }
.members-list { list-style:none; padding:0; margin:0; }.member-row { display:flex; align-items:center; gap:12px; padding:12px 5px; border-bottom:1px solid var(--line); }.member-identity { display:flex; align-items:center; gap:12px; flex:1; min-width:100px; text-align:left; padding:0; background:transparent; color:var(--fg); }.member-identity img { width:42px; height:42px; border-radius:13px; object-fit:cover; background:var(--card2); }.member-identity>span { min-width:0; }.member-identity b { display:block; font-size:13px; font-weight:550; overflow-wrap:anywhere; }.member-identity small { display:block; color:var(--fg2); font-size:11px; }.member-badges { display:flex; gap:4px; flex-wrap:wrap; }.member-badges em { font-size:10px; font-style:normal; color:var(--fg2); background:var(--card2); padding:2px 6px; border-radius:5px; }.member-actions { display:flex; gap:5px; flex:0 0 auto; }.member-actions button { padding:5px 8px; font-size:11px; display:inline-flex; align-items:center; }
.members-footer,.bot-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:16px 0; }.members-empty { display:grid; justify-items:center; text-align:center; gap:12px; padding:55px 12px; color:var(--fg2); }.members-empty b { font-size:13px; }.filter-note { margin-bottom:10px !important; }.bot-invite { padding:16px; background:var(--card2); border-radius:12px; margin-bottom:12px; }.bot-invite .group-field { margin-bottom:10px; }
@media (hover:hover) and (pointer:fine) { .member-row:hover { background:color-mix(in srgb,var(--fg) 3%,transparent); } }
@media (max-width:600px) { .members-heading { margin-bottom:16px; }.member-row { gap:8px; padding:12px 0; }.member-identity { min-width:0; }.member-actions { margin-left:auto; }.member-actions button:not(:last-child) { display:none; }.members-toolbar button { padding:7px 9px; }.member-actions button { padding:6px 9px; } }
</style>
