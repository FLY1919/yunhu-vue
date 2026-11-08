<script setup lang="ts">
/**
 * MorePanel —— 「更多功能」宫格面板（仿 QQ 截图 3）
 * 交互（QQ 式，无隐藏手势）：
 *   · 普通态：点卡片 = 打开该功能页
 *   · 点右上「管理」→ 进入编辑态：卡片抖动 + 显示常驻角标，
 *     点卡片 = 切换「常驻菜单 / 收拢宫格」，再点「完成」退出编辑态
 * 两区：已添加（常驻 ☰/rail 的插件页）/ 未添加（宫格内）。
 */
import { inject, ref } from 'vue'
import Icon from './components/Icon.vue'

const props = defineProps<{ pages: any[]; pinned: any[] }>()
const emit = defineEmits<{
  (e: 'go', path: string): void
  (e: 'pin', path: string): void
  (e: 'close'): void
}>()

const ctx = inject<any>('ctx')

/** 编辑态：点「管理」进入，卡片可点选切换常驻 */
const managing = ref(false)

function cellClick(p: any) {
  if (managing.value) { emit('pin', p.path); return }
  emit('go', p.path)
}
</script>

<template>
  <div class="mp-mask" @click.self="emit('close')">
    <div class="mp-box">
      <div class="mp-head">
        <span class="mp-title">更多功能</span>
        <button class="mp-manage" :class="{ on: managing }" @click="managing = !managing">
          <Icon name="settings" :size="14" /> {{ managing ? '完成' : '管理' }}
        </button>
        <button class="mp-x" title="关闭" @click="emit('close')">×</button>
      </div>
      <div v-if="managing" class="mp-hint">编辑态：点卡片切换「常驻左侧菜单 / 收进宫格」，完成后点「完成」</div>

      <div v-if="pinned.length" class="mp-sec">已添加（常驻菜单）</div>
      <div v-if="pinned.length" class="mp-grid" :class="{ editing: managing }">
        <button v-for="p in pinned" :key="p.path" class="mp-cell on" @click="cellClick(p)">
          <Icon :name="p.icon || 'page'" :size="22" />
          <span>{{ p.name }}</span>
          <em v-if="managing" class="mp-tag">常驻中 · 点击收拢</em>
        </button>
      </div>

      <div class="mp-sec">{{ managing ? '未添加（点击设为常驻）' : '未添加（点击打开）' }}</div>
      <div class="mp-grid" :class="{ editing: managing }">
        <button v-for="p in pages" :key="p.path" class="mp-cell" @click="cellClick(p)">
          <Icon :name="p.icon || 'page'" :size="22" />
          <span>{{ p.name }}</span>
          <em v-if="managing" class="mp-tag add">点击常驻</em>
        </button>
        <div v-if="!pages.length" class="mp-empty">全部功能都已常驻菜单</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-mask {
  position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, .45);
  display: grid; place-items: center; backdrop-filter: blur(4px);
}
.mp-box {
  width: min(560px, 92vw); max-height: 80vh; overflow: auto;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .45); padding: 18px 20px 22px;
}
.mp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mp-title { font-size: 17px; font-weight: 600; flex: 1; }
.mp-manage {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;
  color: var(--fg2); background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 7px;
}
.mp-manage:hover { background: var(--card2); color: var(--fg); }
.mp-manage.on { background: var(--acc); color: #fff; }
.mp-x {
  width: 26px; height: 26px; border-radius: 7px; border: none; background: none;
  color: var(--fg2); font-size: 17px; line-height: 1; cursor: pointer;
}
.mp-x:hover { background: var(--card2); color: var(--fg); }
.mp-hint {
  font-size: 12px; color: var(--acc); background: var(--acc-soft, var(--card2));
  border-radius: 8px; padding: 6px 10px; margin-bottom: 10px;
}
.mp-sec { font-size: 12px; color: var(--fg2); margin: 10px 0 8px; }
.mp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.mp-cell {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 6px 12px; border-radius: 10px; border: none; cursor: pointer;
  background: var(--card2); color: var(--fg); font-size: 12px;
}
.mp-cell:hover { background: var(--acc-soft, var(--card)); outline: 1px solid var(--line); }
.mp-cell.on { outline: 1px solid var(--acc); background: var(--acc-soft, var(--card2)); }
/* 编辑态：卡片轻微抖动（QQ 管理态观感）+ 虚线描边 */
.mp-grid.editing .mp-cell { outline: 1.5px dashed var(--line); animation: mp-wiggle 1.2s ease-in-out infinite; }
.mp-grid.editing .mp-cell.on { outline-color: var(--acc); }
@keyframes mp-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-.6deg); }
  75% { transform: rotate(.6deg); }
}
.mp-tag {
  position: absolute; top: 4px; right: 4px; font-style: normal; font-size: 9.5px;
  color: var(--acc); background: var(--card); padding: 1px 5px; border-radius: 6px;
  border: 1px solid var(--line);
}
.mp-tag.add { color: var(--fg2); }
.mp-empty { grid-column: 1 / -1; text-align: center; color: var(--fg2); font-size: 12.5px; padding: 20px 0; }
@media (max-width: 560px) { .mp-grid { grid-template-columns: repeat(3, 1fr); } }
</style>
