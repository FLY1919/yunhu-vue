export function wheelZoomFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) {
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1)
  return Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.00125)
}
