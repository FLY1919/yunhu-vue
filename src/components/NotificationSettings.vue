<script setup lang="ts">
import { computed, inject } from 'vue'
import ThemedSelect from './ThemedSelect.vue'
const ui = inject<any>('ctx').ui
const modes = computed(() => [
  { value: 'windows', label: 'Windows 系统通知', disabled: !ui.state.nativeNotificationsSupported },
  { value: 'in-app', label: '软件内通知（右上角）' },
])
</script>

<template>
  <div class="notification-settings">
    <span>新消息通知方式</span>
    <ThemedSelect class="notification-mode" label="新消息通知方式" :model-value="ui.state.notificationMode"
      :options="modes" @update:model-value="ui.setNotificationMode($event)" />
    <label v-if="ui.state.notificationMode === 'windows'" class="notification-focus">
      <input type="checkbox" :checked="ui.state.systemToastInFocus"
        @change="ui.setSystemToastInFocus(($event.target as HTMLInputElement).checked)" />
      软件有焦点时显示系统 Toast 通知
    </label>
    <p class="dim small">即时生效并自动保存。仅接收未开启免打扰的会话；点击新消息通知可跳转到对应消息。</p>
    <p v-if="!ui.state.nativeNotificationsSupported" class="dim small">Windows 系统通知需使用 Windows 桌面版；当前使用软件内通知。</p>
    <p v-else class="dim small">系统通知遵循 Windows 的通知与免打扰设置。软件内通知在窗口右上角显示。</p>
    <p v-if="ui.state.notificationError" class="notification-error" role="status">
      系统通知暂不可用：{{ ui.state.notificationError }}。点击「发送测试通知」可重试；新消息显示失败时会转为软件内提示。
    </p>
    <button class="ghost small" @click="ui.testNotification()">发送测试通知</button>
  </div>
</template>

<style scoped>
.notification-settings { display: grid; gap: 10px; }
.notification-mode { width: 100%; max-width: 360px; }
.notification-settings p { margin: 0; }
.notification-settings button { justify-self: start; }
.notification-focus { display:flex; align-items:center; gap:8px; }
.notification-focus input { accent-color:var(--acc); }
.notification-error { color: var(--warn); font-size: 13px; overflow-wrap: anywhere; }
</style>
