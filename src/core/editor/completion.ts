import { computed, ref, shallowRef } from 'vue'
import type { EditAction } from './core'

export const markdownSnippets: { id: EditAction; label: string; syntax: string; keywords?: string }[] = [
  { id: 'h1', label: '一级标题', syntax: '#', keywords: 'heading 标题' },
  { id: 'h2', label: '二级标题', syntax: '##', keywords: 'heading 标题' },
  { id: 'quote', label: '引用', syntax: '>', keywords: 'blockquote' },
  { id: 'bullet', label: '无序列表', syntax: '-', keywords: 'list' },
  { id: 'ordered', label: '有序列表', syntax: '1.', keywords: 'list' },
  { id: 'task', label: '任务列表', syntax: '- [ ]', keywords: 'todo' },
  { id: 'codeblock', label: '代码块', syntax: '```', keywords: 'code' },
  { id: 'table', label: '表格', syntax: '| … |' },
  { id: 'link', label: '链接', syntax: '[…](…)' },
  { id: 'mathblock', label: '公式块', syntax: '$$', keywords: 'latex 数学' },
  { id: 'rule', label: '分隔线', syntax: '---', keywords: 'horizontal' },
]
type CompletionRange = { from: number; to: number; query: string }

export function markdownCompletionRange(line: string, cursor: number, manual = false): CompletionRange | null {
  const command = /^\s*\/([\p{L}\p{N}_-]{0,24})$/u.exec(line)
  if (command) return { from: cursor - command[1].length - 1, to: cursor, query: command[1] }
  return manual ? { from: cursor, to: cursor, query: '' } : null
}

export function useMarkdownCompletion(apply: (id: EditAction, range: CompletionRange) => void) {
  const range = shallowRef<CompletionRange | null>(null)
  const selected = ref(0)
  const entries = computed(() => {
    if (!range.value) return []
    const query = range.value.query.toLowerCase()
    return markdownSnippets.filter(x => (x.id + ' ' + x.label + ' ' + (x.keywords || '')).includes(query))
  })
  function close() { range.value = null }
  function update(next: CompletionRange | null) {
    if (next?.from !== range.value?.from || next?.query !== range.value?.query) selected.value = 0
    range.value = next
  }
  function choose(index = selected.value) {
    const entry = entries.value[index], position = range.value
    close()
    if (entry && position) apply(entry.id, position)
  }
  function key(event: KeyboardEvent, manualRange: () => CompletionRange | null) {
    if (event.isComposing) return false
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') update(manualRange())
    else if (!entries.value.length || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    else if (event.key === 'ArrowDown') selected.value = (selected.value + 1) % entries.value.length
    else if (event.key === 'ArrowUp') selected.value = (selected.value + entries.value.length - 1) % entries.value.length
    else if (event.key === 'Enter' || event.key === 'Tab') choose()
    else if (event.key === 'Escape') close()
    else return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  return { entries, selected, close, update, choose, key }
}
