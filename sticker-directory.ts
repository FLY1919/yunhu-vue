/** Public read-only directory. Forward only the documented author ID, never account credentials. */
import type { IncomingMessage, ServerResponse } from 'node:http'
export async function stickerDirectory(req: IncomingMessage, res: ServerResponse, search: string) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  if (req.method !== 'GET') { res.writeHead(405, headers).end('{"error":{"message":"需要 GET 请求"}}'); return }
  const id = new URLSearchParams(search).get('author_id') || ''
  if (!/^\d{1,32}$/.test(id)) { res.writeHead(400, headers).end('{"error":{"message":"用户 ID 不正确"}}'); return }
  try {
    const upstream = await fetch('https://yhsticker.us.ci/api/v1/packs?' + new URLSearchParams({ author_id: id, all: 'true' }), { signal: AbortSignal.timeout(15000) })
    const body = await upstream.json()
    if (!upstream.ok) throw new Error(body?.error?.message || '目录服务暂时不可用')
    if (!Array.isArray(body.data)) throw new Error('目录返回格式不正确')
    res.writeHead(200, headers).end(JSON.stringify(body))
  } catch (error: any) { res.writeHead(502, headers).end(JSON.stringify({ error: { message: error.name === 'TimeoutError' ? '表情包目录请求超时，请重试' : error.message } })) }
}
