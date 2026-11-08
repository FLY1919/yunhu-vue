<script lang="ts">
// Share a single observer across the tag strips in the message history.
const widthHandlers = new WeakMap<Element, (width: number) => void>()
let widthObserver: ResizeObserver | undefined

function observeWidth(element: Element, update: (width: number) => void) {
  if (typeof ResizeObserver !== 'function') return
  widthObserver ??= new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) widthHandlers.get(target)?.(contentRect.width)
  })
  widthHandlers.set(element, update)
  widthObserver.observe(element)
  return () => {
    widthHandlers.delete(element)
    widthObserver?.unobserve(element)
  }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import Icon from '../console/components/Icon.vue'
import { groupTagStyle } from '../core/group-tag'

const props = defineProps<{
  tags: { id: string | number; tag: string; color?: string }[]
  right?: boolean
}>()
const emit = defineEmits<{ expanded: [active: boolean] }>()

const panelId = useId()
const preview = ref<HTMLElement>()
const width = ref(0)
const expanded = ref(false)
const labels = computed(() => props.tags.map(tag => tag.tag))
const measurement = shallowRef<{ labels: string[]; widths: number[]; gap: number; button: number }>()
const measuring = computed(() => measurement.value?.labels !== labels.value)
const countSample = computed(() => '+' + '0'.repeat(String(props.tags.length).length))

watch(preview, (element, _, onCleanup) => {
  if (!element) return
  const stop = observeWidth(element, value => { width.value = value })
  if (stop) onCleanup(stop)
}, { flush: 'post' })

// Measure natural chip widths with their actual fonts and padding. Keep only the
// visible prefix mounted after this pass, and reuse the widths when the pane resizes.
watch([preview, labels], ([element, texts]) => {
  if (!element) return
  const children = Array.from(element.children)
  const button = children.pop()
  if (!button) return
  width.value = element.getBoundingClientRect().width
  measurement.value = {
    labels: texts,
    widths: children.map(chip => chip.getBoundingClientRect().width),
    gap: parseFloat(getComputedStyle(element).columnGap),
    button: button.getBoundingClientRect().width,
  }
}, { flush: 'post' })

const visibleCount = computed(() => {
  if (!measurement.value || measuring.value) return 0
  const { widths, gap, button } = measurement.value
  let used = 0
  let withButton = 0
  for (const [index, chipWidth] of widths.entries()) {
    used += chipWidth + (index ? gap : 0)
    if (used > width.value) return withButton
    if (used + gap + button <= width.value) withButton = index + 1
  }
  return widths.length
})
const hiddenCount = computed(() => props.tags.length - visibleCount.value)
const open = computed(() => expanded.value && hiddenCount.value > 0)
const previewTags = computed(() => measuring.value ? props.tags : props.tags.slice(0, visibleCount.value))
const toggleLabel = computed(() => open.value ? '收起群标签' : `展开剩余 ${hiddenCount.value} 个群标签`)

watch(open, active => emit('expanded', active))
onBeforeUnmount(() => { if (open.value) emit('expanded', false) })
</script>

<template>
  <div class="mtags" :class="{ right }">
    <div ref="preview" class="tag-preview" :class="{ measuring }" :aria-hidden="measuring || undefined">
      <span v-for="t in previewTags" :key="t.id" class="mtag" :title="t.tag"
            :style="groupTagStyle(t.color)" dir="auto">{{ t.tag }}</span>
      <button v-if="hiddenCount" type="button" class="tag-toggle"
              :style="measuring ? undefined : { minInlineSize: measurement?.button + 'px' }"
              :aria-expanded="open" :aria-controls="panelId" :aria-label="toggleLabel" :title="toggleLabel"
              @click.stop="expanded = !expanded">
        {{ measuring ? countSample : '+' + hiddenCount }}
        <Icon name="chevronDown" :size="12" aria-hidden="true" />
      </button>
    </div>
    <div :id="panelId" :aria-hidden="!open">
      <Transition name="tag-reveal">
        <div v-if="open" class="tag-reveal">
          <div class="tag-reveal-inner">
            <div class="tag-grid">
              <span v-for="t in tags.slice(visibleCount)" :key="t.id" class="mtag" :title="t.tag"
                    :style="groupTagStyle(t.color)" dir="auto">{{ t.tag }}</span>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.mtags { align-self: stretch; min-width: 0; margin-bottom: 3px; }
.tag-preview, .tag-grid { display: flex; gap: 4px; }
.tag-preview { align-items: center; }
.tag-preview.measuring { visibility: hidden; overflow: clip; }
.right .tag-preview, .right .tag-grid { flex-direction: row-reverse; }
.mtag {
  min-width: 0; font-size: 10.5px; border-radius: 5px; padding: 2px 6px; line-height: 1.4;
}
.tag-preview .mtag { flex: none; white-space: nowrap; }
.tag-toggle {
  display: inline-flex; align-items: center; justify-content: center; gap: 2px; flex: none; min-height: 21px;
  padding: 1px 5px; border: 1px solid var(--line2); border-radius: 6px;
  background: var(--card2); color: var(--fg); white-space: nowrap; font-size: 10.5px; line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
.tag-toggle:hover, .tag-toggle[aria-expanded='true'] { background: var(--card); border-color: var(--acc); }
.tag-toggle:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
.tag-toggle svg { transition: transform .2s ease; }
.tag-toggle[aria-expanded='true'] svg { transform: rotate(180deg); }
.tag-reveal { display: grid; grid-template-rows: 1fr; }
.tag-reveal-inner { min-height: 0; overflow: hidden; }
.tag-grid { flex-wrap: wrap; align-items: flex-start; padding-top: 4px; }
.tag-grid .mtag { max-width: 100%; overflow-wrap: anywhere; }
.tag-reveal-enter-active, .tag-reveal-leave-active { transition: grid-template-rows .2s ease, opacity .2s ease; }
.tag-reveal-enter-from, .tag-reveal-leave-to { grid-template-rows: 0fr; opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .tag-toggle svg, .tag-reveal-enter-active, .tag-reveal-leave-active { transition: none; }
}
</style>
