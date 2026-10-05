#!/usr/bin/env node
/**
 * 部署前自检（preflight）
 *
 * 这些坑我已经反复踩过，所以固化成脚本：
 *   1) Vue 组件里模板用到的标识符（resUrl / fallbackAvatar / fmtTime / Icon / renderMarkdown …）
 *      在 <script> 里有没有 import —— 少一个就是「组件整块不渲染」且控制台不一定报错
 *   2) 插件的 apply 里用到 ctx.xxx 的服务名，是否在 inject/依赖里声明了
 *   3) 引用的本地文件（import ... from './x'）是否存在
 *
 * 用法：node scripts/preflight.mjs     退出码非 0 表示有问题
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const SRC = join(ROOT, 'src')

/** 模板里常用、必须从别处 import 的标识符 */
const NEED_IMPORT = [
  'resUrl', 'fallbackAvatar', 'fmtTime', 'renderMarkdown', 'sanitizeHtml', 'linkify',
  'Icon', 'KLayout', 'KCard', 'KSlot', 'h', 'resPrefix', 'isResHost', 'postProcess',
  'analyzeA2ui', 'renderRich', 'normalizeMessage', 'toText', 'makeSession',
]

/** 全局可用、不需要 import 的（Vue 内置 / 浏览器 / 全局组件） */
const BUILTIN = new Set([
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'Promise', 'Set', 'Map',
  'window', 'document', 'console', 'navigator', 'location', 'localStorage', 'fetch', 'Blob', 'File',
  'URL', 'URLSearchParams', 'FormData', 'MediaRecorder', 'AbortController', 'TextDecoder', 'TextEncoder',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'atob', 'btoa', 'crypto', 'confirm', 'alert', 'prompt', 'parseInt', 'parseFloat', 'isNaN',
  'component', 'template', 'transition', 'transition-group', 'keep-alive', 'slot', 'teleport', 'suspense',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const problems = []
const files = walk(SRC)

/* ---------- 1) Vue 组件：模板用到但 script 没 import ---------- */
for (const f of files.filter((x) => x.endsWith('.vue'))) {
  const text = readFileSync(f, 'utf8')
  const tplIdx = text.indexOf('<template>')
  if (tplIdx < 0) continue
  const script = text.slice(0, tplIdx)
  const tpl = text.slice(tplIdx)
  for (const name of NEED_IMPORT) {
    // 模板里作为标识符出现（不是属性名/文案）
    const used = new RegExp(`[\\s"'({@]${name}\\b\\s*[\\(\\.,)]|[:@]${name}\\b\\s*=|\\{\\{\\s*${name}\\b`).test(tpl)
    if (!used) continue
    const imported = new RegExp(`\\b${name}\\b`).test(script)
    if (!imported && !BUILTIN.has(name)) {
      problems.push(`${f.replace(ROOT + '/', '')}: 模板用了 ${name}，但 script 里没有 import`)
    }
  }
}

/* ---------- 2) import 的本地文件是否存在 ---------- */
for (const f of files.filter((x) => /\.(ts|vue)$/.test(x))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1]
    const base = resolve(dirname(f), spec)
    const jsStripped = base.replace(/\.js$/, '')
    const cands = [base, base + '.ts', base + '.vue', base + '.js', jsStripped + '.ts', jsStripped + '.vue',
      jsStripped + '.js', join(base, 'index.ts'), join(jsStripped, 'index.ts')]
    if (!cands.some((c) => existsSync(c))) {
      problems.push(`${f.replace(ROOT + '/', '')}: import 的文件不存在 → ${spec}`)
    }
  }
}

/* ---------- 3) 插件里 ctx.xxx 是否在 inject/deps 里 ---------- */
const KNOWN_SERVICES = new Set([
  'api', 'auth', 'chat', 'ws', 'ui', 'theme', 'console', 'cfg', 'logs', 'group', 'bots', 'satori',
  'adapter', 'messageActions', 'quickreply', 'charbg', 'session', 'event', 'social', 'botconsole',
  'community', 'stickers', 'commands', 'http', 'app', 'logger',
  // cordis / vue / 全局
  'on', 'off', 'once', 'emit', 'effect', 'plugin', 'inject', 'set', 'get', 'provide', 'extend',
  'scope', 'isolate', 'setTimeout', 'setInterval', 'throttle', 'debounce', 'parallel', 'bail', 'serial',
  'nextTick', 'watch', 'watchEffect', 'computed', 'reactive', 'ref', 'h', 'dispose', 'isActive',
])
for (const f of files.filter((x) => x.endsWith('.ts') && x.includes('/plugins/'))) {
  const text = readFileSync(f, 'utf8')
  const injectMatch = text.match(/inject:\s*(\[[^\]]*\]|\{[^}]*\})/)
  const declared = injectMatch ? injectMatch[1] : ''
  for (const m of text.matchAll(/ctx\.([a-zA-Z_$][\w$]*)\b/g)) {
    const name = m[1]
    if (KNOWN_SERVICES.has(name) || BUILTIN.has(name)) continue
    if (declared.includes(name)) continue
    problems.push(`${f.replace(ROOT + '/', '')}: 用了 ctx.${name}，但 inject 里没声明（也不在已知服务里）`)
  }
}

/* ---------- 输出 ---------- */
if (problems.length) {
  console.error('✗ 自检发现 ' + problems.length + ' 个问题：')
  for (const p of [...new Set(problems)]) console.error('  - ' + p)
  process.exit(1)
}
console.log('✓ 自检通过（模板 import / 本地引用 / 服务声明）')
