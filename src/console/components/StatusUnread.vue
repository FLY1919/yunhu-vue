<script setup lang="ts">
/** 状态栏左侧插槽：未读总数（由 chat 插件注册） */
import { inject, computed } from 'vue'

const ctx = inject('ctx')
const chat = ctx.chat

const unread = computed(() =>
  chat.state.conversations.reduce((n, c) => n + (c.unread || 0), 0))
const at = computed(() => chat.state.conversations.filter(c => c.at).length)
</script>

<template>
  <span class="sb-item" v-if="chat">
    <span class="dot" :class="chat.state.current ? 'on' : ''"></span>
    会话 {{ chat.state.conversations.length }}
    <template v-if="unread">· 未读 <b>{{ unread }}</b></template>
    <template v-if="at">· <b class="warn">@我 {{ at }}</b></template>
  </span>
</template>
