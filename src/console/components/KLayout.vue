<script setup lang="ts">
/** 页面布局：标题栏 + 菜单动作 + 内容区（对标 k-layout） */
import { inject, computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  menu: { type: String, default: '' },
})

const ctx = inject('ctx')
const items = computed(() => (props.menu && ctx.console ? ctx.console.state.menus[props.menu] || [] : []))
function run(id) { ctx.console?.run(id) }
</script>

<template>
  <div class="k-layout">
    <header class="k-header">
      <div class="k-title">
        <h2>{{ title }}</h2>
        <p v-if="desc">{{ desc }}</p>
      </div>
      <div class="k-actions">
        <button v-for="m in items" :key="m.id" class="ghost small" @click="run(m.id)">{{ m.label }}</button>
        <slot name="actions" />
      </div>
    </header>
    <div class="k-body"><slot /></div>
  </div>
</template>
