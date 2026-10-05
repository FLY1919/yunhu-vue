<script setup lang="ts">
const props = defineProps({ title: { type: String, default: '' }, pad: { type: Boolean, default: true } })
</script>

<template>
  <section class="k-card" :class="{ 'no-pad': !pad }">
    <header v-if="title || $slots.header" class="k-card-head">
      <slot name="header">{{ title }}</slot>
    </header>
    <div class="k-card-body"><slot /></div>
  </section>
</template>
