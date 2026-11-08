import { hasRecallBody } from './recall-cache.ts'

export function showRetainedRecall(message: any, enabled: boolean): boolean {
  const cachedAt = Number(message?.cachedAt)
  return !!(enabled && message?.recalled && message?.retainedRecall && Number.isFinite(cachedAt) &&
    cachedAt > Date.now() - 7 * 86400000 && hasRecallBody(message))
}

/** When retention is enabled, hide an unmatched recall instead of presenting it as a saved message. */
export function showMessage(message: any, enabled: boolean): boolean {
  return !(enabled && message?.recalled && !showRetainedRecall(message, enabled))
}
