<script setup lang="ts">
/**
 * EditDialog —— 编辑自己的文本消息（/v1/msg/edit-message）
 * 由 message-actions 的 msg.edit 菜单项打开（state.editingId）。
 */
import { inject, ref, computed, watch } from 'vue'

const ctx = inject<any>('ctx')
// ⚠️ 插槽组件 setup 早于 message-actions 插件装载时 ctx.messageActions 是 undefined，
//    必须响应式取（computed），否则编辑弹窗永远打不开
const ma = computed(() => ctx.messageActions)
const chat = computed(() => ctx.chat)

const text = ref('')
const busy = ref(false)

const msg = computed(() =>
  chat.value?.state?.messages?.find((m: any) => m.id === ma.value?.state?.editingId) || null)

watch(() => ma.value?.state?.editingId, (id) => {
  if (!id) return
  const m = chat.value?.state?.messages?.find((x: any) => x.id === id)
  text.value = m?.content?.text || ''
})

function close() { ma.value.state.editingId = '' }

async function save() {
  const v = text.value.trim()
  if (!v || busy.value) return
  busy.value = true
  const id = ma.value.state.editingId
  try {
    await chat.value.edit(id, v)
    if (ma.value.state.editingId === id) close()
  } catch (e: any) {
    ctx.ui?.toast?.('编辑失败：' + e.message, 'error')
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="msg" class="ed-mask" @click.self="close">
    <div class="ed-box">
      <div class="ed-head">
        <span>编辑消息</span>
        <button class="ed-x" title="关闭" @click="close">×</button>
      </div>
      <textarea v-model="text" class="ed-ta" rows="5" placeholder="消息内容" autofocus ref="edTa"></textarea>
      <div class="ed-foot">
        <button class="ghost tiny" @click="close">取消</button>
        <button class="ed-ok tiny" :disabled="busy || !text.trim()" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ed-mask {
  position: fixed; inset: 0; z-index: 88; background: rgba(0, 0, 0, .45);
  display: grid; place-items: center; backdrop-filter: blur(4px);
}
.ed-box {
  width: min(440px, 92vw); background: var(--card); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: 0 18px 50px rgba(0, 0, 0, .45); overflow: hidden;
}
.ed-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 14px; font-weight: 600;
}
.ed-x {
  width: 24px; height: 24px; border: none; background: none; color: var(--fg2);
  font-size: 16px; line-height: 1; border-radius: 6px; cursor: pointer;
}
.ed-x:hover { background: var(--card2); color: var(--fg); }
.ed-ta {
  width: 100%; border: none; background: transparent; color: var(--fg);
  padding: 14px 16px; font-size: 13.5px; line-height: 1.7; resize: vertical; outline: none;
  font-family: inherit;
}
.ed-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px 14px; }
.ed-ok { background: var(--acc); color: #fff; border-color: transparent; }
</style>
