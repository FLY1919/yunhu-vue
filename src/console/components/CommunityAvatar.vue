<script setup lang="ts">
import { ref, watch } from 'vue'
import { resUrl } from '../../core/res'
import { vResourceMedia } from '../../core/resource-media'
const props = defineProps<{ name?: string; src?: string }>()
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>
<template>
  <span class="community-avatar" aria-hidden="true">
    <img v-if="src && !failed" v-resource-media="{ src: resUrl(src), animated: true, width: 48, height: 48 }" alt="" decoding="async" @error="failed = true" />
    <span v-else>{{ [...(name || '板')][0] }}</span>
  </span>
</template>
<style scoped>
.community-avatar { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 14px; display: grid; place-items: center; overflow: hidden; background: var(--acc-soft); color: var(--fg); font-size: 19px; font-weight: 600; }
.community-avatar img { width: 100%; height: 100%; object-fit: cover; }
</style>
