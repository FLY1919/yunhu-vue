import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
const temp = await mkdtemp(join(tmpdir(), 'yh-userbot-sidecar-'))
let received
const upstream = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  received = { url: req.url, headers: req.headers, body: JSON.parse(body) }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'answer fake-secret' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }))
})
await new Promise(r => upstream.listen(0, '127.0.0.1', r))
const portFinder = http.createServer(); await new Promise(r => portFinder.listen(0, '127.0.0.1', r)); const port = portFinder.address().port; await new Promise(r => portFinder.close(r))
const child = spawn(process.execPath, [resolve('src-tauri/resources/server-bundle.mjs')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), HTTPS_PORT: '0', YH_ROOT: temp, YH_DATA_DIR: join(temp, 'data'), YH_BOT_BRIDGE_SECRET: 'test-capability' }, stdio: 'ignore' })
try {
  const root = `http://127.0.0.1:${port}`; let ready = false
  for (let i = 0; i < 100; i++) { try { const r = await fetch(root + '/data/session'); if (r.ok) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 50)) }
  assert.equal(ready, true, 'sidecar did not start')
  const nonce = 'c'.repeat(64), proof = await fetch(root + '/bot-ai/proof?nonce=' + nonce)
  assert.equal(await proof.text(), createHash('sha256').update(nonce + 'test-capability').digest('hex'))
  const payload = { url: `http://127.0.0.1:${upstream.address().port}/v1/chat/completions`, format: 'openai', method: 'POST', key: 'fake-secret', payload: { model: 'fake-model', messages: [{ role: 'user', content: 'hello' }] } }
  const denied = await fetch(root + '/bot-ai/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  assert.equal(denied.status, 403)
  const response = await fetch(root + '/bot-ai/request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-yh-bot-capability': 'test-capability' }, body: JSON.stringify(payload) })
  const result = await response.json()
  assert.equal(result.status, 200); assert.equal(received.headers.authorization, 'Bearer fake-secret')
  assert.equal(received.body.model, 'fake-model'); assert.equal(result.data.choices[0].message.content, 'answer [已隐藏]')
  const privateRoute = await fetch(root + '/data/userbots'); assert.equal(privateRoute.status, 404)
  console.log('PASS: built sidecar authenticates its process, rejects unauthorized calls, forwards provider requests and redacts echoed keys')
} finally { child.kill(); await new Promise(r => child.once('exit', r)); await new Promise(r => upstream.close(r)); await rm(temp, { recursive: true, force: true }) }
