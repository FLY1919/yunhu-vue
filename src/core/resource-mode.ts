import { reactive, watch } from 'vue'
let saved: string | null = null
try { saved = globalThis.localStorage?.getItem('yh.performance.economy') } catch {}
export const resourceMode = reactive({ economy: saved !== 'false' })
export function setResourceMode(value: boolean) {
  resourceMode.economy = value
  try { globalThis.localStorage?.setItem('yh.performance.economy', String(value)) } catch {}
}
function apply() {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.dataset.economy = String(resourceMode.economy)
}
watch(() => resourceMode.economy, apply, { immediate: true })
