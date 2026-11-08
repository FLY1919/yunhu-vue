import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as pb from '../src/core/pb.ts'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: process.cwd(), configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 360, height: 760 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html?group-message-labels`)
  await page.waitForFunction(() => window.__qa)
  await page.evaluate(async () => {
    const { ctx } = window.__qa
    const tags = Array.from({ length: 16 }, (_, i) => ({ id: i + 1,
      text: i === 2 || i === 8 ? '窄窗口也能完整查看的超长群标签名称' : `标签 ${i + 1}`, color: '#21b3f3' }))
    const shortTags = ['英少女', '孩子王', '年轻人的糖'].map((text, id) => ({ id, text, color: '#21b3f3' }))
    const msg = (id, senderId, extra = {}) => ({ id, senderId, ts: Date.now(), sender: senderId,
      type: 1, content: { text: '测试消息' }, ...extra })
    ctx.api.messages = async id => id === 'normal' ? [
      msg('owner', 'owner-id', { sender: '相同昵称', tags: [...tags, { id: 50, groupId: 'other', text: '其他群标签' }] }),
      msg('admin', 'me', { right: true, tags }),
      msg('member', 'member-id', { sender: '相同昵称', tags: shortTags, content: { text: '好' } }),
    ] : [msg('switched', 'owner-id', { tags: tags.slice(0, 1) }), msg('no-tags', 'me', { right: true })]
    ctx.api.groupInfo = id => {
      if (id === 'normal') return Promise.resolve({ id, owner: 'owner-id', admins: ['owner-id', 'me'], createBy: 'member-id' })
      if (id === 'pin') return new Promise(resolve => { window.__qa.resolveOldInfo = resolve })
      return Promise.resolve({ id, owner: 'me', admins: [] })
    }
    ctx.api.listMembers = async () => ({ list: [{ id: 'owner-id', role: '管理员' }], total: 1 })
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'normal'))
  })

  const owner = page.locator('[data-mid="owner"]')
  const admin = page.locator('[data-mid="admin"]')
  const ownerBadge = owner.locator('.sender-role')
  const adminBadge = admin.locator('.sender-role')
  await ownerBadge.waitFor()
  assert.equal((await ownerBadge.innerText()).trim(), '群主')
  assert.equal((await adminBadge.innerText()).trim(), '管理员')
  assert.notEqual(await ownerBadge.locator('svg path').getAttribute('d'), await adminBadge.locator('svg path').getAttribute('d'))
  assert.equal(await page.locator('[data-mid="member"] .sender-role, [data-mid="member"] .tag-toggle').count(), 0)
  const shortTags = page.locator('[data-mid="member"] .tag-preview .mtag')
  assert.equal(await shortTags.count(), 3)
  const shortY = await shortTags.evaluateAll(chips => chips.map(chip => chip.getBoundingClientRect().top))
  assert.equal(new Set(shortY).size, 1, 'a short bubble must not wrap three small tags')
  const tags = owner.locator('.mtag')
  const toggle = owner.getByRole('button', { name: /展开剩余/ })
  const narrowCount = await owner.locator('.tag-preview .mtag').count()
  assert.ok(narrowCount > 0 && narrowCount < 16)
  assert.equal(await toggle.innerText(), `+${16 - narrowCount}`)
  assert.ok(await owner.locator('.tag-preview').evaluate(el => el.scrollWidth <= el.clientWidth))
  assert.equal(await owner.locator('.tag-grid').count(), 0)
  assert.ok((await ownerBadge.boundingBox()).y < (await tags.first().boundingBox()).y)
  await toggle.focus()
  await toggle.press('Enter')
  const collapse = owner.getByRole('button', { name: '收起群标签' })
  await collapse.waitFor()
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true')
  assert.equal(await tags.count(), 16)
  const gridTags = owner.locator('.tag-grid .mtag')
  await page.waitForFunction(() => {
    const inner = document.querySelector('[data-mid="owner"] .tag-reveal-inner')
    return inner?.clientHeight > 0 && inner.clientHeight === inner.scrollHeight
  })
  const rows = await gridTags.evaluateAll(chips => chips.map(chip => chip.getBoundingClientRect().top))
  assert.ok(rows.some(y => rows.filter(row => row === y).length > 2), 'short tags should use more than two columns')
  assert.ok(await gridTags.evaluateAll(chips => chips.every(chip => chip.clientWidth >= chip.scrollWidth)))
  const preview = owner.locator('.tag-preview')
  assert.ok(await preview.evaluate(el => el.clientWidth >= el.scrollWidth))
  assert.equal(await admin.locator('.tag-grid').count(), 0)
  await collapse.click()
  await owner.locator('.tag-grid').waitFor({ state: 'detached' })
  assert.equal(await tags.count(), narrowCount)

  await page.setViewportSize({ width: 1200, height: 760 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForFunction(n => document.querySelectorAll('[data-mid="owner"] .tag-preview .mtag').length > n, narrowCount)
  const wideCount = await owner.locator('.tag-preview .mtag').count()
  assert.ok(wideCount > narrowCount)
  await admin.getByRole('button', { name: /展开剩余/ }).click()
  assert.equal(await admin.locator('.mtag').count(), 16)
  assert.ok(await admin.locator('.tag-toggle svg').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) < 0.001))
  await page.setViewportSize({ width: 360, height: 760 })
  await page.waitForFunction(n => document.querySelectorAll('[data-mid="owner"] .tag-preview .mtag').length === n, narrowCount)
  assert.equal(await admin.locator('.mtag').count(), 16, 'resizing while open keeps all labels')

  const sent = []
  await page.route('**/qa-api/v1/msg/send-message', async route => {
    const body = pb.decode(route.request().postDataBuffer())
    const content = pb.msg(body, 5)
    sent.push({ format: pb.num(body, 6), text: pb.str(content, 1),
      mentions: pb.list(content, 6).map(id => new TextDecoder().decode(id)) })
    await route.fulfill({ json: { code: 1 } })
  })
  await page.evaluate(async () => {
    const { ctx } = window.__qa
    const { apiPlugin } = await import('/src/plugins/api.ts')
    const { adapterPlugin } = await import('/src/plugins/adapter.ts')
    const wire = { set(key, value) { this[key] = value } }
    apiPlugin.apply(wire, { base: '/qa-api' })
    wire.api.setToken('offline-only')
    ctx.api.send = wire.api.send
    adapterPlugin.apply(ctx)
  })
  const composer = page.getByRole('textbox', { name: '聊天消息' })
  const mention = page.getByRole('button', { name: '@他', exact: true })
  await owner.locator('.bubble').click({ button: 'right' })
  assert.equal(await mention.count(), 0)
  await page.keyboard.press('Escape')
  await composer.fill('已有草稿')
  await page.getByRole('button', { name: '消息格式' }).click()
  await page.getByRole('option', { name: 'Markdown', exact: true }).click()
  await owner.locator('.av').click({ button: 'right' })
  await mention.click()
  assert.equal(await composer.inputValue(), '已有草稿 @相同昵称 ')
  assert.ok(await composer.evaluate(el => document.activeElement === el && el.selectionStart === el.value.length))
  await page.keyboard.insertText('收到')
  await composer.press('Enter')
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '')
  assert.deepEqual(sent, [{ format: 3, text: '已有草稿 @相同昵称 收到', mentions: ['owner-id'] }])
  await owner.locator('.av').click({ button: 'right' })
  await mention.click()
  await composer.fill('编辑后取消提及')
  await composer.press('Enter')
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '')
  assert.deepEqual(sent[1], { format: 3, text: '编辑后取消提及', mentions: [] })

  await page.evaluate(async () => {
    const { ctx } = window.__qa
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'pin'))
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'other'))
    window.__qa.resolveOldInfo({ id: 'pin', owner: 'owner-id', admins: [] })
  })
  const switched = page.locator('[data-mid="switched"]')
  await switched.waitFor()
  assert.equal(await switched.locator('.sender-role').count(), 0)
  await page.locator('[data-mid="no-tags"] .sender-role.owner').waitFor()
  assert.equal(await page.locator('[data-mid="no-tags"] .mtags').count(), 0)
  await page.evaluate(() => window.__qa.ctx.group.loadMembers())
  await switched.locator('.sender-role.admin').waitFor()
  await page.evaluate(() => window.__qa.ctx.chat.open({ id: 'direct', type: 1, name: '私聊' }))
  assert.equal(await switched.locator('.sender-role, .mtags').count(), 0)
  await switched.locator('.av').click({ button: 'right' })
  assert.equal(await mention.count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: adaptive single-row tags, packed expansion, SVG roles, group switching and avatar mention IDs')
} finally {
  await browser.close()
  await server.close()
}
