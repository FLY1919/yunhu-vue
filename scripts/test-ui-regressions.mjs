// Optional browser regression: install Playwright and set CHROMIUM_EXECUTABLE if needed.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { readFile } from 'node:fs/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root, configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message) })
const names = () => page.locator('.convs .cname').allTextContents()
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
  await page.waitForFunction(() => !!window.__qa)
  await page.locator('.convs .cname').first().waitFor()
  assert.deepEqual(await names(), ['另一个置顶', '云湖置顶', '云湖群', '其他会话'])
  assert.equal(await page.locator('.pin-ico').count(), 2)
  assert.equal(await page.locator('.has-unread .cname').count(), 2)
  assert.equal(await page.locator('.convs .badge').count(), 2)
  assert.equal(await page.locator('.convs .muted-unread').count(), 1)
  assert.equal(await page.locator('.convs .badge.muted-unread').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(107, 114, 128)')
  assert.equal(await page.locator('.convs .badge:not(.muted-unread)').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(217, 45, 69)')
  await page.evaluate(async () => { const ctx = window.__qa.ctx; await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'other')) })
  assert.deepEqual(await names(), ['另一个置顶', '云湖置顶', '其他会话', '云湖群'])
  await page.evaluate(() => { window.__qa.ctx.chat.state.current = null; window.__qa.ctx.chat.state.messages = [] })
  console.log('PASS: muted unread badges are grey, normal badges are red, active unpinned conversation follows all pins, no duplicate rows')

  const settings = page.getByRole('button', { name: '账号与配置', exact: true })
  const settingsY = (await settings.boundingBox()).y
  const themeY = (await page.locator('.rail-foot > button').nth(1).boundingBox()).y
  assert.ok(settingsY < themeY)
  await settings.click()
  await page.getByRole('button', { name: '应用配置', exact: true }).click()
  await page.locator('.settings-nav-item.on').filter({ hasText: '应用配置' }).waitFor()
  await page.getByRole('textbox', { name: '搜索设置与功能' }).fill('账号 切换')
  await page.locator('.settings-result').filter({ hasText: '多账号切换与登录' }).click()
  await page.locator('[data-setting-id="saved-accounts"]').waitFor()
  assert.equal(await page.locator('.saved-account').count(), 2)
  await page.getByRole('button', { name: '切换登录', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '切换登录失败' }).waitFor()
  assert.equal(await page.locator('.sb-user').textContent().then(s => s.includes('离线测试')), true)
  assert.equal(await page.locator('svg[aria-label="金币"]').count(), 1)
  await page.getByRole('button', { name: '添加账号', exact: true }).click()
  await page.getByPlaceholder('you@example.com').waitFor()
  await page.getByRole('button', { name: '取消添加', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索设置与功能' }).fill('反撤回')
  await page.locator('.settings-result').filter({ hasText: '反撤回（测试）' }).click()
  await page.locator('#anti-recall').waitFor()
  if (process.env.UI_QA_SCREENSHOTS) { await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, 'settings.png') }) }
  await page.locator('#conversation-pin-mode').selectOption('tabs')
  await page.locator('.rail-btn[title="消息"]').click()
  assert.deepEqual(await names(), ['云湖群', '其他会话'])
  await page.getByRole('tab', { name: /置顶对话/ }).last().click()
  assert.deepEqual(await names(), ['另一个置顶', '云湖置顶'])
  await page.locator('.search input').fill('云湖群')
  assert.deepEqual(await names(), ['云湖群'])
  await page.locator('.search input').press('Enter')
  await page.locator('.gs-item').first().waitFor()
  assert.equal(await page.locator('.gs-item').first().locator('span').textContent(), '云湖群')
  await page.locator('.search input').fill('')
  assert.deepEqual(await names(), ['另一个置顶', '云湖置顶'])
  console.log('PASS: categorized/searchable settings, saved-account detection and failed-switch UI, add-account login, pin mode and search relevance')

  await page.evaluate(async () => {
    const {ctx} = window.__qa
    ctx.chat.setPinMode('top')
    await ctx.chat.open(ctx.chat.state.conversations.find(c => c.id === 'normal'))
  })
  await page.locator('#forced-color').waitFor()
  await page.evaluate(() => { window.__qa.ctx.chat.state.locateId = 'target' })
  await page.locator('[data-mid="target"].locate').waitFor()
  await page.locator('#forced-color span').click()
  assert.equal(await page.locator('[data-mid="target"].locate').count(), 1)
  await page.locator('.composer textarea').click()
  assert.equal(await page.locator('[data-mid="target"].locate, [data-mid="target"].flash').count(), 0)
  const styles = []
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.__qa.ctx.ui.setTheme(theme), theme)
    styles.push(await page.evaluate(() => {
      const div = document.querySelector('#forced-color')
      const text = getComputedStyle(div.querySelector('span')), link = getComputedStyle(div.querySelector('a'))
      return { text: text.color, link: link.color, padding: getComputedStyle(div).padding,
        forced: div.style.color || div.style.background || div.style.opacity,
        tags: [...document.querySelectorAll('.mtag')].map(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })) }
    }))
    if (process.env.UI_QA_SCREENSHOTS) { await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, `${theme}.png`) }) }
  }
  assert.notEqual(styles[0].text, styles[1].text)
  assert.notEqual(styles[0].link, styles[1].link)
  for (const style of styles) {
    assert.equal(style.forced, '')
    assert.equal(style.padding, '12px')
    assert.equal(style.tags.length, 2)
    for (const tag of style.tags) assert.ok(!tag.background.startsWith('rgba('))
  }
  const unsafe = await page.evaluate(() => window.__qa.sanitizeHtml('<script>alert(1)</script><a href="javascript:alert(1)" style="color:black!important">unsafe</a>'))
  assert.ok(!/script|javascript:|color:/i.test(unsafe))
  await page.evaluate(() => {
    const { ctx } = window.__qa
    for (const right of [false, true]) ctx.chat.state.messages.push({
      id: 'video-' + right, type: 10, ts: Date.now(), senderId: 'video-user', sender: '长视频发送者测试', right,
      elements: [{ type: 'video', attrs: { src: 'data:video/mp4;base64,', time: 6, width: 640, height: 360 } }],
    })
  })
  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 860 })
    for (const right of [false, true]) {
      const row = page.locator(`[data-mid="video-${right}"]`)
      await row.scrollIntoViewIfNeeded()
      const geometry = await row.evaluate(el => {
        const row = el.getBoundingClientRect(), video = el.querySelector('video').getBoundingClientRect(),
          meta = el.querySelector('.meta').getBoundingClientRect(), bubble = el.querySelector('.bubble').getBoundingClientRect()
        return { wrap: getComputedStyle(el).flexWrap, row, video, meta, bubble,
          download: el.querySelector('.video-actions button')?.textContent }
      })
      assert.equal(geometry.wrap, 'nowrap')
      assert.ok(geometry.video.left >= geometry.row.left - 1 && geometry.video.right <= geometry.row.right + 1)
      assert.ok(geometry.video.right <= width)
      assert.ok(geometry.meta.bottom <= geometry.video.top + 1)
      assert.ok(geometry.download.includes('下载视频'))
    }
  }
  console.log('PASS: group-scoped sender tags, video/metadata alignment at desktop and narrow widths, visible video download')
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.evaluate(() => window.__qa.ctx.ui.setTheme('dark'))
  const sticker = page.locator('[data-mid="sticker-test"] .sticker')
  await sticker.scrollIntoViewIfNeeded(); await sticker.click()
  assert.equal(await page.evaluate(() => window.__qa.ctx.stickers.packRequests.length), 1)
  assert.equal(await page.locator('.viewer-mask').count(), 0)
  await sticker.click({ modifiers: ['Control'] })
  await page.locator('.viewer-mask').waitFor()
  assert.equal(await page.evaluate(() => window.__qa.ctx.stickers.packRequests.length), 1)
  await page.getByRole('button', { name: '编辑图片', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.ied-preview canvas')?.width === 120)
  await page.getByRole('button', { name: '右转 90°', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.ied-preview canvas')?.width === 80)
  await page.getByRole('button', { name: '关闭图片编辑器', exact: true }).click()
  await page.getByRole('dialog', { name: '放弃图片编辑', exact: true }).waitFor()
  assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.cf-mask')).zIndex) > Number(getComputedStyle(document.querySelector('.ied-mask')).zIndex)))
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '文字标注', exact: true }).click()
  await page.getByRole('textbox', { name: '标注文字', exact: true }).fill('TEST')
  await page.getByRole('button', { name: '添加到选中位置', exact: true }).click()
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.ied-preview canvas'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) return true
    return false
  })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  const beforePixel = await page.locator('.ied-preview canvas').evaluate(el => [...el.getContext('2d').getImageData(0, 0, 1, 1).data])
  await page.getByRole('button', { name: '调色与滤镜', exact: true }).click()
  await page.getByRole('button', { name: '反色', exact: true }).click()
  await page.waitForFunction(pixel => {
    const next = document.querySelector('.ied-preview canvas').getContext('2d').getImageData(0, 0, 1, 1).data
    return next[0] === 255 - pixel[0] && next[1] === 255 - pixel[1] && next[2] === 255 - pixel[2]
  }, beforePixel)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.waitForFunction(pixel => document.querySelector('.ied-preview canvas').getContext('2d').getImageData(0, 0, 1, 1).data[0] === pixel[0], beforePixel)
  if (process.env.UI_QA_SCREENSHOTS) { await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, 'image-editor.png') }) }
  await page.evaluate(() => {
    window.__editSwapFrames = []
    let frames = 0
    const sample = () => {
      const viewer = document.querySelector('.viewer-img')
      if (!document.querySelector('.ied-mask') && viewer) window.__editSwapFrames.push({ complete: viewer.complete, width: viewer.naturalWidth })
      if (++frames < 180) requestAnimationFrame(sample)
    }; requestAnimationFrame(sample)
  })
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存副本', exact: true }).click()
  const download = await exported
  assert.match(download.suggestedFilename(), /_edited\.png$/)
  const bytes = await readFile(await download.path())
  assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10])
  assert.equal(bytes.readUInt32BE(16), 80); assert.equal(bytes.readUInt32BE(20), 120)
  await page.locator('.ied-mask').waitFor({ state: 'detached' })
  assert.ok((await page.evaluate(() => window.__qa.ctx.chat.state.messages.find(m => m.id === 'sticker-test').elements[0].attrs.src)).startsWith('data:image/png'))
  await page.waitForFunction(() => window.__editSwapFrames.length > 0)
  assert.ok((await page.evaluate(() => window.__editSwapFrames)).every(f => f.complete && f.width > 0), 'closing the editor must not expose an undecoded/blank preview')
  await page.locator('.viewer-bar button[title="关闭"]').click()
  console.log('PASS: ordinary/Ctrl sticker clicks remain distinct, actual image edits and undo work, exported PNG has correct rotated dimensions and leaves original message intact')

  await page.getByRole('button', { name: '通讯录', exact: true }).click()
  await page.locator('.contact-card').first().waitFor()
  assert.equal(await page.locator('.contact-card').count(), 6)
  assert.equal(await page.locator('.contact-form').count(), 0)
  await page.getByRole('textbox', { name: '搜索联系人' }).fill('ｆｕｔｕｒｅ')
  await page.waitForFunction(() => document.querySelectorAll('.contact-card').length === 1)
  assert.equal(await page.locator('.contact-info h3').textContent(), 'Future Tasks')
  await page.getByRole('textbox', { name: '搜索联系人' }).fill('')
  await page.waitForFunction(() => document.querySelectorAll('.contact-card').length === 6)
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.__qa.ctx.ui.setTheme(theme), theme)
    if (process.env.UI_QA_SCREENSHOTS) { await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, `contacts-${theme}.png`) }) }
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(hasHorizontalOverflow, false)
  }
  await page.getByRole('button', { name: '创建群聊', exact: true }).click()
  await page.getByRole('textbox', { name: '群名称', exact: true }).fill('离线测试群')
  await page.locator('.contact-form button[type="submit"]').click()
  await page.locator('.contact-form').waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 420, height: 860 })
  if (process.env.UI_QA_SCREENSHOTS) { await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await page.screenshot({ path: resolve(process.env.UI_QA_SCREENSHOTS, 'contacts-mobile.png') }) }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.locator('.contact-tabs button').nth(1).click()
  await page.getByRole('button', { name: '给 云湖群 发消息', exact: true }).click()
  await page.locator('[data-mid="target"]').waitFor()
  assert.equal(await page.evaluate(() => window.__qa.ctx.console.state.currentPage), '/')
  console.log('PASS: redesigned contacts search handles full-width/lowercase input, forms collapse, both themes and mobile fit, chat action navigates to the matching conversation')
  assert.deepEqual(errors, [])
  console.log('PASS: reference highlight dismissal, theme-following sanitized HTML/links, opaque group tags, no runtime exceptions')
} finally { await browser.close(); await server.close() }
