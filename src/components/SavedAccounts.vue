<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import Icon from '../console/components/Icon.vue'
import { resUrl } from '../core/res'
import { fallbackAvatar } from '../core/util'
const ctx = inject<any>('ctx'), auth = ctx.auth
const emit = defineEmits<{ (e: 'reauth', email: string): void }>()
const pending = ref(''), error = ref('')
const accounts = computed(() => auth.state.savedAccounts || [])
async function reload(refresh = false) {
  error.value = ''
  try { await auth.loadAccounts?.(refresh) }
  catch (e: any) { error.value = '读取本地账号失败：' + (e?.message || String(e)) }
}
onMounted(() => { void reload() })
async function choose(account: any) {
  if (pending.value) return
  if (account.needsLogin) { emit('reauth', account.email || ''); return }
  pending.value = account.id; error.value = ''
  try { await auth.switchAccount(account.id) }
  catch (e: any) { error.value = '切换登录失败：' + (e?.message || String(e)) + '，可重试或重新登录。' }
  finally { pending.value = '' }
}
async function forget(account: any) {
  if (!await ctx.ui.confirm('移除本地账号', `移除 ${account.name} 的已保存登录凭据？`, { okText: '移除' })) return
  try { await auth.forgetAccount(account.id) }
  catch (e: any) { error.value = (e?.message || String(e)) }
}
</script>

<template>
  <div class="saved-accounts" aria-label="本地已保存账号">
    <div class="saved-heading"><strong>已保存账号<span v-if="accounts.length">（{{ accounts.length }}）</span></strong><button class="ghost small" :disabled="auth.state.accountsLoading || !!pending" @click="reload(true)"><Icon name="refresh" :size="14" /> 刷新账号</button></div>
    <div v-if="auth.state.accountsLoading" class="dim small" role="status">正在识别本地账号…</div>
    <p v-else-if="!error && !accounts.length" class="dim small">暂无已保存账号，登录后会自动加入此列表。</p>
    <div v-for="account in accounts" :key="account.id" class="saved-account" :class="{ current: String(auth.state.user?.id) === account.id }">
      <img :src="account.avatar ? resUrl(account.avatar) : fallbackAvatar(account.name)" alt="" />
      <div class="saved-account-info"><strong>{{ account.name }}</strong><span>ID {{ account.id }}<template v-if="account.email"> · {{ account.email }}</template></span></div>
      <span v-if="String(auth.state.user?.id) === account.id" class="current-label"><Icon name="check" :size="14" /> 当前</span>
      <template v-else>
        <button class="ghost small switch-account" :disabled="!!pending" @click="choose(account)">{{ pending === account.id ? '验证中…' : account.needsLogin ? '重新登录' : '切换登录' }}</button>
        <button class="ghost small" :disabled="!!pending" :aria-label="'移除账号 ' + account.name" title="移除本地凭据" @click="forget(account)"><Icon name="trash" :size="15" /></button>
      </template>
    </div>
    <p v-if="error" class="err small" role="alert">{{ error }}</p>
    <p v-if="accounts.length" class="dim small saved-hint">退出登录会保留已保存账号；点击移除可删除本机凭据。不保存邮箱密码，聊天缓存按账号分开。</p>
  </div>
</template>

<style scoped>
.saved-accounts { display: grid; gap: 8px; }
.saved-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.saved-account { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; transition: background .18s, border-color .18s; }
.saved-account:hover, .saved-account.current { background: var(--card2); }
.saved-account img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.saved-account-info { display: grid; gap: 3px; flex: 1; min-width: 0; }
.saved-account-info strong { font-size: 14px; }
.saved-account-info span { color: var(--fg2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.current-label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--acc); }
.saved-hint { margin: 6px 0 0; line-height: 1.6; }
@media(max-width: 560px) { .saved-account { flex-wrap: wrap; } .saved-account-info { min-width: 120px; } }
</style>
