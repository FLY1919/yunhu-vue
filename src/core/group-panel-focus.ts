import { nextTick, onUnmounted, watch, type Ref } from 'vue'

/** Local dialog focus ownership. A nested dialog keeps its own keyboard input. */
export function useGroupPanelFocus(root: Ref<HTMLElement | null>, visible: () => boolean, close: () => void, modal = true) {
  let previous: HTMLElement | null = null
  const stop = watch(visible, async open => {
    if (open) {
      previous = document.activeElement as HTMLElement
      await nextTick()
      if (visible()) root.value?.focus({ preventScroll:true })
    } else if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || root.value?.contains(document.activeElement))) {
      previous.focus({ preventScroll:true }); previous = null
    }
  })
  function keydown(event: KeyboardEvent) {
    const dialog = root.value
    if (!visible() || !dialog || !dialog.contains(document.activeElement)) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
    if (!modal || event.key !== 'Tab') return
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')]
      .filter(el => el.getClientRects().length && !el.closest('[inert]'))
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) { event.preventDefault(); return }
    if (document.activeElement === dialog || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus()
    }
  }
  document.addEventListener('keydown',keydown,true)
  onUnmounted(() => { stop(); document.removeEventListener('keydown',keydown,true) })
}
