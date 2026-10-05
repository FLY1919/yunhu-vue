<script setup lang="ts">
/**
 * 登录页（邮箱登录 / Token 登录）
 * 成功后会写 localStorage（yh.token），由 auth 插件负责持久化与自动恢复。
 * 页面上显示的 API 基址来自 api 服务，方便换部署环境时确认走的是哪条链路。
 */
import { inject, ref } from 'vue'

const ctx = inject('ctx')
const auth = ctx.auth
const api = ctx.api

const tab = ref('pwd')
const email = ref('')
const password = ref('')
const token = ref('')
const err = ref('')
const busy = ref(false)

async function withBusy(fn) {
  err.value = ''
  busy.value = true
  try { await fn() } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}

const doLogin = () => withBusy(() => auth.login(email.value.trim(), password.value))
const doToken = () => withBusy(() => auth.loginWithToken(token.value))
</script>

<template>
  <div class="login-card">
    <h1>云湖 · 第三方 Web 客户端</h1>
    <div class="sub">Vue 3 + Cordis 风格插件架构 · 仅供学习交流</div>

    <div class="tabs">
      <button :class="{ on: tab === 'pwd' }" @click="tab = 'pwd'">邮箱登录</button>
      <button :class="{ on: tab === 'token' }" @click="tab = 'token'">Token 登录</button>
    </div>

    <template v-if="tab === 'pwd'">
      <label>邮箱</label>
      <input v-model="email" type="email" placeholder="you@example.com" @keyup.enter="doLogin" />
      <label>密码</label>
      <input v-model="password" type="password" placeholder="••••••••" @keyup.enter="doLogin" />
      <button class="main" :disabled="busy" @click="doLogin">{{ busy ? '登录中…' : '登录' }}</button>
    </template>

    <template v-else>
      <label>账号 Token</label>
      <input v-model="token" type="text" placeholder="粘贴 token" @keyup.enter="doToken" />
      <button class="main" :disabled="busy" @click="doToken">{{ busy ? '验证中…' : '进入' }}</button>
    </template>

    <div class="err">{{ err }}</div>
    <div class="tip">
      API 基址：<code>{{ api.base }}</code><br />
      接口来自社区公开文档，使用你自己的账号登录，风险自负。
    </div>
  </div>
</template>
