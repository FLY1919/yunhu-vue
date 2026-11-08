// Browser regression against the real in-app Toast component and chat service.
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/notifications.html`)
  await page.waitForFunction(() => !!window.__qa)
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  await page.waitForFunction(() => window.__qa.ctx.chat.state.current?.id === 'normal')
  await page.evaluate(() => {
    const { ctx } = window.__qa
    ctx.chat.state.conversations.find(c => c.id === 'normal').noDisturb = false
    ctx.ui.setNotificationMode('in-app')
    window.__qa.push = id => ctx.emit('message-created', { id, channel: { id: 'normal', type: 2, name: '云湖群' },
      user: { id: 'sender', name: '发件人' }, raw: { id, type: 1, senderId: 'sender', content: { text: id } }, timestamp: Date.now(), elements: [] })
    window.__qa.push('visible-message')
  })
  assert.equal(await page.locator('.toast.message').count(), 0)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('yh-window-minimized', { detail: true }))
    window.__qa.push('minimized-message')
    window.__qa.push('minimized-message')
  })
  const toast = page.locator('.toast.message')
  await toast.waitFor()
  assert.equal(await toast.count(), 1)
  assert.match(await toast.textContent(), /minimized-message/)
  await toast.locator('.toast-action').click()
  await page.waitForFunction(() => window.__qa.ctx.chat.state.locateId === 'minimized-message')
  await toast.waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('yh-window-minimized', { detail: false }))
    window.__qa.ctx.chat.toggleMute('normal')
    window.dispatchEvent(new CustomEvent('yh-window-minimized', { detail: true }))
    window.__qa.push('muted-message')
  })
  await page.waitForTimeout(30)
  assert.equal(await page.locator('.toast.message').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: real Toast UI shows one minimized-conversation notification, navigates to its message, and suppresses muted chats')
} finally { await browser.close(); await server.close() }
