export interface AutoLockPreferences { minimize: boolean; blurMinutes: number; startup?: boolean; captureProtection?: boolean }
/** Keep the original blur deadline: repeated blur/visibility events cannot postpone locking. */
export function createAutoLock(read: () => AutoLockPreferences, lock: () => void, clock = {
  now: () => Date.now(), set: (fn: () => void, ms: number): any => setTimeout(fn, ms), clear: (id: any) => clearTimeout(id),
}) {
  let blurredAt: number | null = null, timer: any
  const cancel = () => { clock.clear(timer); timer = undefined }
  function expired() {
    return blurredAt !== null && read().blurMinutes > 0 && clock.now() - blurredAt >= read().blurMinutes * 60000
  }
  function arm() {
    cancel()
    if (blurredAt === null || read().blurMinutes <= 0) return
    const remaining = read().blurMinutes * 60000 - (clock.now() - blurredAt)
    if (remaining <= 0) { lock(); return }
    timer = clock.set(() => { if (expired()) lock(); else arm() }, remaining)
  }
  return {
    blur() { if (blurredAt === null) blurredAt = clock.now(); arm() },
    focus() { if (expired()) lock(); blurredAt = null; cancel() },
    minimize(value: boolean) { if (value) { if (read().minimize) lock(); if (blurredAt === null) blurredAt = clock.now(); arm() } },
    configure: arm,
    stop() { blurredAt = null; cancel() },
  }
}
