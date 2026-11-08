import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: process.cwd(), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(async () => {
    const { ctx } = window.__qa
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'normal'))
    ctx.chat.setAntiRecall(true)
    const channel = { id: 'normal', type: 2 }
    const emit = (name, id, content, type = 1) => ctx.emit(name, { id, channel,
      user: { id: 'test-user', name: '虚拟用户' }, timestamp: Date.now(),
      raw: { id, type, content }, elements: [], recalled: name === 'message-recalled' })
    emit('message-created', 'retained-text', { text: '这是保留的消息正文' })
    emit('message-created', 'retained-image', { image_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }, 2)
    emit('message-recalled', 'retained-text', {})
    emit('message-recalled', 'retained-image', {}, 2)
    emit('message-recalled', 'no-local-match', {})
  })
  const text = page.locator('[data-mid="retained-text"]')
  await text.waitFor()
  assert.match(await text.innerText(), /已撤回 · 本地保留/)
  assert.match(await text.innerText(), /这是保留的消息正文/)
  await page.evaluate(async () => {
    window.__qa.ctx.chat.state.messages.find(m => m.id === 'retained-text').elements = [{ type: 'text', attrs: { content: '' }, children: [] }]
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  await page.waitForFunction(() => document.querySelector('[data-mid="retained-text"]')?.textContent?.includes('这是保留的消息正文'))
  const image = page.locator('[data-mid="retained-image"]')
  await image.waitFor()
  assert.equal(await image.locator('.retained-label').count(), 1)
  assert.match(await image.locator('.bubble img').getAttribute('src'), /^data:image\/(?:gif|webp|png|svg\+xml)/)
  assert.equal(await page.locator('[data-mid="no-local-match"]').count(), 0)
  await page.evaluate(() => window.__qa.ctx.chat.setAntiRecall(false))
  await page.locator('[data-mid="no-local-match"] .recall-capsule').waitFor()
  await page.evaluate(() => window.__qa.ctx.chat.setAntiRecall(true))
  await page.waitForFunction(() => !document.querySelector('[data-mid="no-local-match"]'))
  await page.evaluate(() => window.__qa.ctx.chat.clearRecallCache())
  await page.waitForFunction(() => !document.querySelector('[data-mid="retained-text"]') && !document.querySelector('[data-mid="retained-image"]'))
  assert.deepEqual(errors, [])
  console.log('PASS: real Vue UI renders retained text and image, hides unmatched recalls, and removes cleared records')
} finally { await browser.close(); await server.close() }
