<script setup lang="ts">
/**
 * 用户设置页（对标 Koishi 的「用户设置」）
 * 与「配置」页的区别：这里改的是**你自己**的偏好，存浏览器 IndexedDB；
 * 配置页改的是管理员级的插件配置，存 yunhu.config.yml。
 */
import { inject, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import SchemaForm from '../components/SchemaForm.vue'

const ctx = inject<any>('ctx')
const ui = ctx.ui

/** 所有插件通过 ctx.console.settings() 注册的用户设置 */
const list = computed(() => ctx.console?.state?.settings || [])
</script>

<template>
  <KLayout ns="settings-user" title="用户设置" desc="只影响你自己的偏好（存浏览器本地，不写配置文件）">
    <KCard v-for="s in list" :key="s.id" :title="s.title || s.id">
      <SchemaForm :schema="s.schema" :model-value="s.value || {}" @update:model-value="v => s.value = v" />
      <div class="acts">
        <button class="small" @click="ui.toast('已保存（即时生效）', 'success')">保存</button>
      </div>
    </KCard>

    <KCard v-if="!list.length" title="还没有用户设置">
      <p class="dim small">
        插件可以通过 <code>ctx.console.settings({ id, title, schema })</code>
        注册「用户级」配置（比如主题、语言）。目前还没有插件注册。
      </p>
    </KCard>
  </KLayout>
</template>

<style scoped>
.acts { display: flex; gap: 6px; margin-top: 10px; }
</style>
