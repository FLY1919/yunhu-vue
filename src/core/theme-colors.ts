const rgb = (hex: string) => {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((x) => x + x).join('') : value
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
export const isHexColor = (value: string) => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value || '')
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => rgb(hex).map((v) => {
    const n = v / 255
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function contrastText(background: string) {
  return contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000'
}
export function readableColor(color: string, backgrounds: string[], minimum = 4.5) {
  const score = (candidate: string) => Math.min(...backgrounds.map((bg) => contrast(candidate, bg)))
  if (score(color) >= minimum) return color
  const end = score('#ffffff') > score('#111111') ? '#ffffff' : '#111111'
  const from = rgb(color), to = rgb(end)
  for (let step = 1; step <= 100; step++) {
    const candidate = '#' + from.map((v, i) => Math.round(v + (to[i] - v) * step / 100).toString(16).padStart(2, '0')).join('')
    if (score(candidate) >= minimum) return candidate
  }
  return end
}

export function themePalette(preset: any, mode: 'dark' | 'light', customAccent = '') {
  const dark = mode === 'dark'
  const base = dark
    ? { bg: '#141218', rail: '#1d1b20', card: '#211f26', card2: '#2c2933', fg: '#f0edf7', fg2: '#c2bdca', line: '#56515f' }
    : { bg: '#f5f3f9', rail: '#ffffff', card: '#ffffff', card2: '#eeebf3', fg: '#211d29', fg2: '#575160', line: '#bab4c4' }
  const matching = preset.mode === mode
  const values = { ...base }
  // 切换模式时移除不匹配预设的深色/浅色背景，避免两套插件各改一半。
  for (const name of ['bg', 'rail', 'card', 'fg', 'fg2']) {
    if (matching && isHexColor(preset[name])) values[name] = preset[name]
  }
  if (matching && isHexColor(preset.border)) values.line = preset.border
  const surfaces = [values.bg, values.rail, values.card, values.card2]
  values.fg = readableColor(values.fg, surfaces, 7)
  values.fg2 = readableColor(values.fg2, surfaces)
  const selectedAccent = isHexColor(customAccent) ? customAccent
    : preset.id === 'kobe' ? (dark ? '#d0bcff' : '#6750a4') : preset.accent
  const accent = isHexColor(selectedAccent) ? selectedAccent : (dark ? '#d0bcff' : '#6750a4')
  return { ...values, accent, onAccent: contrastText(accent), link: readableColor(accent, surfaces), matching }
}
