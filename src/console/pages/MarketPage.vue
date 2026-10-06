<script setup lang="ts">
/**
 * 插件市场页（由 market 插件注册）
 * 支持：从 URL 安装 / 粘贴代码安装 / 启用禁用 / 卸载
 * 手机与电脑端通用（操作按钮组在窄屏可横向滑动）
 */
import { inject, ref, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'

const ctx = inject<any>('ctx')
const mk = ctx.market
const ui = ctx.ui

const mode = ref<'url' | 'code'>('url')
const name = ref('')
const url = ref('')
const code = ref('')
const busy = computed(() => mk.state.loading)

const list = computed(() => mk.state.installed)

/** 示例插件：帮用户理解格式（装上就能在主题页底部看到一句话） */
const SAMPLE = `export const name = 'hello-slot'
export function apply(ctx) {
  ctx.inject(['console'], (c) => {
    c.console.slot({
      type: 'theme-bottom',
      order: 100,
      // 注意：运行时插件没有 Vue 编译器，必须用渲染函数 h()，不能用 template 字符串
      component: {
        render() {
          return ctx.h('p', { style: 'padding:8px 12px;color:var(--fg2)' }, '这是用户插件通过 theme-bottom 插槽注入的内容')
        },
      },
    })
  })
  ctx.logger?.info('hello-slot 插件已加载')
}`

function fillSample() {
  mode.value = 'code'
  name.value = 'hello-slot'
  code.value = SAMPLE
}

async function doInstall() {
  if (!name.value.trim()) { ui.toast('请填插件名', 'warn'); return }
  if (mode.value === 'url' && !url.value.trim()) { ui.toast('请填 URL', 'warn'); return }
  if (mode.value === 'code' && !code.value.trim()) { ui.toast('请填代码', 'warn'); return }
  await mk.install({
    name: name.value.trim(),
    url: mode.value === 'url' ? url.value.trim() : undefined,
    code: mode.value === 'code' ? code.value : undefined,
  })
  if (!mk.state.error) { name.value = ''; url.value = ''; code.value = '' }
}
</script>

<template>
  <KLayout ns="market" title="插件市场" desc="自己安装插件 · 支持 URL 或粘贴代码（万物皆插件）">
    <template #actions>
      <span class="pill">已装 {{ list.length }}</span>
    </template>

    <KCard title="安装插件">
      <div class="acts">
        <button class="ghost small" :class="{ on: mode === 'url' }" @click="mode = 'url'">从 URL 安装</button>
        <button class="ghost small" :class="{ on: mode === 'code' }" @click="mode = 'code'">粘贴代码</button>
        <button class="ghost small" @click="fillSample">填入示例插件</button>
      </div>

      <div class="form">
        <input v-model="name" placeholder="插件名（如 my-plugin）" />
        <input v-if="mode === 'url'" v-model="url" placeholder="https://.../plugin.js" />
        <textarea v-else v-model="code" rows="8" placeholder="export function apply(ctx) { ... }" />
        <div class="acts">
          <button class="small" :disabled="busy" @click="doInstall">
            {{ busy ? '安装中…' : '安装并启用' }}
          </button>
        </div>
      </div>

      <p v-if="mk.state.error" class="err">{{ mk.state.error }}</p>
      <p class="dim small">
        URL 需是<strong>可直接访问的 .js 直链</strong>（GitHub raw / jsDelivr 等）。
        插件格式：<code>export function apply(ctx) { ... }</code>，可选 <code>export const name</code>。
        ⚠️ 第三方插件能读到你的登录 token，只装信任的来源。
      </p>
    </KCard>

    <KCard title="已安装" class="mt">
      <div v-for="p in list" :key="p.id" class="item">
        <div class="imain">
          <div class="iname">
            {{ p.name }}
            <em :class="p.enabled ? 'on' : 'off'">{{ p.enabled ? '已启用' : '已禁用' }}</em>
          </div>
          <div class="dim small">{{ p.source === 'url' ? p.url : '本地代码' }} · {{ new Date(p.installedAt).toLocaleString() }}</div>
        </div>
        <div class="acts">
          <button class="ghost small" @click="mk.toggle(p.id)">{{ p.enabled ? '禁用' : '启用' }}</button>
          <button class="ghost small danger" @click="mk.uninstall(p.id)">卸载</button>
        </div>
      </div>
      <p v-if="!list.length" class="dim center">还没有安装任何插件，试试上面的「填入示例插件」</p>
    </KCard>
  </KLayout>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.form input, .form textarea { width: 100%; font-size: 13px; }
.acts { display: flex; gap: 6px; flex: 1 0 100%; margin-top: 4px;
        overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.acts::-webkit-scrollbar { display: none; }
.acts > * { flex: 0 0 auto; }
.item { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--line); flex-wrap: wrap; }
.imain { flex: 1 1 60%; min-width: 0; }
.iname { font-size: 13.5px; font-weight: 500; display: flex; gap: 6px; align-items: center; }
.iname em { font-style: normal; font-size: 10.5px; padding: 0 6px; border-radius: 4px; }
.iname em.on { background: var(--acc-soft); color: var(--acc); }
.iname em.off { background: var(--card2); color: var(--fg2); }
.err { color: var(--err); font-size: 12.5px; margin-top: 6px; }
.ghost.on, .small.on { background: var(--acc); color: #fff; border-color: transparent; }
.center { text-align: center; padding: 16px 0; }
.mt { margin-top: 12px; }
/* 手机端：按钮组换行占满一行，可横向滑 */
@media (max-width: 760px) {
  .item { flex-wrap: wrap; }
  .imain { flex: 1 1 100%; }
}
</style>
