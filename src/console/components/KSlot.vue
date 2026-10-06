<script setup lang="ts">
/**
 * 插槽容器：渲染所有向 type 注册的组件（对标 k-slot）
 *
 * ⚠️ 响应式要点：插槽是运行时动态 push 进 console.state.slots 的，
 *    这里必须**直接依赖 state.slots**（reactive 数组），否则新安装的插件
 *    注入插槽后不会触发重新渲染（表现：插槽注册了但页面不显示）。
 */
import { inject, computed } from 'vue'

const props = defineProps({ name: { type: String, required: true } })
const ctx: any = inject('ctx')

const list = computed(() => {
  const st = ctx?.console?.state
  if (!st || !st.slots) return []
  // 直接读 reactive 数组，建立依赖
  const all = st.slots
  return all.filter((s: any) => s.type === props.name && !s.disabled?.())
})
</script>

<template>
  <component
    v-for="(s, i) in list"
    :key="i"
    :is="s.component"
    v-bind="s.props || {}"
  />
</template>
