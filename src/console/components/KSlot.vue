<script setup lang="ts">
/** 插槽容器：渲染所有向 type 注册的组件（对标 k-slot） */
import { inject, computed } from 'vue'

const props = defineProps({ name: { type: String, required: true } })
const ctx = inject('ctx')

const list = computed(() => (ctx.console ? ctx.console.slotsOf(props.name) : []))
</script>

<template>
  <component v-for="(s, i) in list" :key="i" :is="s.component" v-bind="s.props || {}" />
</template>
