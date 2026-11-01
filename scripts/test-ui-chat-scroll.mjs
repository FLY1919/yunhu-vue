// Exercises the real chat list and scrolling DOM with delayed, offline messages.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: process.cwd(), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(() => {
    const make = (id, n = 40) => Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, ts: Date.now() + i,
      senderId: 'other', sender: '虚拟用户', type: 1, content: { text: `消息 ${id} ${i}` } }))
    window.__qa.makeMessages = make
    window.__qa.ctx.api.messages = id => id === 'other'
      ? new Promise(resolve => { window.__qa.resolveLatest = () => resolve(make(id)) })
      : Promise.resolve(make(id))
  })
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  await page.locator('[data-mid="normal-39"]').waitFor()
  await page.waitForFunction(() => { const e = document.querySelector('.messages'); return e.scrollHeight - e.clientHeight - e.scrollTop < 3 })
  await page.locator('.convs .cname').filter({ hasText: '其他会话' }).click()
  await page.waitForFunction(() => !!window.__qa.resolveLatest)
  await page.evaluate(() => {
    // Recreate the old DOM's late scroll event while the new request is pending.
    const box = document.querySelector('.messages'); box.scrollTop = 0; box.dispatchEvent(new Event('scroll'))
    window.__qa.ctx.chat.setAtBottom(false)
    window.__qa.resolveLatest()
  })
  await page.locator('[data-mid="other-39"]').waitFor()
  await page.waitForFunction(() => { const e = document.querySelector('.messages'); return e.scrollHeight - e.clientHeight - e.scrollTop < 3 })
  const current = await page.evaluate(() => window.__qa.ctx.chat.state.current.id)
  assert.equal(current, 'other')
  await page.evaluate(() => {
    const chat = window.__qa.ctx.chat
    chat.state.hasMore = false
    const box = document.querySelector('.messages'); box.scrollTop = 0; box.dispatchEvent(new Event('scroll'))
    window.__qa.ctx.api.messages = async id => window.__qa.makeMessages(id, 41)
  })
  await page.evaluate(() => window.__qa.ctx.chat.loadMessages(true))
  await page.locator('[data-mid="other-40"]').waitFor()
  assert.ok(await page.locator('.messages').evaluate(e => e.scrollTop < 10))
  // Sending intentionally leaves a located/history window, for both text and attachments.
  await page.evaluate(() => {
    const chat = window.__qa.ctx.chat
    window.__qa.ctx.api.send = async () => 'own-text'
    chat.state.jumpedAway = true; chat.state.locateId = 'other-2'
  })
  await page.locator('.composer textarea').fill('主动发送后回到底部')
  await page.locator('.composer textarea').press('Enter')
  await page.locator('[data-mid="own-text"]').waitFor()
  await page.waitForFunction(() => { const e = document.querySelector('.messages'); return e.scrollHeight - e.clientHeight - e.scrollTop < 3 })
  assert.equal(await page.evaluate(() => window.__qa.ctx.chat.state.jumpedAway), false)
  await page.evaluate(async () => {
    const chat = window.__qa.ctx.chat, box = document.querySelector('.messages')
    box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); chat.state.jumpedAway = true
    window.__qa.ctx.api.send = async () => 'own-media'
    await chat.sendMedia([{ type: 'file', attrs: { src: 'mock-file', name: '示例.txt', size: 12 } }])
  })
  await page.locator('[data-mid="own-media"]').waitFor()
  await page.waitForFunction(() => { const e = document.querySelector('.messages'); return e.scrollHeight - e.clientHeight - e.scrollTop < 3 })
  console.log('PASS: Enter text and media sends leave history mode and reach their newest optimistic message')
  assert.deepEqual(errors, [])
  console.log('PASS: clicking a conversation scrolls to its newest loaded message; polling preserves a manually opened history position')
} finally { await browser.close(); await server.close() }
