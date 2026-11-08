<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
const ctx = inject<any>('ctx'), g = ctx.group
const info = computed(() => g.state.info)
const role = computed(() => g.roleOf(String(ctx.auth.state.user?.id || '')))
const busy = ref(''), error = ref(''), saved = ref('')
const limited = ref<number[]>([]), autoDelete = ref(0), keyword = ref('')
const types = [{ id:1,name:'文本' },{ id:2,name:'图片' },{ id:3,name:'Markdown' },{ id:4,name:'文件' },{ id:6,name:'文章' },{ id:7,name:'表情' },{ id:8,name:'HTML' },{ id:10,name:'视频' },{ id:11,name:'语音' },{ id:13,name:'语音通话' }]
watch(info, v => { limited.value = String(v?.limitedMsgType || '').split(',').map(Number).filter(Boolean); autoDelete.value = Number(v?.autoDeleteMessage) || 0; keyword.value = v?.groupCode || '' }, { immediate:true })
watch(() => ctx.chat.state.current?.id, () => { error.value = ''; saved.value = '' })
async function run(key: string, action: (gid: string) => Promise<unknown>, patch: any) {
  const gid = ctx.chat.state.current?.id
  if (!gid || !role.value || busy.value) return
  busy.value = key; error.value = ''; saved.value = ''
  try {
    await action(gid)
    if (ctx.chat.state.current?.id !== gid) return
    Object.assign(g.state.info, patch); saved.value = '设置已保存'; ctx.ui.toast('群设置已保存', 'success')
  } catch (e: any) { if (ctx.chat.state.current?.id === gid) error.value = e.message || '保存失败，请重试' }
  finally { busy.value = '' }
}
function changeFlag(key: string) {
  const value = !info.value?.[key]
  return run(key, gid => ctx.api.editGroup(gid, { [key]:value }), { [key]:value })
}
function toggleType(id:number) { limited.value = limited.value.includes(id) ? limited.value.filter(n => n !== id) : [...limited.value,id] }
</script>
<template>
  <div class="group-ui policy-settings">
    <p v-if="!role" class="group-caption">群管理设置仅向群主和管理员开放。</p>
    <template v-else-if="info">
      <section class="group-card"><div class="group-section-head"><div><h3>加入与隐私</h3><p class="group-caption">这些设置对本群所有成员生效。</p></div></div>
        <div v-for="row in [{ key:'joinFree',name:'进群免审核',desc:'开启后，用户可以直接加入群聊。' },{ key:'readHistory',name:'新成员可见历史消息',desc:'允许新加入的成员查看之前的消息。' },{ key:'isPrivate',name:'私有群聊',desc:'控制群聊的公开可见范围。' },{ key:'hideMembers',name:'隐藏群成员',desc:'限制普通成员查看群成员列表。' }]" :key="row.key" class="group-setting-row"><div><b :id="'policy-'+row.key">{{ row.name }}</b><p class="group-caption">{{ row.desc }}</p></div><button class="group-switch" role="switch" :aria-checked="!!info[row.key]" :aria-labelledby="'policy-'+row.key" :disabled="!!busy" @click="changeFlag(row.key)"><i /></button></div>
      </section>
      <section class="group-card"><div class="group-section-head"><div><h3>限制发送的消息类型</h3><p class="group-caption">选中的类型将被限制；全部取消表示不限制。</p></div></div><div class="policy-types"><button v-for="t in types" :key="t.id" class="ghost small" :aria-pressed="limited.includes(t.id)" :disabled="!!busy" @click="toggleType(t.id)">{{ t.name }}</button></div><div class="group-actions"><button class="group-primary" :disabled="!!busy" @click="run('types', gid => ctx.api.setMsgTypeLimit(gid, limited.join(',')), { limitedMsgType:limited.join(',') })">{{ busy === 'types' ? '保存中…' : '保存类型限制' }}</button></div></section>
      <template v-if="role === 'owner'">
        <section class="group-card"><div class="group-section-head"><h3>消息与文件</h3></div><label class="group-field">消息自动清理<select v-model.number="autoDelete" :disabled="!!busy"><option :value="0">永久保留</option><option :value="90">2 个月后删除</option><option :value="365">1 年后删除</option><option :value="730">2 年后删除</option><option v-if="![0,90,365,730].includes(autoDelete)" :value="autoDelete">当前设置（{{ autoDelete }}）</option></select></label><div class="group-actions"><button class="group-primary" :disabled="!!busy" @click="run('auto', gid => ctx.api.editAutoDeleteMessage(gid, autoDelete), { autoDeleteMessage:autoDelete })">{{ busy === 'auto' ? '保存中…' : '保存清理规则' }}</button></div><div class="group-setting-row upload-rule"><div><b id="deny-upload-title">禁止成员上传群文件</b><p class="group-caption">开启后限制普通成员向群云盘上传文件。</p></div><button class="group-switch" role="switch" :aria-checked="!!info.denyUpload" aria-labelledby="deny-upload-title" :disabled="!!busy" @click="run('upload', gid => ctx.api.setGroupDiskUpload(gid, !info.denyUpload), { denyUpload:!info.denyUpload })"><i /></button></div></section>
        <section class="group-card"><div class="group-section-head"><div><h3>群口令</h3><p class="group-caption">设置后可通过口令搜索到本群，需要群主拥有 VIP 权限。</p></div></div><label class="group-field">搜索口令<input v-model="keyword" placeholder="输入群口令" :disabled="!!busy" /></label><div class="group-actions"><button class="group-primary" :disabled="!!busy" @click="run('keyword', gid => ctx.api.editGroupKeyword(gid, keyword.trim()), { groupCode:keyword.trim() })">{{ busy === 'keyword' ? '保存中…' : '保存口令' }}</button></div></section>
      </template>
      <p v-if="error" class="group-error policy-feedback" role="alert">保存失败：{{ error }}</p><p v-else-if="saved" class="group-caption policy-feedback" role="status">{{ saved }}</p>
    </template>
    <p v-else class="group-caption">正在加载群设置…</p>
  </div>
</template>
<style scoped>
.policy-types { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:16px; }.policy-types button[aria-pressed=true] { border-color:var(--fg2); background:var(--card2); color:var(--fg); box-shadow:inset 0 0 0 1px var(--fg2); }.upload-rule { margin-top:18px; padding-bottom:0 !important; }.policy-feedback { margin-top:14px !important; }.policy-settings .group-section-head p { margin-top:4px; }
</style>
