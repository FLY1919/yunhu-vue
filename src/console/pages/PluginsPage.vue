<script setup lang="ts">
/** 插件管理页（控制台内置页面） */
import { inject, ref, onMounted, onUnmounted, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import Icon from '../components/Icon.vue'

const ctx = inject('ctx')
const app = ctx.app
const ui = ctx.ui
const console_ = ctx.console

const items = ref([])
const services = ref([])

function refresh() {
  items.value = app.list()
  services.value = [...app.services.keys()]
}
let off
onMounted(() => { refresh(); off = app.watch(refresh) })
onUnmounted(() => off && off())

const stateText = s => ({ active: '运行中', pending: '等待依赖', disposed: '已卸载', unmounted: '未装载' }[s] || s)
const dotCls = s => (s === 'active' ? 'on' : s === 'pending' ? 'wait' : '')

function toggle(it) {
  if (it.core) return ui.toast('核心插件不可卸载', 'warn')
  const item = app.registry.find(r => r.key === it.key)
  if (it.state === 'active' || it.state === 'pending') {
    app.unmount(it.key)
    ui.toast(`已卸载插件 ${it.key}`, 'warn')
  } else {
    app.mount(item)
    ui.toast(`已装载插件 ${it.key}`, 'success')
  }
  refresh()
}

const pageCount = computed(() => console_.pages.length)
const entryCount = computed(() => console_.state.entries.length)
</script>

<template>
  <KLayout ns="plugins" title="插件" desc="控制台按已装载插件动态生成页面与导航">
    <template #actions>
      <span class="pill">{{ items.length }} 个插件</span>
      <span class="pill">{{ pageCount }} 个页面</span>
      <span class="pill">{{ services.length }} 个服务</span>
    </template>

    <KCard title="已注册的插件">
      <div class="plugin-list">
        <div v-for="it in items" :key="it.key" class="plugin-item">
          <span class="dot" :class="dotCls(it.state)"></span>
          <div class="pi-main">
            <div class="pi-name">
              {{ it.key }}
              <em v-if="it.core">核心</em>
            </div>
            <div class="pi-desc">
              {{ it.desc }}
              <span v-if="it.deps.length" class="dim">· 依赖 {{ it.deps.join(', ') }}</span>
            </div>
          </div>
          <span class="pi-state">{{ stateText(it.state) }}</span>
          <button class="ghost small" :disabled="it.core" @click="toggle(it)">
            {{ it.state === 'active' || it.state === 'pending' ? '卸载' : '装载' }}
          </button>
        </div>
      </div>
    </KCard>

    <KCard title="服务注册表" class="mt">
      <div class="services">
        <code v-for="s in services" :key="s" class="pill mono">{{ s }}</code>
        <span v-if="!services.length" class="dim">暂无服务</span>
      </div>
      <p class="dim small">
        卸载一个提供服务的插件，依赖它的插件会被级联卸载；重新装载后会按依赖顺序自动恢复。
      </p>
    </KCard>

    <KCard title="控制台扩展" class="mt">
      <p class="dim small">
        插件通过 <code>ctx.console.addEntry(clientEntry)</code> 注册客户端入口，
        在入口里用 <code>ctx.page()</code> / <code>ctx.slot()</code> 添加自己的页面和插槽。
      </p>
      <div class="services">
        <span class="pill">已注册入口 {{ entryCount }}</span>
        <span class="pill" v-for="p in console_.pages" :key="p.path">{{ p.icon }} {{ p.name }}</span>
      </div>
      <p class="dim small" v-if="!console_.pages.length">当前没有页面</p>
    </KCard>

    <KCard title="试试热插拔" class="mt">
      <p class="dim small">
        卸载 <b>quickreply</b>：左侧「快捷回复」导航项与其页面会立刻消失，输入区按钮条同时消失。
        重新装载即恢复 —— 这就是 Koishi 式插件化控制台。
      </p>
    </KCard>
  </KLayout>
</template>
