<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import { fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
import Icon from '../console/components/Icon.vue'
const ctx = inject<any>('ctx'), g = ctx.group
const info = computed(() => g.state.info)
const editing = ref(false), busy = ref(false)
const draft = reactive({ name: '', introduction: '' })
const canEdit = computed(() => !!g.roleOf(String(ctx.auth.state.user?.id || '')))
const dirty = computed(() => draft.name !== (info.value?.name || '') || draft.introduction !== (info.value?.introduction || ''))
function reset() { draft.name = info.value?.name || ''; draft.introduction = info.value?.introduction || ''; editing.value = false }
let saveVersion = 0
watch(() => ctx.chat.state.current?.id, () => { saveVersion++; busy.value = false; reset() }, { flush:'sync' })
function edit() { reset(); editing.value = true }
async function save() {
  const gid = ctx.chat.state.current?.id
  if (!gid || !canEdit.value || busy.value || !draft.name.trim()) return
  const version = ++saveVersion
  busy.value = true
  try {
    await ctx.api.editGroup(gid, { name: draft.name.trim(), introduction: draft.introduction.trim() })
    if (ctx.chat.state.current?.id !== gid || version !== saveVersion) return
    const name = draft.name.trim()
    ctx.chat.state.current.name = name
    const c = ctx.chat.state.conversations.find((c: any) => c.id === gid && c.type === 2)
    if (c) c.name = name
    await g.loadInfo()
    if (version !== saveVersion) return
    reset(); ctx.ui.toast('群资料已保存', 'success')
  } catch (e: any) { ctx.ui.toast('保存失败：' + e.message, 'error') }
  finally { if (version === saveVersion) busy.value = false }
}
async function copyId() {
  try { await navigator.clipboard.writeText(String(ctx.chat.state.current.id)); ctx.ui.toast('群号已复制', 'success') }
  catch { ctx.ui.toast('复制失败', 'error') }
}
function settings() { g.closeDock(); g.open() }
</script>
<template>
  <section class="group-ui group-info-workspace" :aria-busy="g.state.infoLoading">
    <div v-if="!info" class="info-empty"><h2>{{ g.state.infoLoading ? '正在加载群资料…' : '暂时无法获取群资料' }}</h2><button class="ghost small" :disabled="g.state.infoLoading" @click="g.loadInfo()">重新加载</button></div>
    <template v-else>
      <header class="group-hero"><img :src="info.avatar ? resUrl(info.avatar) : fallbackAvatar(info.name)" alt="" @error="(e:any) => e.target.src = fallbackAvatar(info.name)" /><div><p class="group-caption">群资料</p><h2>{{ info.name || ctx.chat.state.current?.name }}</h2><button class="copy-group-id" @click="copyId">群 ID {{ ctx.chat.state.current?.id }} <Icon name="copy" :size="12" /></button></div><button v-if="canEdit && !editing" class="ghost small" @click="edit">编辑资料</button></header>
      <div class="info-layout"><div>
        <section class="group-card"><div class="group-section-head"><h3>{{ editing ? '编辑群资料' : '群简介' }}</h3><span v-if="editing && dirty" class="group-caption">有未保存的修改</span></div>
          <form v-if="editing" @submit.prevent="save"><label class="group-field">群名称<input v-model="draft.name" aria-label="群名称" required :disabled="busy" /></label><label class="group-field">群简介<textarea v-model="draft.introduction" aria-label="群简介" :disabled="busy" rows="6" placeholder="介绍一下这个群聊" /></label><div class="group-actions"><button type="button" class="ghost small" :disabled="busy" @click="reset">取消</button><button class="group-primary" :disabled="busy || !dirty || !draft.name.trim()">{{ busy ? '保存中…' : '保存群资料' }}</button></div></form>
          <p v-else class="group-introduction">{{ info.introduction || '这个群聊还没有填写简介。' }}</p>
        </section>
        <section class="group-card"><div class="group-section-head"><h3>群聊管理</h3></div><p class="group-caption">消息提醒、我的群昵称、入群方式与消息自动清理，可在群设置中调整。</p><div class="group-actions settings-link"><button class="ghost small" @click="settings"><Icon name="settings" :size="13" /> 打开群设置</button></div></section>
      </div><aside class="group-card info-facts"><h3>基本信息</h3><dl><div><dt>成员</dt><dd><button @click="g.setDockTab('members')">{{ info.headcount || g.state.membersTotal || 0 }} 人 <Icon name="chevronRight" :size="12" /></button></dd></div><div><dt>群主</dt><dd><button v-if="info.owner || info.createBy" @click="g.openProfile({ id: info.owner || info.createBy, name: info.owner || info.createBy })">{{ info.owner || info.createBy }}</button><span v-else>暂无信息</span></dd></div><div v-if="info.category"><dt>分类</dt><dd>{{ info.category }}</dd></div><div><dt>可见范围</dt><dd>{{ info.isPrivate ? '私有群聊' : '公开群聊' }}</dd></div><div><dt>加入方式</dt><dd>{{ info.joinFree ? '直接加入' : '需要审核' }}</dd></div><div><dt>历史消息</dt><dd>{{ info.readHistory ? '新成员可见' : '新成员不可见' }}</dd></div><div v-if="info.groupCode"><dt>群口令</dt><dd>{{ info.groupCode }}</dd></div></dl></aside></div>
    </template>
  </section>
</template>
<style scoped>
.group-hero { display:flex; align-items:center; gap:18px; padding:8px 0 26px; }.group-hero>img { width:76px; height:76px; border-radius:22px; object-fit:cover; background:var(--card2); }.group-hero>div { flex:1; min-width:0; }.group-hero h2 { overflow-wrap:anywhere; margin-top:3px; }.copy-group-id { display:inline-flex; align-items:center; gap:7px; background:transparent; color:var(--fg2); padding:5px 0; font-size:12px; }
.info-layout { display:grid; grid-template-columns:minmax(0,1fr) 245px; align-items:start; gap:18px; }.group-introduction { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.9; font-size:13px; }.settings-link { margin-top:14px; }.info-facts { margin:0 !important; }.info-facts h3 { margin-bottom:8px; }.info-facts dl { margin:0; }.info-facts dl>div { padding:12px 0; border-bottom:1px solid var(--line); }.info-facts dl>div:last-child { border-bottom:0; padding-bottom:0; }.info-facts dt { color:var(--fg2); font-size:11px; margin-bottom:4px; }.info-facts dd { margin:0; font-size:13px; overflow-wrap:anywhere; }.info-facts button { background:transparent; color:var(--fg); padding:0; display:inline-flex; align-items:center; gap:4px; text-align:left; }.info-empty { padding:50px 0; text-align:center; }.info-empty button { margin-top:16px; }
@media(max-width:650px) { .info-layout { grid-template-columns:1fr; }.group-hero { gap:12px; flex-wrap:wrap; }.group-hero>img { width:58px; height:58px; border-radius:16px; }.group-hero>button { margin-left:70px; }.info-facts dl { display:grid; grid-template-columns:1fr 1fr; gap:0 12px; } }
</style>
