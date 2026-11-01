import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: process.cwd(), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' })
const errors = [], aiRequests = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => { window.__nativeCalls = []; window.__TAURI__ = { core: { invoke: async (command,args) => { window.__nativeCalls.push({command,args}); return false } } } })
await page.route('**/bot-ai/**', route => { aiRequests.push(route.request().url()); return route.abort() })
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/notifications.html?userbot=1&security=1`)
  await page.waitForFunction(() => window.__qa?.ctx.userbot?.state.ready)
  await page.evaluate(async () => {
    const { ctx } = window.__qa; ctx.ui.setNotificationMode('in-app'); ctx.ws.state.status = 'online'
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'normal'))
    ctx.chat.state.messages = [false,true].map((right,i) => ({ id:'center-'+i, type:1, ts:Date.now(), sender:'特别长的名字'.repeat(50), senderId:'other', right, recalled:true, content:{} }))
  })
  await page.locator('.recall-capsule').first().waitFor()
  assert.equal(await page.locator('.online-dot').count(),0)
  for (const width of [1440,980,600,390,320]) {
    await page.setViewportSize({ width,height:900 })
    const measurements = await page.locator('.recall-capsule').evaluateAll(items => items.map(el => {
      const area=el.closest('.messages'), r=el.getBoundingClientRect(), a=area.getBoundingClientRect()
      return { delta:Math.abs(r.x+r.width/2-(a.x+area.clientWidth/2)), fits:r.left>=a.left-1&&r.right<=a.right+1, width:r.width, area:area.clientWidth }
    }))
    assert.equal(measurements.length,2)
    for(const m of measurements) { assert.ok(m.width>0,JSON.stringify({width,m})); assert.ok(m.delta<2,JSON.stringify({width,m})); assert.equal(m.fits,true) }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  await page.setViewportSize({ width:1280,height:900 })
  await page.evaluate(() => { const ctx=window.__qa.ctx; ctx.chat.preferences.antiRecall=true; ctx.chat.state.messages=[{id:'retained',type:1,ts:Date.now(),sender:'张三',recalled:true,retainedRecall:true,cachedAt:Date.now(),content:{text:'保留原文'.repeat(100)}}] })
  await page.locator('.retained-label').waitFor()
  assert.equal(await page.locator('.retained-label').evaluate(el=>getComputedStyle(el).textAlign),'center')
  assert.match(await page.locator('[data-mid=retained]').innerText(),/保留原文/)
  await page.evaluate(()=>window.__qa.ctx.console.goto('/account'))
  await page.getByRole('button',{name:'安全',exact:true}).click()
  await page.getByLabel('设置锁定 PIN').fill('1234'); await page.getByLabel('确认锁定 PIN').fill('1234')
  await page.getByRole('button',{name:'设置 PIN',exact:true}).click()
  await page.getByLabel('软件启动时锁定').check(); await page.getByLabel('反截屏（Windows 桌面版）').check()
  await page.waitForFunction(()=>window.__qa.ctx.lock.state.preferences.captureProtection)
  assert.equal(await page.evaluate(()=>window.__nativeCalls.some(c=>c.command==='set_privacy'&&c.args.capture)),true)
  await page.getByRole('button',{name:'修改 PIN',exact:true}).click()
  await page.getByLabel('原 PIN').fill('0000'); await page.getByLabel('设置锁定 PIN').fill('5678'); await page.getByLabel('确认锁定 PIN').fill('5678'); await page.getByRole('button',{name:'设置 PIN',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'原 PIN 不正确'}).waitFor()
  await page.getByRole('button',{name:'常规',exact:true}).click(); await page.locator('.auto-lock-settings').waitFor({state:'detached'}); assert.equal(await page.locator('.auto-lock-settings').count(),0)
  await page.getByRole('button',{name:'账号与登录',exact:true}).click(); assert.equal(await page.locator('.auto-lock-settings').count(),0)
  await page.evaluate(()=>{ const ctx=window.__qa.ctx; ctx.ui.toast('锁定前消息','message',10000,{key:'old'}); ctx.lock.lock(); ctx.ui.toast('锁定时消息','message',10000,{key:'locked'}) })
  assert.equal(await page.evaluate(()=>window.__qa.ctx.ui.state.toasts.filter(t=>t.type==='message').length),0)
  await page.evaluate(async()=>{const ctx=window.__qa.ctx; await ctx.lock.unlock(); ctx.ui.toast('解锁后消息','message',10000,{key:'new'})})
  assert.equal(await page.evaluate(()=>window.__qa.ctx.ui.state.toasts.filter(t=>t.type==='message').length),1)
  await page.evaluate(()=>window.__qa.ctx.userbot.open(null,'bots'))
  await page.getByRole('button',{name:'创建 Bot',exact:true}).click()
  await page.getByLabel('此 Bot 使用 AI').uncheck()
  assert.equal(await page.getByLabel('默认 AI 服务').count(),0)
  await page.getByRole('button',{name:'会话设置',exact:true}).click()
  await page.getByLabel('选择会话').selectOption('2:normal')
  await page.getByRole('button',{name:'一键启用草稿',exact:true}).click()
  await page.getByLabel('自动回复内容').fill('你好，{name}')
  assert.equal(await page.getByLabel('此会话使用 AI').isDisabled(),true)
  assert.equal(await page.getByLabel('此会话使用 AI').isChecked(),false)
  assert.equal(await page.locator('.advanced-options').getAttribute('open'),null)
  assert.equal(aiRequests.length,0)
  if(process.env.SECURITY_QA_SCREENSHOT) await page.screenshot({path:process.env.SECURITY_QA_SCREENSHOT})
  assert.deepEqual(errors,[])
  console.log('PASS: left/right long recall notices centered at 1440/980/600/390/320px, retained body unchanged, no online dot, Security-only controls, verified PIN change, native capture setting, lock notification suppression, and simplified no-AI Bot setup')
} finally { await browser.close(); await server.close() }
