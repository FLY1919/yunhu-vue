export const markdownFontSizeKey = 'yh.editor.markdown-font-size'
export const minMarkdownFontSize = 10
export const maxMarkdownFontSize = 40

export function parseMarkdownFontSize(value: unknown) {
  const size = Number(value)
  return Number.isInteger(size) && size >= minMarkdownFontSize && size <= maxMarkdownFontSize ? size : 15
}
