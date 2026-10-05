<script setup lang="ts">
/** 聊天页面：会话列表 + 对话区（窄屏时列表变抽屉） */
import { ref, inject } from 'vue'
import Sidebar from '../../components/Sidebar.vue'
import ChatView from '../../components/ChatView.vue'

const drawer = ref(false)
// 背景样式要用到 ctx（ChatView 也是这么拿的）
const ctx = inject<any>('ctx')
</script>

<template>
  <div class="chat-page" :class="{ 'drawer-open': drawer }">
    <aside class="chat-side">
      <Sidebar />
    </aside>
    <!-- 聊天背景：charbg 插件按「会话专属 > 全局」给背景图 -->
    <div class="chat-main" :style="ctx?.charbg?.bgStyleOf?.(ctx?.chat?.state?.current?.id)">
      <ChatView @toggle-sidebar="drawer = !drawer" />
    </div>
    <div class="drawer-mask" v-if="drawer" @click="drawer = false"></div>
  </div>
</template>
