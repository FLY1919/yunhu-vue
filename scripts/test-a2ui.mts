/**
 * A2UI 解析器自测：喂几种真实/边角形态，看它吐出什么。
 * 跑：npx tsx scripts/test-a2ui.mts
 */
import { analyzeA2ui } from '../src/satori/a2ui'

const fence = '```'

const cases: Array<[string, string]> = [
  ['v0.9 围栏 + Column/Text/Button', fence + `json
{"version":"v0.9","createSurface":{"surfaceId":"s1"},"updateComponents":{"surfaceId":"s1","components":[
 {"id":"root","component":"Column","children":["t1","b1"]},
 {"id":"t1","component":"Text","text":"测试文本"},
 {"id":"b1","component":"Button","label":"点我试试","primary":true,"action":{"name":"go"}}
]}}
` + fence],
  ['裸 JSON（没有围栏）', `{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[
 {"id":"root","component":"Column","children":["b1"]},
 {"id":"b1","component":"Button","label":"裸JSON按钮"}
]}}`],
  ['只有 text 字段的普通 markdown', '**加粗** 和 | 表格 |'],
  ['HTML', '<div style="color:red">hi</div>'],
  ['A2UI + 尾巴 markdown', fence + `json
{"updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Text","text":"头"}]}}
` + fence + '\n后面的正文'],
]

for (const [name, input] of cases) {
  const r: any = analyzeA2ui(input as any)
  if (!r) { console.log(`\n【${name}】→ null`); continue }
  if (r.kind === 'a2ui') {
    console.log(`\n【${name}】→ kind=a2ui, surfaces=${r.surfaces.length}`)
    for (const s of r.surfaces) {
      console.log('   root =', s.root, '| 组件数 =', s.components.size)
      for (const [id, c] of s.components) {
        console.log(`     - ${id}: component=${(c as any).component} ${(c as any).label ? 'label=' + (c as any).label : ''}${(c as any).text ? ' text=' + (c as any).text : ''}`)
      }
    }
    if (r.rest) console.log('   rest(尾巴) =', JSON.stringify(String(r.rest).slice(0, 40)))
  } else {
    console.log(`\n【${name}】→ kind=${r.kind}`, JSON.stringify(String(r.html || r.text).slice(0, 50)))
  }
}

// 追加：无围栏 + 前后有说明文字的多行 JSON
const mixed = '好的，这是完整版本：\n{\n  "version": "v0.9",\n  "updateComponents": {\n    "surfaceId": "s9",\n    "components": [\n      {"id":"root","component":"Column","children":["b9"]},\n      {"id":"b9","component":"Button","label":"无围栏按钮"}\n    ]\n  }\n}\n谢谢'
const m: any = analyzeA2ui(mixed)
console.log('\n【无围栏+说明文字】→ kind =', m?.kind)
if (m?.kind === 'a2ui') {
  for (const s of m.surfaces) console.log('   组件:', [...s.components.values()].map((c: any) => c.component + (c.label ? ':' + c.label : '')).join(', '))
  console.log('   rest =', JSON.stringify(String(m.rest).slice(0, 30)))
}
