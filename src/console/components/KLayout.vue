<script setup lang="ts">
/** 页面布局：标题栏 + 菜单动作 + 内容区（对标 k-layout） */
import { inject, computed } from 'vue'
import KSlot from './KSlot.vue'

const props = defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  menu: { type: String, default: '' },
  /** 插槽命名空间：插件用 ctx.slot({ type: '<ns>-header' 等 }) 注入 */
  ns: { type: String, default: '' },
})

/** 该页面的插槽名（未传 ns 时按标题生成，保证每个页面都有独立扩展点） */
const sname = computed(() => {
  if (props.ns) return props.ns
  return (props.title || 'page').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
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
        <!-- 页面级插槽：插件可注入按钮/工具到标题栏 -->
        <KSlot :name="sname + '-header'" />
      </div>
    </header>
    <!-- 内容区上方插槽 -->
    <KSlot :name="sname + '-top'" />
    <div class="k-body"><slot /></div>
    <!-- 内容区下方插槽 -->
    <KSlot :name="sname + '-bottom'" />
  </div>
</template>
