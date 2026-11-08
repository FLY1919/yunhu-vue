<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Icon from '../console/components/Icon.vue'

type Value = string | number
const props = defineProps<{
  modelValue: Value
  options: readonly { value: Value; label: string; disabled?: boolean }[]
  label: string
  placeholder?: string
  disabled?: boolean
  custom?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const popup = ref<HTMLElement>()
const customInput = ref<HTMLInputElement>()
const open = ref(false)
const portal = ref<HTMLElement | string>('body')
const customValue = ref('')
const position = ref<Record<string, string>>({})
const options = computed(() => props.custom && props.modelValue && !props.options.some(o => o.value === props.modelValue)
  ? [{ label: String(props.modelValue), value: props.modelValue }, ...props.options]
  : props.options)
const selected = computed(() => options.value.find(o => o.value === props.modelValue)?.label || props.placeholder || '')

function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect || !rect.width || rect.bottom < 0 || rect.top > window.innerHeight) { close(); return }
  const width = Math.min(window.innerWidth - 16, Math.max(rect.width, props.custom ? 232 : 134))
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const upward = below < 250 && above > below
  position.value = {
    width: width + 'px',
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px',
    maxHeight: Math.max(60, Math.min(330, upward ? above : below)) + 'px',
    ...(upward ? { bottom: window.innerHeight - rect.top + 4 + 'px' } : { top: rect.bottom + 4 + 'px' }),
  }
}
function buttons() { return [...(popup.value?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])] }
function outside(event: PointerEvent) {
  const target = event.target as Node
  if (!popup.value?.contains(target) && !trigger.value?.contains(target)) close()
}
function close(restore = false) {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
  if (restore) trigger.value?.focus({ preventScroll: true })
}
async function show(last = false) {
  if (props.disabled || open.value) return
  portal.value = trigger.value?.closest<HTMLElement>('dialog[open]') || 'body'
  open.value = true
  customValue.value = ''
  place()
  if (!open.value) return
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  await nextTick()
  const items = buttons()
  const active = items.find(button => button.getAttribute('aria-selected') === 'true')
  ;(active || (last ? items.at(-1) : items[0]) || customInput.value)?.focus()
}
function choose(value: Value) {
  close(true)
  emit('update:modelValue', value)
}
function move(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.target === customInput.value) return
  event.preventDefault()
  const items = buttons()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
  items[next]?.focus()
}
function focusOut(event: FocusEvent) {
  if (!popup.value?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.value) close()
}
watch(() => props.disabled, disabled => { if (disabled) close() })
onBeforeUnmount(() => close())
</script>

<template>
  <button ref="trigger" type="button" class="themed-select" :aria-label="label" aria-haspopup="listbox"
    :aria-expanded="open" :aria-controls="open ? id : undefined" :disabled="disabled"
    @click="open ? close(true) : show()" @keydown.down.prevent.stop="show()" @keydown.up.prevent.stop="show(true)"
    @keydown.esc="close(true)">
    <span>{{ selected }}</span><Icon name="down" :size="13" />
  </button>
  <Teleport :to="portal">
    <Transition name="select-menu">
      <div v-if="open" ref="popup" class="themed-select-menu" :style="position" @keydown="move" @focusout="focusOut">
        <div :id="id" role="listbox" :aria-label="label">
          <button v-for="option in options" :key="option.value" type="button" role="option"
            :aria-selected="option.value === modelValue" :disabled="option.disabled" @click="choose(option.value)">
            <span>{{ option.label }}</span><Icon v-if="option.value === modelValue" name="check" :size="14" />
          </button>
        </div>
        <form v-if="custom" class="select-custom" @submit.prevent="choose(customValue.trim())">
          <input ref="customInput" v-model="customValue" aria-label="自定义代码语言" placeholder="输入自定义语言"
            required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_+.#\-]{0,63}" />
          <button type="submit">使用</button>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
button.themed-select { display:inline-flex; align-items:center; justify-content:space-between; gap:6px; min-width:0;
  font:inherit; background:var(--card2); color:var(--fg); border:1px solid var(--line); padding:4px 8px;
  border-radius:7px; cursor:pointer; white-space:nowrap; }
.themed-select span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.themed-select svg { flex-shrink:0; }
.themed-select:hover:not(:disabled),.themed-select[aria-expanded=true] { background:var(--acc-soft); color:var(--fg); }
.themed-select:disabled { opacity:.5; cursor:default; }
.themed-select-menu { position:fixed; z-index:10000; box-sizing:border-box; overflow:auto; padding:4px;
  border:1px solid var(--line); border-radius:9px; background:var(--card); color:var(--fg);
  box-shadow:0 8px 24px #0004; font-size:13px; }
.themed-select-menu [role=option] { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;
  text-align:left; border:0; border-radius:5px; background:transparent; color:var(--fg); padding:7px 9px; font:inherit; }
.themed-select-menu [role=option]:is(:hover,:focus-visible,[aria-selected=true]) { background:var(--acc-soft); color:var(--fg); }
.themed-select-menu [role=option]:disabled { opacity:.5; cursor:default; }
.themed-select-menu :focus-visible,.themed-select:focus-visible { outline:2px solid var(--link,var(--acc)); outline-offset:-2px; }
.select-custom { display:flex; position:sticky; bottom:-4px; gap:4px; padding:6px 2px; border-top:1px solid var(--line); background:var(--card); }
.select-custom input { min-width:0; width:100%; padding:4px 6px; color:var(--fg); background:var(--card2); border:1px solid var(--line); border-radius:5px; }
.select-custom button { flex:none; padding:4px 7px; color:var(--fg); background:var(--card2); border:1px solid var(--line); border-radius:5px; }
.select-menu-enter-active,.select-menu-leave-active { transition:opacity .13s,transform .13s; }
.select-menu-enter-from,.select-menu-leave-to { opacity:0; transform:translateY(-3px); }
@media(prefers-reduced-motion:reduce) { .select-menu-enter-active,.select-menu-leave-active { transition:none; } }
</style>
