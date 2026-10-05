/** 定位 A2UI 解析到底哪一步丢了（中间量全打出来） */
import { extractA2uiMessages, parseA2ui, analyzeA2ui } from '../src/satori/a2ui'

const fence = '```'
const payload = {
  version: 'v0.9',
  createSurface: { surfaceId: 's1' },
  updateComponents: {
    surfaceId: 's1',
    components: [
      { id: 'root', component: 'Column', children: ['t1', 'b1'] },
      { id: 't1', component: 'Text', text: '测试文本' },
      { id: 'b1', component: 'Button', label: '点我试试', primary: true, action: { name: 'go' } },
    ],
  },
}
const text = fence + 'json\n' + JSON.stringify(payload) + '\n' + fence

console.log('=== 输入 ===')
console.log(JSON.stringify(text))
console.log('\n=== extractA2uiMessages ===')
const msgs = extractA2uiMessages(text)
console.log('条数 =', msgs.length)
msgs.forEach((m: any, i) => console.log(`  [${i}] keys=`, Object.keys(m || {})))

console.log('\n=== parseA2ui ===')
const surfaces = parseA2ui(text)
console.log(surfaces ? surfaces.map((s) => ({ id: s.id, root: s.root, n: s.components.size })) : null)

console.log('\n=== 逐条手工模拟 ===')
for (const m of msgs as any[]) {
  const hasCS = !!m.createSurface
  const hasUC = !!m.updateComponents
  console.log('  createSurface?', hasCS, '| updateComponents?', hasUC, '| components 数 =', m.updateComponents?.components?.length)
}

console.log('\n=== analyzeA2ui ===')
const a: any = analyzeA2ui(text)
console.log('kind =', a?.kind)
