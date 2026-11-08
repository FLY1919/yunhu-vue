/**
 * GUI 自检：加载 yunhu://app 内嵌前端 → 用账号登录 → 检查关键功能。
 * 用法：DISPLAY=:99 ELECTRON_DISABLE_SANDBOX=1 electron electron/selftest.cjs --no-sandbox
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

const UPSTREAM = 'https://chat-go.jwzhd.com'
const RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i
const RES_REFERER = 'http://myapp.jwznb.com'

protocol.registerSchemesAsPrivileged([{ scheme: 'yunhu', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

function rootDir() { return path.join(__dirname, '..') }

async function handle(request) {
  const url = new URL(request.url)
  const p = url.pathname
  if (p === '/api' || p.startsWith('/api/')) {
    const target = UPSTREAM + p.replace(/^\/api/, '') + url.search
    const h = {}
    for (const [k, v] of request.headers.entries()) h[k] = v
    delete h.host; delete h.origin; delete h.referer; delete h['content-length']
    const resp = await net.fetch(target, { duplex: 'half', method: request.method, headers: h, body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body })
    const hh = new Headers(resp.headers); hh.set('cache-control', 'no-store')
    return new Response(resp.body, { status: resp.status, headers: hh })
  }
  if (p.startsWith('/res/')) {
    const m = p.match(/^\/res\/([^/]+)(\/.*)?$/)
    const host = decodeURIComponent(m[1])
    const target = 'https://' + host + (m[2] || '/') + url.search
    const resp = await net.fetch(target, { duplex: 'half', headers: { referer: RES_REFERER, range: request.headers.get('range') || '' } })
    const hh = new Headers(resp.headers); hh.set('access-control-allow-origin', '*')
    return new Response(resp.body, { status: resp.status, headers: hh })
  }
  if (p.startsWith('/up/')) {
    const m = p.match(/^\/up\/([^/]+)(\/.*)?$/)
    const host = decodeURIComponent(m[1])
    const target = 'https://' + host + (m[2] || '/') + url.search
    const h = {}
    for (const [k, v] of request.headers.entries()) h[k] = v
    delete h.host; delete h.origin; delete h.referer; delete h['content-length']
    const resp = await net.fetch(target, { duplex: 'half', method: request.method, headers: h, body: request.body })
    return new Response(resp.body, { status: resp.status, headers: new Headers(resp.headers) })
  }
  let fp = p === '/' ? '/index.html' : p
  const full = path.normalize(path.join(rootDir(), 'dist', fp))
  try { return await net.fetch(pathToFileURL(full).toString()) } catch { return new Response('404', { status: 404 }) }
}

const EMAIL = process.env.YH_EMAIL || ''
const PASSWORD = process.env.YH_PASSWORD || ''

app.whenReady().then(async () => {
  protocol.handle('yunhu', handle)
  // 直接测主进程 net.fetch 到云湖
  try {
    const t = await net.fetch('https://chat-go.jwzhd.com/v1/user/get-self', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', duplex: 'half' })
    console.log('=== 主进程 fetch 直连 ===')
    console.log('status=' + t.status, 'body=' + (await t.text()).slice(0, 120))
  } catch (e) {
    console.log('=== 主进程 fetch 直连失败 ===')
    console.log(String(e && e.message || e))
  }
  const win = new BrowserWindow({ show: false, width: 1280, height: 860 })
  await win.loadURL('yunhu://app/index.html')
  await new Promise((r) => setTimeout(r, 8000))

  const script = [
    '(async () => {',
    '  const y = window.__yunhu',
    "  if (!y) return JSON.stringify({ 错误: '应用未加载' })",
    '  const out = { 已加载: true }',
    "  const inputs = document.querySelectorAll('input')",
    "  if (inputs.length >= 2 && !y.auth?.state?.user) {",
    '    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; d.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })) }',
    "    set(inputs[0], '" + EMAIL + "'); set(inputs[1], '" + PASSWORD + "')",
    '    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("登录"))',
    '    if (btn) btn.click()',
    '  }',
    '  await new Promise(r => setTimeout(r, 8000))',
    '  out.已登录 = !!y.auth?.state?.user',
    '  out.昵称 = y.auth?.state?.user?.name',
    "  const names = ['api','chat','auth','social','botconsole','community','stickers','commands','session','event','logs','cfg','ui','theme','console','bots','satori','ws','messageActions','group','quickreply','charbg','http']",
    "  out.服务 = names.filter(n => !!(y.get && y.get(n))).length + '/' + names.length",
    "  out.插件 = y.app?.registry ? y.app.registry.filter(p => p.fiber).length + '/' + y.app.registry.length : '无'",
    '  out.页面 = y.console?.state?.pages?.length',
    '  out.会话数 = y.chat?.state?.conversations?.length',
    "  out.错误日志 = (y.logs?.state?.logs || []).filter(l => l.level === 'error').slice(-3).map(l => l.text.slice(0,100))",
    '  return JSON.stringify(out)',
    '})()',
  ].join('\n')

  const diag = await win.webContents.executeJavaScript(
    "JSON.stringify({ readyState: document.readyState, hasYunhu: !!window.__yunhu, scripts: document.querySelectorAll('script').length, bodyLen: document.body ? document.body.innerHTML.length : 0, inputs: document.querySelectorAll('input').length, btns: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0,6), 正文: document.body ? document.body.innerText.slice(0,120) : '' })"
  )
  console.log('=== 诊断 ===')
  console.log(diag)
  // 直接测试协议代理（fetch /api 应返回 JSON，而非网络错误）
  const proxyTest = await win.webContents.executeJavaScript(
    "fetch('/api/v1/user/get-self', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' }).then(r => r.text()).then(t => t.slice(0, 120)).catch(e => 'FETCH_ERR: ' + e.message)"
  )
  console.log('=== 代理测试 ===')
  console.log(proxyTest)
  // 直接 fetch 登录接口，看协议代理转发 POST body 是否正常
  const loginRaw = await win.webContents.executeJavaScript(
    "fetch('/api/v1/user/email-login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email:'" + EMAIL + "', password:'" + PASSWORD + "', deviceId:'selftest', platform:'web'}) }).then(r => r.text()).then(t => t.slice(0, 200)).catch(e => 'LOGIN_ERR: ' + e.message)"
  )
  console.log('=== 登录接口原始返回 ===')
  console.log(loginRaw)
  console.log('=== 诊断 ===')
  console.log(diag)
  const result = await win.webContents.executeJavaScript(script)
  console.log('=== 结果 ===')
  console.log(result)
  app.quit()
})
