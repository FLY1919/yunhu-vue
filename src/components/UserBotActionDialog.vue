<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
const ctx = inject<any>('ctx'), ub = ctx.userbot
const review = computed(() => ub.state.review)
const dialog = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null
watch(() => review.value?.id, async (id, old) => {
  if (id) {
    if (!old) previous = document.activeElement as HTMLElement
    await nextTick(); dialog.value?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
  } else { previous?.isConnected && previous.focus(); previous = null }
})
function answer(ok: boolean) { if (review.value) ub.resolveReview(review.value.id, ok) }
function onKey(e: KeyboardEvent) {
  if (!review.value) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); answer(false) }
  if (e.key === 'Tab') {
    const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons?.length) return
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
}
document.addEventListener('keydown', onKey, true)
onUnmounted(() => { document.removeEventListener('keydown', onKey, true); previous?.isConnected && previous.focus() })
</script>

<template>
  <Teleport to="body">
    <Transition name="bot-review">
      <div v-if="review" class="bot-review-mask" @click.self="answer(false)">
        <section ref="dialog" class="bot-review-box" role="dialog" aria-modal="true" aria-label="确认 AI 群管理操作">
          <header><div><h2>确认 AI 群管理操作</h2><p>{{ review.botName }} · {{ review.groupName }}（{{ review.groupId }}）</p></div><button aria-label="取消群管理操作" @click="answer(false)">×</button></header>
          <p class="bot-review-hint">以下操作尚未执行，请核对目标与修改内容。</p>
          <div class="bot-review-items"><article v-for="(item, i) in review.items" :key="i"><strong>{{ Number(i) + 1 }}. {{ item.title }}</strong><p v-for="(line, n) in item.details" :key="n">{{ line }}</p><p class="reason">AI 理由：{{ item.action.reason }}</p></article></div>
          <footer><small>执行前会重新检查群权限。{{ ub.state.reviewCount > 1 ? `另有 ${ub.state.reviewCount - 1} 项审核排队` : '' }}</small><div><button data-cancel @click="answer(false)">取消本次</button><button class="execute" @click="answer(true)">确认执行 {{ review.items.length }} 项操作</button></div></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bot-review-mask{position:fixed;inset:0;z-index:155;background:#0007;backdrop-filter:blur(4px);display:grid;place-items:center;padding:18px}.bot-review-box{box-sizing:border-box;width:min(610px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 60px #0005;padding:22px;gap:14px}.bot-review-box header{display:flex;align-items:start;justify-content:space-between;gap:12px}.bot-review-box h2{margin:0;font-size:18px}.bot-review-box p{margin:7px 0 0;line-height:1.6;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.bot-review-box header p,.bot-review-hint,.reason,.bot-review-box small{color:var(--fg2)}.bot-review-items{min-height:0;overflow:auto;display:grid;gap:10px}.bot-review-items article{padding:14px;border:1px solid var(--line);border-radius:11px;background:var(--card2)}.bot-review-items strong{font-size:14px}.bot-review-box footer{display:grid;gap:12px}.bot-review-box footer>div{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.bot-review-box button{border:1px solid var(--line);border-radius:9px;padding:9px 13px;background:var(--card2);color:var(--fg);cursor:pointer;font:inherit;font-size:13px}.bot-review-box header button{font-size:20px;padding:1px 8px}.bot-review-box button.execute{background:var(--acc);color:white;border-color:var(--acc)}.bot-review-box button:focus-visible{outline:2px solid var(--acc);outline-offset:3px}.bot-review-enter-active,.bot-review-leave-active{transition:opacity 180ms ease}.bot-review-enter-active .bot-review-box,.bot-review-leave-active .bot-review-box{transition:transform 180ms ease}.bot-review-enter-from,.bot-review-leave-to{opacity:0}.bot-review-enter-from .bot-review-box,.bot-review-leave-to .bot-review-box{transform:translateY(10px)}@media(prefers-reduced-motion:reduce){.bot-review-enter-active,.bot-review-leave-active,.bot-review-enter-active .bot-review-box,.bot-review-leave-active .bot-review-box{transition:none}}
</style>
