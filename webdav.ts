/**
 * WebDAV 网关：把「云湖群网盘」挂成标准 WebDAV，任何文件管理器都能直接浏览/下载/上传。
 *
 * 认证：HTTP Basic
 *   user = 群聊 ID（留空 / 填 `all` 就是全部群）
 *   pass = 你的云湖 token
 * 路径：
 *   /webdav/               → 列出你加入的所有群（每个群一个文件夹）
 *   /webdav/<群ID>/        → 该群网盘根目录
 *   /webdav/<群ID>/子目录/文件.pdf
 *
 * 已实现：OPTIONS / PROPFIND(Depth 0,1) / GET / HEAD / PUT 上传 / MKCOL 建目录 / DELETE
 */
import https from 'node:https'
import crypto from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API_HOST = 'chat-go.jwzhd.com'

/* ================= 极简 protobuf 解码（只为读会话列表里的群名） ================= */

function pbDecode(buf: Buffer): Record<number, any[]> {
  const out: Record<number, any[]> = {}
  let i = 0
  const rv = () => {
    let s = 0, sh = 0
    while (i < buf.length) {
      const b = buf[i++]
      s |= (b & 0x7f) << sh
      if (!(b & 0x80)) break
      sh += 7
    }
    return s
  }
  while (i < buf.length) {
    const tag = rv(), f = tag >> 3, w = tag & 7
    let v: any
    if (w === 0) v = rv()
    else if (w === 2) { const n = rv(); v = buf.subarray(i, i + n); i += n }
    else if (w === 5) { v = buf.subarray(i, i + 4); i += 4 }
    else if (w === 1) { v = buf.subarray(i, i + 8); i += 8 }
    else break
    ;(out[f] = out[f] || []).push(v)
  }
  return out
}
const pbStr = (d: Record<number, any[]>, f: number) => {
  const v = d[f]?.[0]
  return v && Buffer.isBuffer(v) ? v.toString('utf8') : v !== undefined ? String(v) : ''
}
const pbNum = (d: Record<number, any[]>, f: number) => Number(d[f]?.[0] ?? 0)
const pbList = (d: Record<number, any[]>, f: number) => d[f] || []

/* ================= 上游调用 ================= */

function apiReq(method: string, path: string, token: string, body?: Buffer, ctype = 'application/json') {
  return new Promise<{ status: number; buf: Buffer }>((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0)
    const req = https.request({
      hostname: API_HOST, port: 443, method, path,
      headers: {
        token,
        ...(payload.length ? { 'Content-Type': ctype, 'Content-Length': payload.length } : {}),
        origin: 'https://www.yunhu.chat', referer: 'https://www.yunhu.chat/',
      },
    }, (r) => {
      const chunks: Buffer[] = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => resolve({ status: r.statusCode || 500, buf: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.setTimeout(60000, () => req.destroy(new Error('upstream timeout')))
    req.end(payload)
  })
}

async function apiJson(path: string, token: string, body: any) {
  const r = await apiReq('POST', path, token, Buffer.from(JSON.stringify(body ?? {})))
  let j: any
  try { j = JSON.parse(r.buf.toString('utf8') || '{}') } catch { throw new Error('上游返回非 JSON') }
  if (j.code !== 1) throw new Error(j.msg || ('code=' + j.code))
  return j.data ?? {}
}

/**
 * 我加入的群。
 * 用 /v1/friend/address-book-list（结构已对齐过 full.proto）：
 *   Response.data(2) = 一组 { list_name(1), data(2), chat_type(3) }
 *   chat_type = 2 就是「我加入的群聊」
 *   DataList { chat_id=1, remark=2, avatar_url=3, permission=4, no_disturb=5, name=8 }
 */
async function myGroups(token: string) {
  const r = await apiReq('POST', '/v1/friend/address-book-list', token, Buffer.alloc(0))
  const out: Array<{ id: string; name: string }> = []
  try {
    for (const sb of pbList(pbDecode(r.buf), 2)) {
      const sec = pbDecode(sb)
      if (pbNum(sec, 3) !== 2) continue          // 只要群聊那一段
      for (const gb of pbList(sec, 2)) {
        const g = pbDecode(gb)
        const id = pbStr(g, 1)
        if (id) out.push({ id, name: pbStr(g, 8) || pbStr(g, 2) || id })
      }
    }
  } catch { /* 解不出来就返回空 */ }
  return out
}

async function listDir(chatId: string, token: string, folderId: number) {
  const d = await apiJson('/v1/disk/file-list', token, { chatId, chatType: 2, folderId, sort: 'name_asc' })
  return (d.list || []).map((x: any) => ({
    id: x.id, name: x.name, size: x.fileSize || 0,
    isFolder: x.objectType === 1,
    mtime: (x.uploadTime || 0) * 1000,
    url: x.qiniuKey || '',
    by: x.uploadByName || '',
  }))
}

async function resolvePath(chatId: string, token: string, segs: string[]) {
  let folderId = 0
  for (const seg of segs.slice(0, -1)) {
    const list = await listDir(chatId, token, folderId)
    const hit = list.find((x: any) => x.isFolder && x.name === seg)
    if (!hit) return null
    folderId = hit.id
  }
  return folderId
}

/* ================= 上传（PUT） ================= */

async function uploadToQiniu(token: string, key: string, data: Buffer, contentType: string) {
  const r = await apiReq('GET', '/v1/misc/qiniu-token2', token)
  const upToken = JSON.parse(r.buf.toString('utf8') || '{}')?.data?.token
  if (!upToken) throw new Error('未取得上传 token')

  const seg = String(upToken).split(':')
  const ak = seg[0] || ''
  let bucket = ''
  try {
    const b64 = (seg[2] || '').replace(/-/g, '+').replace(/_/g, '/')
    bucket = String(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).scope || '').split(':')[0]
  } catch { /* 用默认域名 */ }

  // 查该 bucket 的上传域名（失败就用默认，再靠“incorrect region”重试兜底）
  let host = 'upload.qiniup.com'
  if (ak && bucket) {
    try {
      const q = await fetchJson(`https://api.qiniu.com/v4/query?ak=${ak}&bucket=${bucket}`)
      const d = q?.up?.domains?.[0] || q?.up?.acc?.domains?.[0] || q?.up?.src?.domains?.[0]
      if (d) host = String(d).replace(/^https?:\/\//, '')
    } catch { /* 忽略 */ }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const fd = new FormData()
    fd.append('token', upToken)
    fd.append('key', key)
    fd.append('file', new Blob([new Uint8Array(data)], { type: contentType || 'application/octet-stream' }), key)
    const res = await fetch(`https://${host}/`, { method: 'POST', body: fd })
    const txt = await res.text()
    if (res.ok) return key
    const m = txt.match(/please use\s+([a-z0-9.-]+)/i)
    if (m) { host = m[1]; continue }        // 区域不对，跟随重试
    throw new Error('七牛上传失败：' + txt.slice(0, 160))
  }
  throw new Error('七牛上传失败：区域重试次数用尽')
}

function fetchJson(url: string) {
  return new Promise<any>((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'yunhu-webdav/1.0' } }, (r) => {
      const c: Buffer[] = []
      r.on('data', (x) => c.push(x))
      r.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

function readBody(req: any, max = 200 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let len = 0
    req.on('data', (c: Buffer) => {
      len += c.length
      if (len > max) { req.destroy(); reject(new Error('文件过大')) ; return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/* ================= XML ================= */

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string))
const httpDate = (ms: number) => new Date(ms || Date.now()).toUTCString()

function entry(href: string, isFolder: boolean, size: number, mtime: number, name?: string) {
  const nm = name || decodeURIComponent(href.split('/').filter(Boolean).pop() || '')
  return `  <D:response>
    <D:href>${esc(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${esc(nm)}</D:displayname>
        <D:getlastmodified>${httpDate(mtime)}</D:getlastmodified>
        <D:getcontentlength>${isFolder ? 0 : size}</D:getcontentlength>
        <D:resourcetype>${isFolder ? '<D:collection/>' : ''}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
}



/* ================= 挂载密码缓存 =================
 * 云湖的 /v1/mount-setting/list **不下发**挂载密码（webdavPassword 恒为空串），
 * 所以客户端拿不到、无法自动认证。解决办法：用户在本客户端输一次，
 * 服务端按「挂载 ID」记住，之后浏览该挂载盘时自动带上，不用重复输入。
 * 存的是明文（和浏览器保存密码一个性质），只落在本机 yunhu.mountpwd.json。
 */
const PWD_FILE = join(process.cwd(), 'yunhu.mountpwd.json')
let pwdCache: Record<string, string> = {}
try {
  if (existsSync(PWD_FILE)) pwdCache = JSON.parse(readFileSync(PWD_FILE, 'utf8') || '{}')
} catch { pwdCache = {} }

function savePwd(mountId: string, pwd: string) {
  pwdCache[String(mountId)] = pwd
  try { writeFileSync(PWD_FILE, JSON.stringify(pwdCache, null, 2)) } catch { /* 忽略 */ }
}
function getPwd(mountId: string): string { return pwdCache[String(mountId)] || '' }
function hasPwd(mountId: string): boolean { return !!pwdCache[String(mountId)] }

/* ================= 第三方网盘挂载代理 ================= */

/** 列出某个群挂了哪些第三方网盘 */
async function mountList(groupId: string, token: string) {
  const r = await apiReq('POST', '/v1/mount-setting/list', token,
    Buffer.from(JSON.stringify({ groupId })), 'application/json')
  const j = JSON.parse(r.buf.toString('utf8') || '{}')
  return j?.data?.list || []
}

/** 用浏览器打开挂载盘时，渲染成 HTML 目录（而不是吐一堆 XML） */
function renderHtml(res: any, m: any, chatId: string, sub: string[], entries: any[], basePath: string, pwd = '', typed = '') {
  const esc = (x: any) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const up = sub.length ? `<a href="${basePath.replace(/[^/]+\/?$/, '')}">↑ 上级</a>` : ''
  const rows = entries.map((e) => {
    const name = e.href.split('/').filter(Boolean).pop() || ''
    const isDir = e.isDir
    return `<tr><td>${isDir ? '📁' : '📄'}</td><td><a href="${basePath.replace(/\/?$/, '')}/${encodeURIComponent(name)}${isDir ? '/' : ''}">${esc(name)}</a></td><td>${e.size || ''}</td><td>${esc(e.mtime || '')}</td></tr>`
  }).join('\n')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.mountName)} - 云湖群网盘</title>
<style>body{font:14px/1.6 system-ui,sans-serif;background:#17181f;color:#e6e6e6;padding:20px}a{color:#5a8cf8;text-decoration:none}a:hover{text-decoration:underline}table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;border-bottom:1px solid #2a2c36;text-align:left}h1{font-size:18px}code{background:#22242e;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>🔗 ${esc(m.mountName)}</h1><p>群 <code>${esc(chatId)}</code> 挂载的第三方网盘 · <code>${esc(m.webdavUrl)}</code></p>
<p>${up} <a href="/webdav/${esc(chatId)}/">返回群网盘根目录</a></p>
<table><thead><tr><th></th><th>名称</th><th>大小</th><th>修改时间</th></tr></thead><tbody>${rows}</tbody></table>
${entries.length ? '' : `<div style="margin-top:16px;padding:12px;border:1px solid #2a2c36;border-radius:8px">
<p>目录是空的。如果这个盘需要密码，在这里输一次就能浏览（云湖接口不把挂载密码下发到客户端）：</p>
<form method="get"><input name="pwd" type="password" placeholder="盘密码" value="${esc(typed)}" style="background:#22242e;border:1px solid #2a2c36;color:#eee;padding:5px 8px;border-radius:6px">
<button style="padding:5px 12px;border-radius:6px;border:1px solid #2a2c36;background:#2a2c36;color:#eee;cursor:pointer">进入</button></form></div>`}
<p style="color:#888;margin-top:18px">想当磁盘用？在资源管理器里挂：<code>${esc(m.webdavUrl)}</code></p></body></html>`)
}

/** 对目标挂载盘做一次 PROPFIND，解析出条目 */
function propfindEntries(m: any, path: string, pwdIn = ''): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const base = String(m.webdavUrl || '').replace(/\/+$/, '')
    const target = base + '/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/'
    const u = new URL(target)
    const r2 = https.request({
      hostname: u.hostname, port: u.port || 443, method: 'PROPFIND', path: u.pathname + u.search,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${m.webdavUserName || ''}:${pwdIn || m.webdavPassword || ''}`).toString('base64'),
        Depth: '1', 'User-Agent': 'yunhu-webdav/1.0', 'Content-Type': 'application/xml',
      },
    }, (up) => {
      const out: Buffer[] = []
      up.on('data', (c) => out.push(c))
      up.on('end', () => {
        const xml = Buffer.concat(out).toString('utf8')
        const entries: any[] = []
        for (const b of xml.split(/<[Dd]:response>/).slice(1)) {
          const href = (b.match(/<[Dd]:href>([^<]*)<\/[Dd]:href>/) || [])[1] || ''
          if (!href) continue
          const decoded = decodeURIComponent(href).replace(/\/+$/, '')
          if (decoded === u.pathname.replace(/\/+$/, '')) continue
          entries.push({
            href, isDir: /<[Dd]:collection\s*\/>/.test(b),
            size: Number((b.match(/<[Dd]:getcontentlength>([^<]*)</) || [])[1] || 0) || '',
            mtime: (b.match(/<[Dd]:getlastmodified>([^<]*)</) || [])[1] || '',
          })
        }
        resolve(entries)
      })
    })
    r2.on('error', reject)
    r2.setTimeout(20000, () => r2.destroy(new Error('挂载盘超时')))
    r2.end()
  })
}

/** 把 WebDAV 请求转发到目标第三方网盘（带 Basic 认证） */
async function proxyMount(req: any, res: any, m: any, sub: string[], pwdIn = ''): Promise<boolean> {
  // 云湖不把挂载密码给客户端（接口里 webdavPassword 是空串），
  // 所以密码盘只能由用户临时输一次 —— 通过 ?pwd= 传进来用。
  const pwd = pwdIn || String(m.webdavPassword || '')
  const base = String(m.webdavUrl || '').replace(/\/+$/, '')
  if (!base) { res.writeHead(500, { 'Content-Type': 'text/plain' }).end('挂载没有配地址'); return true }

  // 浏览器访问（GET 且 Accept 带 text/html）→ 渲染成目录页；WebDAV 客户端 → 原样代理
  const wantsHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html')
  if (wantsHtml) {
    try {
      const root = String(m.webdavRootPath || '').replace(/^\/+|\/+$/g, '')
      const entries = await propfindEntries(m, [root, ...sub].filter(Boolean).join('/'), pwd)
      const sid = String(m.groupId || req.headers['x-yh-group'] || '')
      const basePath = `/webdav/${sid}/@mount/${m.id}/` + sub.map(encodeURIComponent).join('/')
      // 用户临时输入的密码从 query 里取（proxyMount 的 pwdIn 就是它）
      return renderHtml(res, m, sid, sub, entries, basePath, pwd, pwdIn), true
    } catch (e: any) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h1>挂载盘访问失败</h1><p>${String(e.message)}</p>`)
      return true
    }
  }
  const root = String(m.webdavRootPath || '').replace(/^\/+|\/+$/g, '')
  const path = [root, ...sub].filter(Boolean).join('/')
  const target = base + '/' + path.split('/').map(encodeURIComponent).join('/') + (sub.length && !path.endsWith('/') ? '' : '/')

  const auth = 'Basic ' + Buffer.from(`${m.webdavUserName || ''}:${pwd}`).toString('base64')
  const headers: Record<string, string> = {
    Authorization: auth,
    Depth: String(req.headers.depth ?? '1'),
    'User-Agent': 'yunhu-webdav/1.0',
  }
  if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type'])

  return await new Promise<boolean>((resolve) => {
    let body: Buffer | undefined
    if (req.method === 'PUT' || req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => { body = Buffer.concat(chunks); go() })
      return
    }
    go()

    function go() {
      const u = new URL(target)
      const r2 = https.request({
        hostname: u.hostname, port: u.port || 443, method: req.method, path: u.pathname + u.search,
        headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) },
      }, (up) => {
        const out: Buffer[] = []
        up.on('data', (c) => out.push(c))
        up.on('end', () => {
          const h: Record<string, string> = { 'Access-Control-Allow-Origin': '*' }
          const ct = String(up.headers['content-type'] || 'application/octet-stream')
          h['Content-Type'] = ct
          // 目标返回的 XML/JSON 直接透传；GET 大文件也直接透传
          res.writeHead(up.statusCode || 502, h)
          res.end(req.method === 'HEAD' ? undefined : Buffer.concat(out))
          resolve(true)
        })
      })
      r2.on('error', (e) => {
        try { res.writeHead(502, { 'Content-Type': 'text/plain' }).end('挂载盘访问失败：' + e.message) } catch { /* 忽略 */ }
        resolve(true)
      })
      r2.setTimeout(30000, () => r2.destroy(new Error('挂载盘超时')))
      if (body) r2.end(body); else r2.end()
    }
  })
}


/* ================= 给前端「页内浏览」用的 JSON 接口 ================= */

/**
 * GET /mount-json?gid=<群ID>&mid=<挂载ID>&path=<子路径>&pwd=<密码>
 * 返回目标挂载盘某目录的条目（前端在群文件面板里直接渲染，不跳转）。
 */
export async function handleMountJson(req: any, res: any, url: URL): Promise<boolean> {
  if (url.pathname !== '/mount-json') return false
  const json = (code: number, data: any) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(data))
  }
  try {
    const gid = String(url.searchParams.get('gid') || '')
    const mid = String(url.searchParams.get('mid') || '')
    const path = String(url.searchParams.get('path') || '')
    const pwd = String(url.searchParams.get('pwd') || '')
    const token = String(req.headers.token || url.searchParams.get('token') || '')
    if (!gid || !mid || !token) return json(400, { ok: false, msg: '缺 gid / mid / token' }), true

    const mounts = await mountList(gid, token)
    const m = mounts.find((x: any) => String(x.id) === String(mid))
    if (!m) return json(404, { ok: false, msg: '没有这个挂载' }), true

    const root = String(m.webdavRootPath || '').replace(/^\/+|\/+$/g, '')
    // 用「用户这次输的 > 已缓存的 > 云湖下发的」这个顺序取密码
    const effectivePwd = pwd || getPwd(mid) || String(m.webdavPassword || '')
    // 如果带 save=1，就把这次的密码记下来，以后自动用
    if (pwd && url.searchParams.get('save') === '1') savePwd(mid, pwd)
    const entries = await propfindEntries(m, [root, path].filter(Boolean).join('/'), effectivePwd)
    return json(200, {
      ok: true,
      name: m.mountName,
      url: m.webdavUrl,
      needPassword: !effectivePwd && entries.length === 0,
      hasSavedPassword: hasPwd(mid),
      entries: entries.map((e: any) => ({
        name: decodeURIComponent(String(e.href).split('/').filter(Boolean).pop() || ''),
        isDir: e.isDir, size: e.size, mtime: e.mtime,
      })),
    }), true
  } catch (e: any) {
    return json(200, { ok: false, msg: String(e?.message || e) }), true
  }
}

/* ================= 入口 ================= */

export async function handleWebdav(req: any, res: any, pathname: string, search: string): Promise<boolean> {
  if (pathname !== '/webdav' && !pathname.startsWith('/webdav/')) return false

  const send = (code: number, body = '', headers: Record<string, string> = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  if (req.method === 'OPTIONS') {
    return send(200, '', { DAV: '1,2', Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE', 'MS-Author-Via': 'DAV' }), true
  }

  // --- 认证 ---
  let user = '', token = ''
  const auth = String(req.headers.authorization || '')
  if (auth.startsWith('Basic ')) {
    const [u, p] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')
    user = decodeURIComponent(u || ''); token = p || ''
  }
  const q = new URLSearchParams(search || '')
  if (!token) token = q.get('token') || ''
  if (!user) user = q.get('chatId') || ''
  if (!token) {
    return send(401, '需要认证：user = 群聊 ID（或 all），pass = 云湖 token', { 'WWW-Authenticate': 'Basic realm="yunhu-webdav"' }), true
  }

  let segs = pathname.replace(/^\/webdav\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (segs.length && /^\d{5,}$/.test(segs[0])) { user = segs[0]; segs = segs.slice(1) }

  try {
    /* ---------- 根目录：列出所有群 ---------- */
    if (!user || user === 'all') {
      if (req.method !== 'PROPFIND') return send(405, '根目录只支持 PROPFIND，请进入 /webdav/<群ID>/'), true
      const groups = await myGroups(token)
      const parts = ['<?xml version="1.0" encoding="utf-8"?>', '<D:multistatus xmlns:D="DAV:">',
        entry('/webdav/', true, 0, Date.now(), '云湖群网盘')]
      for (const g of groups) {
        parts.push(entry('/webdav/' + g.id + '/', true, 0, Date.now(), `${g.name} (${g.id})`))
      }
      parts.push('</D:multistatus>')
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
      res.end(parts.join('\n'))
      return true
    }

    const chatId = user

    /* ---------- 第三方网盘挂载（群网盘里挂的 WebDAV） ----------
     * 路径形如 /webdav/<群ID>/@mount/<挂载ID>/子路径
     * 我们把请求原样转发到目标 WebDAV，并带上挂载时存的账号密码
     * （这样 Windows 资源管理器 / Finder 里能直接点进去浏览那个挂载盘）
     */
    if (segs[0] === '@mount') {
      const url0 = new URL((req.url || '/') as string, 'http://localhost')
      const mountId = segs[1]
      const sub = segs.slice(2)
      if (!mountId) return send(400, '缺少挂载 ID'), true
      let mounts: any[] = []
      try { mounts = await mountList(chatId, token) } catch (e: any) { return send(500, '读取挂载失败：' + e.message), true }
      const m = mounts.find((x: any) => String(x.id) === String(mountId))
      if (!m) return send(404, '没有这个挂载'), true
      return await proxyMount(req, res, m, sub, url0.searchParams.get('pwd') || ''), true
    }

    /* ---------- 列目录 / 属性 ---------- */
    if (req.method === 'PROPFIND') {
      const depth = String(req.headers.depth ?? '1')
      const folderId = await resolvePath(chatId, token, segs)
      if (folderId === null) return send(404, '路径不存在'), true
      const list = await listDir(chatId, token, folderId)
      const last = segs[segs.length - 1]
      const mine = last ? list.find((x: any) => x.name === last) : null
      const selfPath = '/webdav/' + chatId + '/' + segs.map(encodeURIComponent).join('/')
      const parts = ['<?xml version="1.0" encoding="utf-8"?>', '<D:multistatus xmlns:D="DAV:">']
      if (mine && !mine.isFolder) {
        parts.push(entry(selfPath, false, mine.size, mine.mtime))
      } else {
        parts.push(entry(selfPath.replace(/\/?$/, '/'), true, 0, Date.now(), segs[segs.length - 1] || chatId))
        if (depth !== '0') {
          for (const it of list) {
            parts.push(entry(selfPath.replace(/\/?$/, '/') + encodeURIComponent(it.name), it.isFolder, it.size, it.mtime, it.name))
          }
          // 根目录额外列出「第三方网盘挂载」，这样在资源管理器里能直接点进去
          if (!segs.length) {
            try {
              for (const m of await mountList(chatId, token)) {
                parts.push(entry(`${selfPath.replace(/\/?$/, '/')}@mount/${m.id}/`, true, 0, Date.now(), `🔗 ${m.mountName}`))
              }
            } catch { /* 没权限就不列 */ }
          }
        }
      }
      parts.push('</D:multistatus>')
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
      res.end(parts.join('\n'))
      return true
    }

    /* ---------- 下载 ---------- */
    if (req.method === 'GET' || req.method === 'HEAD') {
      const folderId = await resolvePath(chatId, token, segs)
      if (folderId === null) return send(404, '路径不存在'), true
      const list = await listDir(chatId, token, folderId)
      const f = list.find((x: any) => x.name === segs[segs.length - 1])
      if (!f) return send(404, '文件不存在'), true
      if (f.isFolder) return send(405, '这是文件夹'), true
      res.writeHead(302, { Location: '/res/' + String(f.url).replace(/^https?:\/\//, ''), 'Content-Length': '0' })
      res.end()
      return true
    }

    /* ---------- 上传 ---------- */
    if (req.method === 'PUT') {
      const folderId = await resolvePath(chatId, token, segs)
      const name = segs[segs.length - 1]
      if (folderId === null || !name) return send(409, '目标目录不存在'), true
      const data = await readBody(req)
      if (!data.length) return send(400, '空文件'), true

      const md5 = crypto.createHash('md5').update(data).digest('hex')
      const ext = (name.split('.').pop() || 'bin').slice(0, 12)
      const qiniuKey = `disk/${md5}${name.includes('.') ? '.' + ext : ''}`
      await uploadToQiniu(token, qiniuKey, data, String(req.headers['content-type'] || ''))

      await apiJson('/v1/disk/upload-file', token, {
        chatId, chatType: 2,
        fileSize: Math.max(1, Math.round(data.length / 1024)),   // 接口单位是 KB
        fileName: name,
        fileMd5: `${md5}.${ext}`,
        fileEtag: `F${md5.slice(0, 20)}`,
        qiniuKey,
        folderId,
      })
      return send(201, '上传成功'), true
    }

    /* ---------- 建目录 ---------- */
    if (req.method === 'MKCOL') {
      const folderId = await resolvePath(chatId, token, segs)
      if (folderId === null) return send(409, '父目录不存在'), true
      try {
        await apiJson('/v1/disk/create-folder', token, {
          chatId, chatType: 2, folderName: segs[segs.length - 1] || '新建文件夹', parentFolderId: folderId,
        })
        return send(201), true
      } catch (e: any) { return send(500, '建目录失败：' + e.message), true }
    }

    /* ---------- 删除 ---------- */
    if (req.method === 'DELETE') {
      const folderId = await resolvePath(chatId, token, segs)
      if (folderId === null) return send(404, '路径不存在'), true
      const list = await listDir(chatId, token, folderId)
      const f = list.find((x: any) => x.name === segs[segs.length - 1])
      if (!f) return send(404, '不存在'), true
      // ★ 真实接口是 /v1/disk/remove（/v1/disk/delete 是 404）
      try { await apiJson('/v1/disk/remove', token, { id: f.id }); return send(204), true }
      catch (e: any) { return send(403, '删除失败：' + e.message + '（云湖对群网盘删除有权限限制）'), true }
    }

    /* ---------- 重命名 / 移动（MOVE） ----------
     * 协议上 Destination 可以跨目录，但云湖 /v1/disk/rename 只支持改名字、**不能换目录**：
     *   · 同目录改名 → 正常返回 204
     *   · 跨目录移动 → 返回 409（不支持），提示用「下载 → 删除 → 上传」
     */
    if (req.method === 'MOVE') {
      const folderId = await resolvePath(chatId, token, segs)
      if (folderId === null) return send(404, '源路径不存在'), true
      const list = await listDir(chatId, token, folderId)
      const src = list.find((x: any) => x.name === segs[segs.length - 1])
      if (!src) return send(404, '源文件不存在'), true

      const destHdr = String(req.headers.destination || '')
      if (!destHdr) return send(400, '缺少 Destination 头'), true
      let destPath: string
      try { destPath = decodeURIComponent(new URL(destHdr).pathname || '') } catch { destPath = decodeURIComponent(destHdr) }
      const destSegs = destPath.replace(/^\/webdav\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
      if (destSegs.length && /^\d{5,}$/.test(destSegs[0])) destSegs.shift()
      const destFolderId = await resolvePath(chatId, token, destSegs.slice(0, -1))
      if (destFolderId !== folderId) return send(409, '云湖 WebDAV 不支持跨目录移动（下载 → 删除 → 上传）'), true
      const newName = destSegs[destSegs.length - 1] || src.name
      try {
        await apiJson('/v1/disk/rename', token, { id: src.id, objectType: src.isFolder ? 1 : 2, name: newName })
        return send(204), true
      } catch (e: any) { return send(403, '重命名失败：' + e.message), true }
    }

    return send(405, '不支持的方法 ' + req.method), true
  } catch (e: any) {
    return send(500, 'WebDAV 错误：' + e.message), true
  }
}
