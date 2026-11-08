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
  const input = page.getByRole('textbox', { name: '聊天消息' })
  const handle = page.locator('.composer .resize-bar')
  await input.blur()
  const background = await page.locator('.composer .line').evaluate(e => getComputedStyle(e).backgroundColor)
  await input.click()
  assert.equal(await input.evaluate(e => e === document.activeElement && getComputedStyle(e).outlineStyle === 'none'), true)
  await page.waitForFunction(color => getComputedStyle(document.querySelector('.composer .line')).backgroundColor !== color, background)
  const initialHeight = (await input.boundingBox()).height
  const bar = await handle.boundingBox()
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
  await page.mouse.down()
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2 - 100, { steps: 4 })
  await page.mouse.up()
  const height = await page.evaluate(() => Number(localStorage.getItem('yh.composer.height')))
  assert.ok(height >= initialHeight + 95)
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  assert.equal(Math.round((await input.boundingBox()).height), height)
  await page.reload()
  await page.waitForFunction(() => !!window.__qa)
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  assert.equal(Math.round((await input.boundingBox()).height), height)
  await handle.dblclick()
  assert.equal(await page.evaluate(() => localStorage.getItem('yh.composer.height')), null)
  await input.click()
  await input.fill('第一行\n第二行\n第三行\n第四行')
  assert.ok((await input.boundingBox()).height > initialHeight)
  await input.clear()

  await page.setViewportSize({ width: 740, height: 750 })
  await page.locator('.chat-header .only-mobile').click()
  await page.locator('.convs .cname').filter({ hasText: '云湖群' }).click()
  assert.equal(await page.locator('.drawer-mask').count(), 0)
  await input.click()
  assert.equal(await input.evaluate(e => e === document.activeElement), true)
  await page.setViewportSize({ width: 1200, height: 750 })

  await page.evaluate(() => {
    const { ctx } = window.__qa
    ctx.api.messages = async () => []
    const make = (prefix, n, start) => Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`, ts: start + i, senderId: 'other', sender: '群友',
      type: 1, content: { text: '群聊历史 ' + i },
    }))
    const start = Date.now()
    ctx.chat.state.messages = make('recent', 40, start)
    ctx.chat.state.hasMore = true
    ctx.api.messagesBefore = () => new Promise(resolve => {
      window.__qa.finishHistory = () => resolve(make('older', 30, start - 60000))
    })
    const box = document.querySelector('.messages')
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll'))
    window.__qa.checkAnchor = () => {
      const top = box.getBoundingClientRect().top
      const row = [...box.querySelectorAll('.history-row')].find(e => e.getBoundingClientRect().bottom > top)
      return { id: row.dataset.historyId, offset: row.getBoundingClientRect().top - top }
    }
  })
  await page.waitForFunction(() => !!window.__qa.finishHistory)
  const anchor = await page.evaluate(() => {
    document.querySelector('.messages').scrollTop = 480
    return window.__qa.checkAnchor()
  })
  await page.evaluate(() => window.__qa.finishHistory())
  await page.locator('[data-history-id="older-0"]').waitFor({ state: 'attached' })
  const afterPrepend = await page.evaluate(() => window.__qa.checkAnchor())
  assert.equal(afterPrepend.id, anchor.id)
  assert.ok(Math.abs(afterPrepend.offset - anchor.offset) < 3)

  await page.evaluate(() => {
    const { chat } = window.__qa.ctx
    chat.state.hasMore = false
    chat.state.messages = Array.from({ length: 600 }, (_, i) => ({
      id: `long-${i}`, ts: Date.now() + i, senderId: 'other', sender: '群友',
      type: 1, content: { text: '长群聊历史 ' + i },
    }))
    window.__qa.ctx.emit('chat/scroll-bottom')
  })
  await page.locator('[data-mid="long-599"]').waitFor()
  assert.equal(await page.locator('.history-row').count(), 600)
  assert.ok(await page.locator('.message-row').count() < 70)
  await page.evaluate(() => { window.__qa.ctx.chat.state.locateId = 'long-270' })
  await page.locator('[data-mid="long-270"].locate').waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-mid="long-599"]'))
  const rendered = await page.locator('.message-row').count()
  assert.ok(rendered < 70)
  console.log(`PASS: composer focus and saved height, narrow drawer dismissal, delayed history anchor, and ${rendered}/600 mounted messages after a distant jump`)
  await page.evaluate(() => {
    const { ctx } = window.__qa
    window.__qa.locatePageRequests = 0
    ctx.api.messagesBefore = async () => { window.__qa.locatePageRequests++; return [] }
    ctx.chat.state.hasMore = true
    ctx.chat.state.jumpedAway = true
    ctx.chat.state.locateId = 'long-0'
  })
  await page.waitForFunction(() => document.querySelector('.messages').scrollTop < 2 && !!document.querySelector('[data-mid="long-0"].locate'))
  await page.waitForFunction(() => !document.querySelector('.messages.locating-history'))
  assert.equal(await page.evaluate(() => window.__qa.locatePageRequests), 0)
  await page.locator('.messages').hover()
  await page.mouse.wheel(0, -220)
  await page.waitForFunction(() => window.__qa.locatePageRequests === 1)
  console.log('PASS: landing at the top after a quote jump does not start history loading; scrolling up intentionally does')

  await page.evaluate(() => {
    const { ctx } = window.__qa
    ctx.chat.state.hasMore = false
    const [a, b, c] = ctx.chat.state.conversations
    const keys = [a, b, c].map(channel => channel.type + ':' + channel.id)
    const pending = new Map()
    ctx.api.messages = (id, type) => new Promise(resolve => pending.set(type + ':' + id, resolve))
    for (const channel of [a, b, c]) void ctx.chat.open(channel)
    window.__qa.finishSwitch = index => {
      const key = keys[index]
      pending.get(key)([{ id: 'switch-' + index, ts: Date.now(), type: 1, senderId: 'peer', sender: '发送者',
        content: { text: '会话 ' + key } }])
    }
  })
  await page.evaluate(() => window.__qa.finishSwitch(2))
  await page.locator('[data-mid="switch-2"]').waitFor()
  await page.evaluate(() => { window.__qa.finishSwitch(1); window.__qa.finishSwitch(0) })
  await page.waitForFunction(() => !window.__qa.ctx.chat.state.loadingMsgs)
  assert.equal(await page.locator('[data-mid="switch-0"],[data-mid="switch-1"]').count(),0)
  assert.equal(await page.locator('[data-mid="switch-2"]').count(),1)
  assert.deepEqual(errors, [])
  console.log('PASS: clicking a conversation scrolls to its newest loaded message; polling preserves a manually opened history position')
} finally { await browser.close(); await server.close() }
