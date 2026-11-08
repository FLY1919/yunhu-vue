import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root, configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.setDefaultTimeout(6000)
const errors = [], bodies = []
page.on('pageerror', e => errors.push(e.message))
// Wire fixture follows full.proto: status field 1, scalar group_id field 2.
const ok = Buffer.from([0x0a, 2, 0x10, 1, 0x12, 7, ...Buffer.from('3333333')])
let mode = 'failure', release
await page.route('**/qa-api/v1/group/create-group', async route => {
  bodies.push(route.request().postDataBuffer())
  if (mode === 'hold') await new Promise(r => { release = r })
  try {
    if (mode === 'failure') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 1100, msg: '头像不合规' }) })
    else await route.fulfill({ contentType: 'application/x-protobuf', body: ok })
  } catch { /* A cancelled request may already have closed. */ }
})
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html?groupcreate`)
  await page.waitForFunction(() => !!window.__qa)
  await page.getByTitle('创建群聊 / 加好友').click()
  await page.locator('.plus-menu').getByRole('button', { name: '创建群聊', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '创建群聊' })
  await dialog.getByRole('textbox', { name: '群名称', exact: true }).fill('Test1forId')
  await dialog.getByRole('textbox', { name: '群简介', exact: true }).fill('保留这段简介')
  await dialog.getByRole('button', { name: '创建群聊', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: '头像不合规' }).waitFor()
  assert.equal(await dialog.getByRole('textbox', { name: '群名称', exact: true }).inputValue(), 'Test1forId')
  assert.equal(await dialog.getByRole('textbox', { name: '群简介', exact: true }).inputValue(), '保留这段简介')
  mode = 'hold'
  await dialog.getByRole('button', { name: '创建群聊', exact: true }).click()
  await dialog.getByRole('status').waitFor()
  assert.equal(await dialog.locator('button[type=submit]').isDisabled(), true)
  const before = bodies.length
  await dialog.locator('form').evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(bodies.length, before)
  if (process.env.UI_QA_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, 'group-create-pending.png') })
  await dialog.getByRole('button', { name: '停止等待' }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => !window.__qa.ctx.social.state.creation.pending)
  mode = 'success'; release?.()
  await page.getByTitle('创建群聊 / 加好友').click()
  await page.locator('.plus-menu').getByRole('button', { name: '创建群聊', exact: true }).click()
  await dialog.getByRole('textbox', { name: '群名称', exact: true }).fill('成功建群')
  await dialog.getByRole('button', { name: '创建群聊', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.__qa.ctx.social.state.book.groups[0].id), '3333333')
  assert.equal(await page.evaluate(() => window.__qa.ctx.social.state.creation.pending), false)
  // Same component and real service from the Contacts entry point.
  await page.evaluate(() => window.__qa.ctx.console.goto('/contacts'))
  await page.getByRole('button', { name: '创建群聊', exact: true }).click()
  const form = page.locator('.contact-form .create-group-form')
  await form.getByRole('textbox', { name: '群名称', exact: true }).fill('通讯录建群')
  mode = 'failure'
  await form.getByRole('button', { name: '创建群聊', exact: true }).click()
  await form.getByRole('alert').waitFor()
  for (const theme of ['dark', 'light']) {
    await page.evaluate(t => window.__qa.ctx.ui.setTheme(t), theme)
    if (process.env.UI_QA_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, `group-create-${theme}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  mode = 'success'
  await form.getByRole('button', { name: '创建群聊', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('PASS: both create-group entries; real API/service; failure retains input, cancellation releases state, duplicate submit blocked, scalar-ID success closes while refresh hangs; light/dark layout')
} finally { release?.(); await page.close(); await browser.close(); await server.close() }
