/**
 * 侧栏常驻功能项的共享状态（Console 的更多功能宫格 与 Sidebar 的常驻列表共用）
 * 存 localStorage：yh.more.pinned = 插件页 path 数组
 */
import { reactive } from 'vue'

const KEY = 'yh.more.pinned'

function load(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export const morePins = reactive({ paths: load() })

export function toggleMorePin(path: string) {
  const i = morePins.paths.indexOf(path)
  if (i >= 0) morePins.paths.splice(i, 1)
  else morePins.paths.push(path)
  localStorage.setItem(KEY, JSON.stringify(morePins.paths))
}

/** 拖拽排序：把 path 移到 target 之前（rail 常驻图标顺序） */
export function moveMorePin(path: string, target: string) {
  const from = morePins.paths.indexOf(path)
  if (from < 0) return
  morePins.paths.splice(from, 1)
  let to = morePins.paths.indexOf(target)
  if (to < 0) to = morePins.paths.length
  morePins.paths.splice(to, 0, path)
  localStorage.setItem(KEY, JSON.stringify(morePins.paths))
}

export function isMorePinned(path: string) { return morePins.paths.includes(path) }
