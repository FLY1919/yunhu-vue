/** Production sidecar integration, temporary data only; no real account or upstream API. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import net from 'node:net'
const folder = await mkdtemp(join(tmpdir(), 'yh-image-save-'))
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const child = spawn(process.execPath, ['src-tauri/resources/server-bundle.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), HTTPS_PORT: '0', YH_ROOT: folder, YH_DATA_DIR: join(folder, 'data'), YH_FILE_DIR: join(folder, 'images') }, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('sidecar startup timed out')), 10000)
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('http://127.0.0.1:')) { clearTimeout(timeout); resolve() } })
  child.once('error', reject); child.once('exit', code => { clearTimeout(timeout); reject(new Error('sidecar exited ' + code)) })
})
const url = `http://127.0.0.1:${port}`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64')
const headers = { token: 'offline-test-only', 'content-type': 'image/png', origin: url }
try {
  const post = async (name, options = {}) => fetch(url + '/local-save-image?name=' + encodeURIComponent(name), { method: 'POST', headers, body: png, ...options })
  const first = await post('image_edited.png'); assert.equal(first.status, 200)
  const firstFile = await first.json(); assert.equal(dirname(firstFile.path), join(folder, 'images')); assert.deepEqual(await readFile(firstFile.path), png)
  const secondFile = await (await post('image_edited.png')).json(); assert.notEqual(secondFile.path, firstFile.path)
  assert.deepEqual(await readFile(firstFile.path), png)
  const traversed = await (await post('../../outside.png')).json(); assert.equal(dirname(traversed.path), join(folder, 'images'))
  assert.equal((await post('bad.png', { body: 'not an image' })).status, 415)
  assert.equal((await post('no-token.png', { headers: { 'content-type': 'image/png' } })).status, 403)
  assert.equal((await post('cross-origin.png', { headers: { ...headers, origin: 'https://example.invalid' } })).status, 403)
  assert.equal((await fetch(url + '/local-save-image')).status, 405)
  const gif = await readFile('scripts/ui-fixture/animated.gif')
  const animated = await post('animation_edited.gif', { body: gif, headers: { ...headers, 'content-type': 'image/gif' } })
  assert.equal(animated.status, 200)
  const animatedFile = await animated.json(); assert.ok(animatedFile.path.endsWith('.gif')); assert.deepEqual(await readFile(animatedFile.path), gif)
  assert.equal((await post('fake.gif', { body: png, headers: { ...headers, 'content-type': 'image/gif' } })).status, 415)
  assert.equal((await fetch(url + '/sticker-directory?author_id=not-valid')).status, 400)
  const savedAccounts = { version: 1, items: [{ id: 'offline-a', token: 'offline-only' }] }
  assert.equal((await fetch(url + '/data/accounts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(savedAccounts) })).status, 200)
  assert.deepEqual(await (await fetch(url + '/data/accounts')).json(), savedAccounts)
  console.log('PASS: production image copy bytes, collision handling, path containment, invalid/unauthorized/cross-origin requests and account-vault persistence')
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', resolve) })
  await rm(folder, { recursive: true, force: true })
}
