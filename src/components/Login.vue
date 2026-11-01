<script setup lang="ts">
/**
 * 登录页（邮箱登录 / Token 登录）
 * 凭据由 auth/storage 服务持久化；Windows 使用系统安全存储。
 * 页面上显示的 API 基址来自 api 服务，方便换部署环境时确认走的是哪条链路。
 */
import { inject, ref } from 'vue'
import SavedAccounts from './SavedAccounts.vue'

const props = defineProps<{ embedded?: boolean; initialEmail?: string }>()
const emit = defineEmits<{ (e: 'done'): void; (e: 'cancel'): void }>()

const ctx = inject<any>('ctx')
const auth = ctx.auth
const api = ctx.api

const tab = ref('pwd')
const email = ref(props.initialEmail || '')
const password = ref('')
const token = ref('')
const err = ref('')
const busy = ref(false)

async function withBusy(fn) {
  if (busy.value) return
  err.value = ''
  busy.value = true
  try { await fn(); password.value = ''; token.value = ''; emit('done') } catch (e) { err.value = (e?.message || String(e)) || String(e) } finally { busy.value = false }
}

const doLogin = () => withBusy(() => auth.login(email.value.trim(), password.value))
const doToken = () => withBusy(() => auth.loginWithToken(token.value))
</script>

<template>
  <div class="login-card" :class="{ embedded }">
    <img v-if="!embedded" class="brand" src="../../assets/brand.jpg" alt="云湖牢大版" />
    <h1>{{ embedded ? '添加账号' : '云湖牢大版' }}</h1>
    <div class="sub">{{ embedded ? '登录成功后自动切换到新账号。' : '欢迎回来，选择已保存账号或登录新账号。' }}</div>
    <SavedAccounts v-if="!embedded" class="login-saved" @reauth="email = $event; tab = 'pwd'" />

    <div class="tabs">
      <button :class="{ on: tab === 'pwd' }" @click="tab = 'pwd'">邮箱登录</button>
      <button :class="{ on: tab === 'token' }" @click="tab = 'token'">Token 登录</button>
    </div>

    <template v-if="tab === 'pwd'">
      <label>邮箱</label>
      <input v-model="email" type="email" autocomplete="username" placeholder="you@example.com" :disabled="busy" @keyup.enter="doLogin" />
      <label>密码</label>
      <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" :disabled="busy" @keyup.enter="doLogin" />
      <button class="main" :disabled="busy" @click="doLogin">{{ busy ? '登录中…' : '登录' }}</button>
    </template>

    <template v-else>
      <label>账号 Token</label>
      <input v-model="token" type="password" autocomplete="off" placeholder="粘贴 token" :disabled="busy" @keyup.enter="doToken" />
      <button class="main" :disabled="busy" @click="doToken">{{ busy ? '验证中…' : '进入' }}</button>
    </template>

    <div class="err">{{ err || auth.state.error }}</div>
    <button v-if="embedded" class="ghost" :disabled="busy" @click="emit('cancel')">取消添加</button>
    <div class="tip">登录凭据仅用于此设备恢复登录。</div>
  </div>
</template>

<style scoped>
.login-saved { margin-top: 20px; max-height: min(38vh, 320px); overflow-y: auto; scrollbar-gutter: stable; padding-right: 4px; }
.login-card.embedded { width: 100%; max-width: 520px; padding: 20px; background: var(--card); box-shadow: none; margin: 0; }
.embedded h1 { font-size: 20px; margin-top: 0; }
</style>
