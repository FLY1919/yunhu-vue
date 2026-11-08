/** Desktop-only outbound AI requests. A random process capability gates this endpoint. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'

const MAX_INPUT = 1024 * 1024
const MAX_OUTPUT = 4 * 1024 * 1024
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const loopback = (s: string) => s === '127.0.0.1' || s === '::1' || s === '::ffff:127.0.0.1'
function authorized(req: IncomingMessage, secret: string): boolean {
  if (!secret || !loopback(req.socket.remoteAddress || '')) return false
  const received = String(req.headers['x-yh-bot-capability'] || '')
  const a = Buffer.from(secret), b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function handleAiProof(req: IncomingMessage, res: ServerResponse, secret: string, nonce: string): void {
  if (req.method !== 'GET' || !secret || !loopback(req.socket.remoteAddress || '') || !/^[0-9a-f]{64}$/.test(nonce)) { res.writeHead(403).end(); return }
  const proof = createHash('sha256').update(nonce + secret).digest('hex')
  res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(proof) }).end(proof)
}
async function input(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > MAX_INPUT) throw new Error('请求内容过大'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function handleAiBridge(req: IncomingMessage, res: ServerResponse, secret: string): Promise<void> {
  const finish = (status: number, body: unknown) => { if (!res.headersSent) res.writeHead(status, jsonHeaders); if (!res.writableEnded) res.end(JSON.stringify(body)) }
  if (req.method !== 'POST' || !authorized(req, secret)) { finish(403, { error: '安全连接不可用，请重启桌面客户端' }); return }
  let key = ''
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const body = await input(req)
    const url = new URL(String(body.url || ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('服务地址无效')
    if (!['openai', 'anthropic'].includes(body.format)) throw new Error('接口格式无效')
    if (!['GET', 'POST'].includes(body.method)) throw new Error('请求方法无效')
    key = String(body.key || '')
    if (key.length > 8192 || /[\r\n]/.test(key)) throw new Error('API Key 格式无效')
    const headers: Record<string, string> = { 'accept': 'application/json', 'content-type': 'application/json' }
    let authMode = body.authMode || 'default'
    if (!['default', 'bearer', 'x-api-key', 'api-key', 'none'].includes(authMode)) throw new Error('认证方式无效')
    if (authMode === 'default') authMode = body.format === 'anthropic' ? 'x-api-key' : 'bearer'
    if (key && authMode !== 'none') {
      if (authMode === 'bearer') headers.authorization = `Bearer ${key}`
      else headers[authMode] = key
    }
    if (body.format === 'anthropic') headers['anthropic-version'] = String(body.anthropicVersion || '2023-06-01').replace(/[^\d-]/g, '').slice(0, 10)
    const timeout = Math.max(1000, Math.min(Number(body.timeoutMs) || 60000, 300000))
    timer = setTimeout(() => controller.abort(), timeout)
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    const upstream = await fetch(url, { method: body.method, headers, body: body.method === 'POST' ? JSON.stringify(body.payload || {}) : undefined,
      redirect: 'error', signal: controller.signal })
    const reader = upstream.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0
    if (reader) for (;;) {
      const next = await reader.read(); if (next.done) break
      length += next.value.length
      if (length > MAX_OUTPUT) { await reader.cancel(); throw new Error('服务返回内容过大') }
      chunks.push(next.value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    let data: any
    try { data = JSON.parse(text) } catch { data = { error: { message: '服务未返回有效 JSON' } } }
    // Do not forward credentials if a compatible endpoint happens to echo them.
    if (!upstream.ok) {
      const detail = String(data?.error?.message || data?.message || `HTTP ${upstream.status}`).slice(0, 1200)
      finish(200, { status: upstream.status, data: { error: { message: key ? detail.split(key).join('[已隐藏]') : detail } } })
    } else {
      const redact = (value: any): any => {
        if (typeof value === 'string') return key ? value.split(key).join('[已隐藏]') : value
        if (Array.isArray(value)) return value.map(redact)
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
        return value
      }
      finish(200, { status: upstream.status, data: redact(data) })
    }
  } catch (e: any) {
    const message = e?.name === 'AbortError' ? '请求超时或已取消' : String(e?.message || '网络请求失败')
    finish(502, { error: key ? message.split(key).join('[已隐藏]') : message })
  } finally { if (timer) clearTimeout(timer) }
}
