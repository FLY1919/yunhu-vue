/** Polling must preserve unchanged reactive bodies, parsed elements and media decoders. */
export function samePollMessage(incoming: any, current: any): boolean {
  if (!current || current.pending || current.recalled || current.recallTs) return false
  for (const key of Object.keys(incoming)) {
    if (key === 'right' || key === 'pending') continue
    const value = incoming[key], old = current[key]
    if (value === old) continue
    if ((key === 'recalled' || key === 'edited') && !value && !old) continue
    if (value && old && typeof value === 'object' && typeof old === 'object') {
      try { if (JSON.stringify(value) === JSON.stringify(old)) continue } catch { return false }
    }
    return false
  }
  return true
}
