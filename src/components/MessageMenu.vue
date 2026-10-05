<script setup lang="ts">
/**
 * 消息操作菜单（右键 / 点 ⋯ 都走这里）。
 *
 * 条目来自 chat.menu('message', ...) 的插件注册，本组件只负责渲染 + 定位。
 * 定位策略：优先弹在**消息上方**，上面放不下就翻到下方，左右都夹回视口内
 * （之前直接用 left = 锚点.left - 140，窄屏会把菜单顶出屏幕）。
 */
import { ref, onMounted, nextTick } from 'vue'

/**
 * 菜单定位：优先弹在锚点**上方**，空间不够就翻到下方，
 * 并且左右都夹回视口内 —— 之前直接 left = 锚点.left - 140，
 * 窄屏/靠左的消息会把菜单顶出屏幕外面。
 */
const props = defineProps<{
  items: any[]; x: number; y: number
  anchor?: { left: number; top: number; right: number; bottom: number } | null
}>()
const emit = defineEmits<{ (e: 'pick', item: any): void; (e: 'close'): void }>()

const box = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({ left: props.x + 'px', top: props.y + 'px', visibility: 'hidden' })

const M = 8   // 距屏幕边缘最小间距

function place() {
  const el = box.value
  if (!el) return
  const w = el.offsetWidth, h = el.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  let left: number, top: number

  if (props.anchor) {
    const a = props.anchor
    // 水平：跟锚点右对齐（也就是消息气泡右边），再夹回视口
    left = Math.min(a.right - w, vw - w - M)
    left = Math.max(M, left)
    // 垂直：优先在消息**上方**
    top = a.top - h - 6
    if (top < M) top = Math.min(a.bottom + 6, vh - h - M)   // 上方放不下 → 放下方
  } else {
    left = Math.min(props.x, vw - w - M)
    left = Math.max(M, left)
    top = Math.min(props.y, vh - h - M)
    top = Math.max(M, top)
  }
  style.value = { left: left + 'px', top: Math.max(M, top) + 'px', visibility: 'visible' }
}

onMounted(async () => { await nextTick(); place() })
</script>

<template>
  <div class="mm-mask" @click="emit('close')" @contextmenu.prevent="emit('close')"></div>
  <div ref="box" class="mm" :style="style">
    <button v-for="it in items" :key="it.id"
            class="mm-item" :class="{ danger: it.danger }"
            @click="emit('pick', it)">
      <span class="mm-label">{{ it.label }}</span>
      <span v-if="it.danger" class="mm-flag">不可恢复</span>
    </button>
    <div v-if="!items.length" class="mm-item dim">没有可用操作</div>
  </div>
</template>

<style scoped>
.mm-mask { position: fixed; inset: 0; z-index: 118; }
.mm {
  position: fixed; z-index: 119; min-width: 158px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow); padding: 5px; animation: mm-in .12s ease-out;
}
@keyframes mm-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.mm-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; background: transparent; color: var(--fg); font-weight: 400;
  padding: 7px 12px; border-radius: 7px; text-align: left; font-size: 13.5px;
}
.mm-item:hover { background: var(--card2); }
.mm-item.danger { color: var(--err); }
.mm-item.danger:hover { background: color-mix(in srgb, var(--err) 14%, transparent); }
.mm-flag { font-size: 10px; opacity: .6; }
</style>
