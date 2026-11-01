// Browser regression against the actual message renderer, with offline bot data.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: process.cwd(), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(() => {
    const rows = [[{ text: '复制按钮', actionType: 2, value: '复制的内容' },
      { text: '打开链接', actionType: 1, url: 'https://example.com/test' }],
      [{ text: '签到', actionType: 3, value: 'checkin' }, { text: '打开群', actionType: 1, url: 'yunhu://chat-add?id=12345&type=group' }, { text: '旧格式按钮' }]]
    window.__qa.buttonCalls = []
    window.__qa.ctx.api.buttonReport = async data => { window.__qa.buttonCalls.push(data) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__qa.copied = text } } })
    window.open = url => { window.__qa.opened = url; return null }
    window.__qa.messages.push({ id: 'bot-buttons', type: 1, ts: Date.now() + 20, senderId: 'bot', sender: '机器人',
      content: { text: '机器人消息', buttons: JSON.stringify(rows) } })
  })
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  const message = page.locator('[data-mid="bot-buttons"]')
  await message.waitFor()
  assert.equal(await message.locator('.msg-btn-row').count(), 2)
  assert.deepEqual(await message.locator('.msg-btn').allTextContents(), ['复制按钮', '打开链接', '签到', '打开群', '旧格式按钮'])
  assert.equal((await message.textContent()).includes('[object Object]'), false)
  await message.getByRole('button', { name: '复制按钮' }).click()
  assert.equal(await page.evaluate(() => window.__qa.copied), '复制的内容')
  await message.getByRole('button', { name: '打开链接' }).click()
  assert.equal(await page.evaluate(() => window.__qa.opened), 'https://example.com/test')
  await message.getByRole('button', { name: '签到' }).click()
  assert.deepEqual(await page.evaluate(() => window.__qa.buttonCalls), [{ chatId: 'normal', chatType: 2, msgId: 'bot-buttons', userId: 'me', value: 'checkin' }])
  await message.getByRole('button', { name: '旧格式按钮' }).click()
  assert.equal(await page.evaluate(() => window.__qa.buttonCalls.at(-1).value), '旧格式按钮')
  await message.getByRole('button', { name: '打开群' }).click()
  await page.locator('.post-mask').getByText(/群号 12345/).waitFor()
  await page.locator('.post-mask').getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => { window.__qa.ctx.api.buttonReport = async () => { throw new Error('回调失败') } })
  await message.getByRole('button', { name: '签到' }).click()
  await page.waitForFunction(() => window.__qa.ctx.ui.state.toasts.some(t => t.text.includes('回调失败')))
  await page.setViewportSize({ width: 420, height: 800 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log('PASS: two button rows render correctly; link, clipboard, callback and failed callback use their proper paths')
} finally { await browser.close(); await server.close() }
