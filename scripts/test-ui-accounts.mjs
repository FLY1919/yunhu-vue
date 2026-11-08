import assert from 'node:assert/strict'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {readFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
try {
  await page.route('**/data/**',route=>route.fulfill({json:{}}))
  const base=`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/accounts.html`
  await page.goto(base)
  await page.waitForFunction(()=>document.querySelectorAll('.saved-account').length===3)
  assert.equal(await page.getByText('已保存账号（3）',{exact:true}).count(),1)
  await page.evaluate(() => {
    const { api } = window.__accounts.ctx
    const self = api.self.bind(api)
    api.self = async () => {
      api.self = self
      throw new Error('系统错误')
    }
  })
  await page.locator('.saved-account').filter({hasText:'本地账号 b'}).getByRole('button',{name:'切换登录',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'云湖账号验证接口返回系统错误'}).waitFor()
  assert.equal(await page.getByRole('alert').count(), 1)
  assert.equal(await page.locator('.login-card > .err').count(), 0)
  await page.locator('.saved-account').filter({hasText:'本地账号 b'}).getByRole('button',{name:'切换登录',exact:true}).click()
  await page.waitForFunction(()=>window.__accounts.ctx.auth.state.user?.id==='b')
  await page.evaluate(()=>window.__accounts.ctx.auth.logout())
  assert.equal(await page.locator('.saved-account').count(),3)
  assert.equal(await page.evaluate(()=>window.__accounts.ctx.auth.state.status),'guest')
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.saved-account').length===3)
  await page.evaluate(() => { window.__accounts.ctx.api.login = async () => { throw new Error('系统错误') } })
  await page.getByPlaceholder('you@example.com').fill('synthetic@example.test')
  await page.getByPlaceholder('••••••••').fill('test-only')
  await page.getByRole('button', { name:'登录', exact:true }).click()
  await page.getByRole('alert').filter({hasText:'云湖邮箱登录接口返回系统错误'}).waitFor()
  await page.goto(base+'?deny')
  await page.getByRole('alert').filter({hasText:'ACL'}).waitFor()
  assert.equal(await page.getByText('暂无已保存账号，登录后会自动加入此列表。',{exact:true}).count(),0)
  await page.evaluate(()=>window.__accounts.allow())
  await page.getByRole('button',{name:'刷新账号',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.saved-account').length===3)
  assert.deepEqual(errors,[])
  await page.evaluate(() => window.__accounts.vault.set('accounts', JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => ({ id: 'local-' + i, token: 'fixture-local-' + i, user: { name: '本地账号 ' + i }, savedAt: i })) })))
  await page.getByRole('button',{name:'刷新账号',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.saved-account').length===20)
  assert.ok(await page.locator('.login-saved').evaluate(el => el.scrollHeight > el.clientHeight))
  const caps=JSON.parse(await readFile('src-tauri/capabilities/default.json','utf8'))
  for(const name of ['read','write','delete'])assert.ok(caps.permissions.includes('allow-secure-'+name))
  assert.ok(caps.windows.includes('main'));assert.ok(caps.remote.urls.includes('http://127.0.0.1:*/*'))
  console.log('PASS: real login lists saved/expired accounts, logout retains them, ACL rejection is visible, refresh recovers, 20 accounts scroll, main-window vault commands and selected loopback ports are authorized')
}finally{await browser.close();await server.close()}
