/**
 * Electron 主进程 —— 云湖客户端桌面版（GUI）
 *
 * ⚠️ 架构（重要）：**不搞前后端分离**。
 *   之前我写的是「主进程 spawn 一个 node 服务端 + 窗口连本地 HTTP」——那是套壳启动器，
 *   等于没用上 Electron。现在改成：
 *     1) 注册自定义协议 yunhu://
 *     2) 窗口 loadURL('yunhu://app/index.html') 直接加载打包进应用的前端
 *     3) 前端发的 /api、/res、/up 请求由**主进程 protocol.handle 代理**到云湖
 *        （主进程没有 CORS 限制，顺带加防盗链 Referer）
 *   这样是真正的自包含桌面应用，没有独立后端进程。
 */
const { app, BrowserWindow, protocol, net, Tray, Menu, shell, session } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const fs = require('fs')

const UPSTREAM = process.env.UPSTREAM || 'https://chat-go.jwzhd.com'
// 云湖数据床域名白名单（和 server.ts 一致）
const RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i
const RES_REFERER = 'http://myapp.jwznb.com'

let mainWindow = null
let tray = null
let isQuitting = false

/** 应用根目录：打包后是 resources/app，开发时是项目根 */
function rootDir() {
  const r = path.join(__dirname, '..')
  return fs.existsSync(path.join(r, 'dist')) ? r : path.join(process.resourcesPath || '', 'app')
}

/* ---------------- 自定义协议：yunhu:// ---------------- */
// 必须在 app ready 前注册特权
protocol.registerSchemesAsPrivileged([{
  scheme: 'yunhu',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

/** 把 request.headers 转成纯对象（去掉会和上游冲突的字段） */
function proxyHeaders(request) {
  const h = {}
  for (const [k, v] of request.headers.entries()) h[k] = v
  delete h.host; delete h.origin; delete h.referer; delete h['content-length']
  return h
}

/** 请求处理：/api /res /up 走代理，其余走本地静态文件 */
async function handle(request) {
  const url = new URL(request.url)
  const p = url.pathname

  // ---- /api/* → 反代到云湖（带 token，no-store） ----
  if (p === '/api' || p.startsWith('/api/')) {
    const target = UPSTREAM + p.replace(/^\/api/, '') + url.search
    try {
      const resp = await net.fetch(target, { duplex: 'half',
        method: request.method,
        headers: proxyHeaders(request),
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
      })
      // 关键：/api 绝不能缓存
      const h = new Headers(resp.headers)
      h.set('cache-control', 'no-store')
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h })
    } catch (e) {
      return new Response(JSON.stringify({ code: -1, msg: 'proxy error: ' + e.message }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
  }

  // ---- /res/<host>/<path> → 数据床（带防盗链 Referer + 透传 Range 支持音视频） ----
  if (p.startsWith('/res/')) {
    const m = p.match(/^\/res\/([^/]+)(\/.*)?$/)
    if (!m) return new Response('bad res url', { status: 400 })
    const host = decodeURIComponent(m[1])
    if (!RES_HOST_RE.test(host)) return new Response('host not allowed', { status: 403 })
    try {
      const target = 'https://' + host + (m[2] || '/') + url.search
      const resp = await net.fetch(target, { duplex: 'half',
        method: 'GET',
        headers: { referer: RES_REFERER, range: request.headers.get('range') || '' },
      })
      const h = new Headers(resp.headers)
      h.set('cache-control', 'public, max-age=86400')
      h.set('access-control-allow-origin', '*')
      h.set('access-control-expose-headers', 'content-range, content-length, accept-ranges')
      return new Response(resp.body, { status: resp.status, headers: h })
    } catch (e) {
      return new Response('res proxy error: ' + e.message, { status: 502 })
    }
  }

  // ---- /up/<host>/<path> → 上传代理 ----
  if (p.startsWith('/up/')) {
    const m = p.match(/^\/up\/([^/]+)(\/.*)?$/)
    if (!m) return new Response('bad up url', { status: 400 })
    const host = decodeURIComponent(m[1])
    if (!/^[\w.-]+$/.test(host)) return new Response('host not allowed', { status: 403 })
    try {
      const target = 'https://' + host + (m[2] || '/') + url.search
      const resp = await net.fetch(target, { duplex: 'half',
        method: request.method,
        headers: proxyHeaders(request),
        body: request.body,
      })
      const h = new Headers(resp.headers)
      h.set('access-control-allow-origin', '*')
      return new Response(resp.body, { status: resp.status, headers: h })
    } catch (e) {
      return new Response('up proxy error: ' + e.message, { status: 502 })
    }
  }

  // ---- 静态文件（前端 dist） ----
  let filePath = p === '/' ? '/index.html' : p
  // 防止目录穿越
  const full = path.normalize(path.join(rootDir(), 'dist', filePath))
  if (!full.startsWith(path.normalize(path.join(rootDir(), 'dist')))) {
    return new Response('forbidden', { status: 403 })
  }
  try {
    return await net.fetch(pathToFileURL(full).toString())
  } catch (e) {
    return new Response('not found: ' + filePath, { status: 404 })
  }
}

/* ---------------- 窗口 / 托盘 ---------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    title: '云湖客户端',
    backgroundColor: '#17181f',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  mainWindow.loadURL('yunhu://app/index.html')

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('yunhu://')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); return }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function createTray() {
  const icoPath = path.join(rootDir(), 'build', 'icon.png')
  tray = fs.existsSync(icoPath) ? new Tray(icoPath) : new Tray(path.join(__dirname, 'tray.png'))
  const menu = Menu.buildFromTemplate([
    { label: '打开云湖客户端', click: () => { mainWindow ? mainWindow.show() : createWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setToolTip('云湖客户端')
  tray.setContextMenu(menu)
  tray.on('click', () => { mainWindow ? mainWindow.show() : createWindow() })
}

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })

  app.whenReady().then(() => {
    protocol.handle('yunhu', handle)
    createWindow()
    createTray()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else if (mainWindow) mainWindow.show()
    })
  })
}

app.on('before-quit', () => { isQuitting = true })
