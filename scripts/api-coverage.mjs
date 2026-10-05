#!/usr/bin/env node
/**
 * 生成 docs/api-coverage.md：把「社区文档收录的云湖接口」和「本项目实际调用的接口」对齐。
 *
 * 用法：
 *   node scripts/api-coverage.mjs            # 用在线文档
 *   DOC=/path/to/full.md node scripts/api-coverage.mjs   # 用本地文档（离线/自备）
 *
 * 为什么要这个：
 *   项目里 200+ 个接口不可能靠脑子记住哪些用过。每次要加功能前跑一次，
 *   就知道「还剩哪些没用」「有没有写错路径」（文档外的那些就是实测补的/写错的）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 文档来源：优先本地文件（离线也能跑），否则抓在线版 */
async function loadDoc() {
  if (process.env.DOC) return readFileSync(process.env.DOC, 'utf8')
  const urls = [
    'https://raw.githubusercontent.com/yh-Tpdev/yhchatAPI/main/yh-api.md',
    'https://raw.githubusercontent.com/yh-Tpdev/yhchatAPI/main/README.md',
  ]
  for (const u of urls) {
    try {
      const r = await fetch(u)
      if (r.ok) return await r.text()
    } catch { /* 试下一个 */ }
  }
  throw new Error('拿不到文档：请设置 DOC=/path/to/doc.md')
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const doc = await loadDoc()
const docEps = [...new Set([...doc.matchAll(/(?:POST|GET|PUT|DELETE)\s+\/?v1\/([A-Za-z0-9/_-]+)/g)].map((m) => '/v1/' + m[1]))].sort()

const used = new Set()
const where = {}
const files = [...walk(join(ROOT, 'src')), ...readdirSync(ROOT).filter((f) => f.endsWith('.ts')).map((f) => join(ROOT, f))]
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/['"](\/v1\/[A-Za-z0-9/_-]+)['"]/g)) {
    used.add(m[1])
    ;(where[m[1]] = where[m[1]] || new Set()).add(f.replace(ROOT + '/', ''))
  }
}

const hit = docEps.filter((e) => used.has(e))
const miss = docEps.filter((e) => !used.has(e))
const extra = [...used].filter((e) => !docEps.includes(e)).sort()

const groupBy = (list) => {
  const g = {}
  for (const e of list) {
    const k = e.split('/')[2] || 'root'
    ;(g[k] = g[k] || []).push(e)
  }
  return g
}
const who = (e) => [...(where[e] || [])].join('、')

const L = []
L.push('# 云湖接口覆盖情况', '')
L.push('> 由 `node scripts/api-coverage.mjs` 生成 —— 把「社区文档收录的接口」和「本项目实际调用的接口」对齐。', '')
L.push(`- 文档收录：**${docEps.length}** 个`)
L.push(`- 已使用：**${used.size}** 个（文档内 ${hit.length}）`)
L.push(`- 还没用：**${miss.length}** 个`, '')
L.push('## 一、已实现（文档内）', '')
for (const [k, v] of Object.entries(groupBy(hit))) {
  L.push(`**${k}**`)
  for (const e of v) L.push(`- \`${e}\` — ${who(e)}`)
  L.push('')
}
L.push('## 二、项目里在用、但文档没收录的', '')
L.push('这些是实测补出来的（或文档写错、我踩过坑纠正的），官方若有改动要优先回归：', '')
for (const e of extra) L.push(`- \`${e}\` — ${who(e)}`)
L.push('')
L.push('## 三、待实现清单', '')
for (const [k, v] of Object.entries(groupBy(miss))) {
  L.push(`**${k}**（${v.length}）  ` + v.map((e) => '`' + e.replace('/v1/', '') + '`').join('、'))
  L.push('')
}

writeFileSync(join(ROOT, 'docs/api-coverage.md'), L.join('\n'))
console.log(`✓ docs/api-coverage.md 已更新：已用 ${used.size} / 文档 ${docEps.length}，待实现 ${miss.length}`)
