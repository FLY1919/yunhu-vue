/**
 * 冒烟测试：在 Node 里跑 Cordis 内核 + api 插件（浏览器里走的是同一份代码）
 * 用法： YH_EMAIL=xxx YH_PASS=xxx node test.mjs
 */
import { createContext } from './src/core/context'
import { apiPlugin } from './src/plugins/api'

const ctx = createContext()
ctx.plugin(apiPlugin, { base: process.env.YH_BASE || 'https://chat-go.jwzhd.com' })

const api = ctx.api
console.log('服务已注册:', [...ctx.app.services.keys()])

const token = await api.login(process.env.YH_EMAIL, process.env.YH_PASS, 'node-smoke', 'web')
api.setToken(token)
console.log('✓ 登录成功，token 前缀:', token.slice(0, 8) + '…')

const me = await api.self()
console.log('✓ 自身信息:', { id: me.id, name: me.name, email: me.email, coin: me.coin, vip: me.vip })

const convs = await api.conversations()
console.log(`✓ 会话列表: ${convs.length} 个`)
for (const c of convs.slice(0, 5))
  console.log(`   [${c.type}] ${c.id} ${c.name}  未读=${c.unread}`)

const g = convs.find(c => c.id === '418769995')
if (g) {
  const msgs = await api.messages(g.id, g.type, 10)
  console.log(`✓ 「${g.name}」最近 ${msgs.length} 条：`)
  for (const m of msgs.slice(-4)) console.log(`   ${m.sender}: ${(m.text || '[非文本]').slice(0, 40)}`)
} else {
  console.log('（未找到本群 418769995）')
}

// 插件卸载演示：卸载 api 后，依赖它的插件应被级联卸载
console.log('卸载 api 插件 → 服务表:', (ctx.app.mountReg, [...ctx.app.services.keys()]))
