<script setup lang="ts">
/** 快捷回复管理页（由 quickreply 插件注册；卸载插件后本页随之消失） */
import { inject, ref } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'

const ctx = inject('ctx')
const qr = ctx.quickreply
const ui = ctx.ui
const draft = ref('')

function add() {
  const v = draft.value.trim()
  if (!v) return
  if (qr.state.items.includes(v)) return ui.toast('已经存在了', 'warn')
  qr.add(v)
  draft.value = ''
  ui.toast('已添加', 'success')
}
</script>

<template>
  <KLayout title="快捷回复" desc="这一页由 quickreply 插件注册，卸载插件后页面会一起消失">
    <template #actions>
      <label class="switch">
        <input type="checkbox" v-model="qr.state.enabled" />
        <span>启用按钮条</span>
      </label>
    </template>

    <KCard title="编辑">
      <div class="row-inline">
        <input v-model="draft" placeholder="新增一条快捷回复…" @keyup.enter="add" />
        <button @click="add">添加</button>
      </div>
      <div class="tags mt-sm">
        <span v-for="(q, i) in qr.state.items" :key="i" class="tag">
          {{ q }}
          <button class="tag-x" @click="qr.remove(i)">×</button>
        </span>
        <span v-if="!qr.state.items.length" class="dim">还没有内容</span>
      </div>
    </KCard>

    <KCard title="效果" class="mt">
      <p class="dim small">聊天页面输入框上方的那排按钮就是这些内容，点击即发送。</p>
      <div class="tags">
        <button v-for="(q, i) in qr.state.items" :key="i" class="ghost small" :disabled="!qr.state.enabled">{{ q }}</button>
      </div>
    </KCard>
  </KLayout>
</template>
