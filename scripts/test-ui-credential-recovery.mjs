import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: resolve(import.meta.dirname, '..'), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
  await page.waitForFunction(() => window.__qa)
  await page.evaluate(() => { window.__qa.ctx.auth.loadAccounts = async () => { throw '本地安全服务临时不可用' } })
  await page.getByRole('button', { name: '账号与配置', exact: true }).click()
  await page.getByLabel('搜索设置与功能').fill('账号 切换')
  await page.locator('.settings-result').filter({ hasText: '多账号切换与登录' }).click()
  await page.getByRole('alert').filter({ hasText: '读取本地账号失败：本地安全服务临时不可用' }).waitFor()
  assert.doesNotMatch(await page.locator('.saved-accounts').innerText(), /undefined/)
  await page.getByRole('button', { name: '添加账号', exact: true }).click()
  await page.evaluate(() => { window.__qa.ctx.auth.loginWithToken = async () => { throw '安全凭据读取失败' } })
  await page.getByRole('button', { name: 'Token 登录', exact: true }).click()
  await page.getByPlaceholder('粘贴 token').fill('test-only')
  await page.getByRole('button', { name: '进入', exact: true }).click()
  await page.locator('.login-card .err').filter({ hasText: '安全凭据读取失败' }).waitFor()
  await page.getByRole('button', { name: '取消添加', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('PASS: native string rejections show readable credential errors; the settings interface remains usable after failure')
} finally { await browser.close(); await server.close() }
