/** Full production startup with isolated data and all external traffic blocked. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const temp = await mkdtemp(join(tmpdir(), 'yh-startup-'))
let browser, child
try {
  await cp(resolve('dist'), join(temp, 'dist'), { recursive: true })
  await writeFile(join(temp, 'yunhu.config.yml'), 'app:\n  theme: dark\nplugins: {}\n')
  const finder = createServer(); await new Promise(r => finder.listen(0, '127.0.0.1', r))
  const port = finder.address().port; await new Promise(r => finder.close(r))
  const root = `http://127.0.0.1:${port}`, capability = 'offline-startup-fixture'
  child = spawn(process.execPath, ['--optimize-for-size', '--max-semi-space-size=4', resolve('src-tauri/resources/server-bundle.mjs')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), HTTPS_PORT: '0', UPSTREAM: 'http://127.0.0.1:1', YH_ROOT: temp, YH_DATA_DIR: join(temp, 'data'), YH_BOT_BRIDGE_SECRET: capability }, stdio: 'ignore',
  })
  let ready = false
  const nonce = 'c'.repeat(64)
  for (let n = 0; n < 100; n++) {
    try {
      const proof = await fetch(root + '/bot-ai/proof?nonce=' + nonce)
      ready = proof.ok && await proof.text() === createHash('sha256').update(nonce + capability).digest('hex')
      if (ready) break
    } catch {}
    await new Promise(r => setTimeout(r, 50))
  }
  assert.ok(ready, 'sidecar identity proof did not become ready')
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === root && !/^\/(api|res|up|update-check)(\/|$)/.test(url.pathname)) return route.continue()
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":-1,"msg":"offline test"}' })
  })
  await page.routeWebSocket('**/*', socket => socket.close())
  await page.goto(root)
  await page.waitForFunction(() => !!window.__yunhu)
  assert.ok(await page.getByText('邮箱登录', { exact: true }).isVisible())
  await page.getByRole('button', { name: 'Token 登录', exact: true }).click()
  await page.getByPlaceholder('粘贴 token').fill('offline-click-check')
  await page.getByRole('button', { name: '邮箱登录', exact: true }).click()
  assert.ok(await page.getByPlaceholder('you@example.com').isEditable())
  assert.equal(await page.evaluate(() => window.__yunhu.app.version), JSON.parse(await readFile('package.json', 'utf8')).version)
  assert.deepEqual(errors, [])
  console.log('PASS: production sidecar proof, real plugin bootstrap and login screen; isolated empty data, external HTTP/WebSocket blocked')
} finally {
  await browser?.close()
  if (child && child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended }
  await rm(temp, { recursive: true, force: true })
}
