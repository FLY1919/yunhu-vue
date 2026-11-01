<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import AccountPage from './AccountPage.vue'
import ConfigPage from './ConfigPage.vue'
import Icon from '../components/Icon.vue'
import { searchSettings, settingsCategories, settingsFeatures, pluginSettingFeatures } from '../../core/settings-catalog'

const ctx = inject<any>('ctx')
const selected = ref(ctx.console.state.currentPage === '/config' ? 'advanced' : 'general')
const query = ref(''), highlight = ref('')
const content = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
const externalPath: Record<string, string> = { appearance: '/theme', plugins: '/plugins' }
const external = computed(() => ctx.console.pages.find((p: any) => p.path === externalPath[selected.value])?.component)
const categories = computed(() => settingsCategories.filter(c => c.id !== 'plugins' || ctx.console.pages.some((p: any) => p.path === '/plugins')))
const results = computed(() => searchSettings(query.value, [...settingsFeatures, ...pluginSettingFeatures(ctx.app?.schemas?.() || [])]).filter(r => categories.value.some(c => c.id === r.category)))
function positionSetting() {
  const target = highlight.value ? content.value?.querySelector<HTMLElement>(`[data-setting-id="${highlight.value}"]`) : null
  if (target) {
    target.classList.add('settings-target'); target.setAttribute('tabindex', '-1')
    target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.focus({ preventScroll: true })
    clearTimeout(timer)
    timer = setTimeout(() => { target.classList.remove('settings-target'); highlight.value = '' }, 2200)
  }
}
async function choose(category: string, anchor = '') {
  clearTimeout(timer)
  content.value?.querySelectorAll('.settings-target').forEach(el => el.classList.remove('settings-target'))
  query.value = ''; selected.value = category; highlight.value = anchor
  await nextTick()
  positionSetting()
  if (!anchor) content.value?.querySelector('.k-body')?.scrollTo({ top: 0 })
}
watch(() => ctx.console.state.currentPage, p => { if (p === '/config') choose('advanced') })
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="settings-shell">
    <aside class="settings-sidebar">
      <div class="settings-heading"><h1>设置</h1><span>YH LaoDa</span></div>
      <label class="settings-search"><Icon name="search" :size="17" /><input v-model="query" aria-label="搜索设置与功能" placeholder="搜索设置与功能" @keydown.esc="query = ''" /><button v-if="query" class="ghost" aria-label="清空搜索" @click="query = ''">×</button></label>
      <nav class="settings-nav" aria-label="设置分类">
        <template v-for="group in ['偏好设置', '高级设置']" :key="group">
          <p class="settings-group">{{ group }}</p>
          <button v-for="category in categories.filter(c => c.group === group)" :key="category.id" class="settings-nav-item"
            :class="{ on: selected === category.id && !query }" :aria-current="selected === category.id && !query ? 'page' : undefined" @click="choose(category.id)">
            <Icon :name="category.icon" :size="18" /><span>{{ category.title }}</span>
          </button>
        </template>
      </nav>
    </aside>
    <section ref="content" class="settings-content" :data-highlight="highlight" aria-label="设置内容">
      <div v-if="query.trim()" class="settings-results">
        <h2>搜索结果 <span>{{ results.length }}</span></h2>
        <p class="dim small">点击功能项直接定位到对应设置。</p>
        <button v-for="result in results" :key="result.category + ':' + result.anchor + ':' + result.title + ':' + result.keywords" class="settings-result" @click="choose(result.category, result.anchor)">
          <Icon :name="categories.find(c => c.id === result.category)?.icon" :size="20" />
          <span><small>{{ result.categoryTitle }}</small><strong>{{ result.title }}</strong><span>{{ result.description }}</span></span>
          <Icon name="forward" :size="17" />
        </button>
        <p v-if="!results.length" class="settings-no-results">没有找到相关功能，试试“通知”“账号”或“表情”。</p>
      </div>
      <div v-show="!query.trim()" class="settings-page">
      <Transition name="settings-fade" mode="out-in" @after-enter="positionSetting">
        <ConfigPage v-if="selected === 'advanced'" key="advanced" />
        <component v-else-if="external" :is="external" :key="selected" />
        <AccountPage v-else :key="selected" :section="selected" />
      </Transition>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-shell { height: 100%; min-height: 0; display: grid; grid-template-columns: 228px minmax(0, 1fr); background: var(--bg); }
.settings-sidebar { padding: 26px 14px; border-right: 1px solid var(--line); background: var(--card); overflow: auto; }
.settings-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 9px 20px; }
.settings-heading h1 { font-size: 21px; margin: 0; letter-spacing: -.4px; }
.settings-heading > span { font-size: 11px; color: var(--fg2); }
.settings-search { display: flex; gap: 7px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; background: var(--card2); color: var(--fg2); }
.settings-search:focus-within { border-color: var(--acc); }
.settings-search input { padding: 10px 0; background: none; box-shadow: none; border: 0; min-width: 0; width: 100%; font-size: 12px; }
.settings-search button { padding: 0 3px; border: 0; }
.settings-group { color: var(--fg2); font-size: 11px; margin: 22px 10px 9px; }
.settings-nav-item { display: flex; align-items: center; gap: 11px; width: 100%; border: 0; border-radius: 9px; background: transparent; color: var(--fg); padding: 11px 12px; margin: 2px 0; text-align: left; font-size: 13px; transition: background .18s, transform .18s; }
.settings-nav-item:hover { background: var(--card2); }
.settings-nav-item:active { transform: scale(.98); }
.settings-nav-item.on { background: var(--acc-soft); color: var(--acc); font-weight: 600; }
.settings-content { min-width: 0; min-height: 0; overflow: hidden; }
.settings-page, .settings-page > :deep(.k-layout) { height: 100%; min-height: 0; }
.settings-content :deep(.k-header) { padding: 27px 30px 20px; }
.settings-content :deep(.k-body) { padding: 8px 30px 28px; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.settings-content :deep(.k-header) { flex-shrink: 0; }
.settings-content :deep(.k-body > *) { flex-shrink: 0; }
.settings-results { height: 100%; overflow: auto; padding: 30px; }
.settings-results h2 { font-size: 20px; margin: 0 0 8px; }
.settings-results h2 span { font-size: 12px; color: var(--fg2); margin-left: 8px; }
.settings-result { display: flex; align-items: center; gap: 14px; width: 100%; padding: 18px; text-align: left; margin: 12px 0; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 14px; transition: border-color .18s, transform .18s; }
.settings-result:hover { border-color: var(--acc); transform: translateX(3px); }
.settings-result > span { flex: 1; display: grid; gap: 5px; }
.settings-result small, .settings-result span > span { font-size: 12px; color: var(--fg2); }
.settings-result strong { font-size: 14px; }
.settings-no-results { color: var(--fg2); padding: 40px 0; }
.settings-content :deep(.settings-target) { animation: setting-glow 2s ease-out; outline: none; }
@keyframes setting-glow { from { box-shadow: 0 0 0 2px var(--acc); } to { box-shadow: 0 0 0 2px transparent; } }
@media(max-width: 760px) {
  .settings-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .settings-sidebar { padding: 12px; border-right: 0; border-bottom: 1px solid var(--line); overflow: hidden; }
  .settings-heading { padding: 0 4px 10px; }
  .settings-heading h1 { font-size: 17px; }
  .settings-nav { display: flex; overflow-x: auto; gap: 4px; padding-top: 8px; }
  .settings-group { display: none; }
  .settings-nav-item { width: auto; white-space: nowrap; padding: 9px 11px; }
  .settings-content :deep(.k-header) { padding: 18px 16px 12px; }
  .settings-content :deep(.k-body), .settings-results { padding: 12px 16px; }
}
@media(prefers-reduced-motion: reduce) { *, :deep(*) { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
</style>
