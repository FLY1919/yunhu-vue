<script setup lang="ts">
import { inject, reactive, ref, onBeforeUnmount } from 'vue'

const ctx = inject<any>('ctx')
const emit = defineEmits<{ created: [id: string]; cancel: [] }>()
const form = reactive({ name: '', introduction: '', avatar: ctx.auth?.state?.user?.avatar || '' })
const submitting = ref(false)
const error = ref('')
let disposed = false
async function submit() {
  if (submitting.value || ctx.social?.state?.creation?.pending) return
  error.value = ''
  if (!form.name.trim()) { error.value = '群名称不能为空'; return }
  if (!form.avatar.trim()) { error.value = '请填写群头像地址，或先设置个人头像'; return }
  submitting.value = true
  try {
    const id = await ctx.social.createGroup(form.name, form.introduction, form.avatar)
    if (disposed) return
    if (id) emit('created', id)
    else error.value = ctx.social.state.creation?.error || '创建群聊失败，请检查后重试'
  } catch (e: any) { if (!disposed) error.value = e?.message || '创建群聊失败' }
  finally { submitting.value = false }
}
function cancel() { if (submitting.value) ctx.social.cancelCreateGroup?.(); emit('cancel') }
onBeforeUnmount(() => { disposed = true; if (submitting.value) ctx.social.cancelCreateGroup?.() })
</script>

<template>
  <form class="create-group-form" :aria-busy="submitting" @submit.prevent="submit">
    <label>群名称<input v-model="form.name" class="dlg-input" aria-label="群名称" placeholder="输入群名称" maxlength="30" :disabled="submitting" required /></label>
    <label>群简介<textarea v-model="form.introduction" class="dlg-input" aria-label="群简介" placeholder="群简介（可选）" rows="3" :disabled="submitting"></textarea></label>
    <label>群头像地址<input v-model="form.avatar" class="dlg-input" aria-label="群头像地址" placeholder="填写已上传的头像地址" :disabled="submitting" required /></label>
    <p class="group-hint">默认使用你的个人头像，可改为已上传的图片地址。</p>
    <div v-if="submitting" class="group-pending" role="status"><progress aria-label="正在创建群聊"></progress><span>正在创建群聊，最多等待 15 秒…</span></div>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <div class="dlg-foot">
      <button class="ghost tiny" type="button" @click="cancel">{{ submitting ? '停止等待' : '取消' }}</button>
      <button class="primary tiny" type="submit" :disabled="submitting || ctx.social?.state?.creation?.pending">{{ submitting ? '创建中…' : '创建群聊' }}</button>
    </div>
  </form>
</template>

<style scoped>
.create-group-form{display:flex;flex-direction:column;gap:12px;min-width:0}
label{display:flex;flex-direction:column;gap:6px;font-size:13px}
.dlg-input{width:100%;box-sizing:border-box;margin:0}
.group-hint{font-size:12px;color:var(--fg2);margin:0;line-height:1.5}
.group-pending{display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--fg2)}
progress{width:100%;height:5px;accent-color:var(--acc)}
.group-error{margin:0;font-size:13px;line-height:1.6;color:var(--danger,#df7777);overflow-wrap:anywhere}
.dlg-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
</style>
