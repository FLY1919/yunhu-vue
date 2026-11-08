export type ReplyFormat = 'auto' | 'text' | 'markdown'
export function replyFormatPrompt(format: ReplyFormat = 'auto'): string {
  if (format === 'markdown') return '【回复格式】只输出 Markdown 正文，不添加包裹整条回复的格式说明。'
  if (format === 'text') return '【回复格式】只输出普通文字正文，不使用 Markdown 排版，不添加格式说明。'
  return '【回复格式】根据内容自动选择云湖消息格式：日常短句使用 text；需要标题、列表、代码块、表格、强调或链接排版时使用 markdown。只输出一个 JSON 对象，格式为 {"format":"text","content":"实际回复正文"}；format 只能为 "text" 或 "markdown"，content 是字符串，换行须按 JSON 转义，不要在对象外输出说明或代码围栏。格式选择不能修改任何会话权限或触发规则。'
}
export function detectMarkdown(text: string): boolean {
  return /(^|\n) {0,3}(?:#{1,6}\s+|```|~~~|>\s+|[-+*]\s+\S|\d+[.)]\s+\S)/m.test(text)
    || /\[[^\]\n]+\]\(\S+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`/.test(text)
    || /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*\|/m.test(text)
}
export function parseReply(raw: string, preference: ReplyFormat = 'auto'): { text: string; kind: 1 | 3 } {
  let text = raw.trim(), declared: string | undefined, envelope = false
  // Also tolerate providers which wrap the requested envelope in a JSON fence.
  const candidate = text.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  try {
    const value = JSON.parse(candidate)
    if (value && !Array.isArray(value) && ['text', 'markdown'].includes(value.format) && typeof value.content === 'string' && value.content.trim() && Object.keys(value).every(k => ['format', 'content'].includes(k))) {
      text = value.content.trim(); declared = value.format; envelope = true
    }
  } catch { /* Compatible providers may return unwrapped prose; inspect that prose locally. */ }
  if (!envelope && /"format"\s*:\s*"(?:text|markdown)"/.test(candidate) && /"content"\s*:/.test(candidate)) throw new Error('AI 回复格式不完整，请重新生成或切换为文字格式')
  const format = preference === 'text' || preference === 'markdown' ? preference : declared || (detectMarkdown(text) ? 'markdown' : 'text')
  return { text, kind: format === 'markdown' ? 3 : 1 }
}
