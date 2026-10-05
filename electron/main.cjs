/**
 * Electron 主进程 —— 云湖客户端桌面版（GUI）
 *
 * 设计思路：**不重复实现业务**，而是直接复用现有的 Node 服务端（server.ts）。
 *   1) 主进程里以子进程方式拉起服务端（默认 8902 端口）
 *   2) BrowserWindow 加载 http://127.0.0.1:8902
 *   3) 这样「Web 版有的功能，桌面版全都有」，不用维护两份逻辑
 *
 * 另外做了几件桌面端才有的事：
 *   - 单实例锁（避免重复启动）
 *   - 系统托盘（关闭窗口时最小化到托盘，而不是退出）
 *   - 启动前等待服务端就绪（避免白屏）
 *   - 退出时一并结束服务端子进程
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

const PORT = Number(process.env.YH_PORT || 8902)
// HTTPS 端口也要可配：系统服务可能已经占用了默认 8903，GUI 得换一个，否则启动就崩
const HTTPS_PORT = Number(process.env.YH_HTTPS_PORT || PORT + 1)
const BASE_URL = `http://127.0.0.1:${PORT}`

let mainWindow = null
let tray = null
let serverProcess = null
/** 是否真的要退出（点托盘「退出」才算） */
let isQuitting = false

/** 服务端目录：打包后是 resources/app，开发时是项目根 */
function serverDir() {
  // __dirname = <app>/electron
  const root = path.join(__dirname, '..')
  return fs.existsSync(path.join(root, 'server.ts')) ? root : path.join(process.resourcesPath || '', 'app')
}

/** 拉起服务端：优先用 tsx 跑 server.ts（Node 26 可直接跑 TS），退回 node */
function startServer() {
  const dir = serverDir()
  const tsEntry = path.join(dir, 'server.ts')
  const jsEntry = path.join(dir, 'dist-server', 'server.cjs')

  /*
   * ⚠️ 不能只写 'node'：Electron 主进程的 PATH 可能不含 node（或环境被隔离），
   *    spawn 会静默失败 → 服务端起不来 → 窗口白屏。用 process.execPath（当前 node 绝对路径）最稳，
   *    找不到再退回 'node'。
   */
  let cmd = process.execPath || 'node'
  let args = []
  if (fs.existsSync(tsEntry)) {
    // Node 22.6+ / 26 原生支持直接运行 .ts（type stripping）
    args = [tsEntry]
  } else if (fs.existsSync(jsEntry)) {
    args = [jsEntry]
  } else {
    dialog.showErrorBox('启动失败', '找不到服务端入口（server.ts / dist-server/server.cjs）')
    return
  }

  serverProcess = spawn(cmd, args, {
    cwd: dir,
    env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logPrefix = '[yunhu-server]'
  console.log(logPrefix, '启动：', cmd, args.join(' '), 'cwd =', dir)
  serverProcess.stdout.on('data', (d) => console.log(logPrefix, String(d).trim()))
  serverProcess.stderr.on('data', (d) => console.error(logPrefix, String(d).trim()))
  serverProcess.on('exit', (code) => {
    if (!isQuitting) console.warn(logPrefix, '服务端意外退出，code =', code)
  })
  serverProcess.on('error', (err) => {
    console.error(logPrefix, 'spawn 失败：', err.message)
    dialog.showErrorBox('服务端启动失败', String(err.message))
  })
}

/** 轮询等待服务端就绪（最多约 30 秒） */
function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${BASE_URL}/`, (res) => {
        res.resume()
        res.statusCode && resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('服务端启动超时'))
        else setTimeout(tick, 400)
      })
      req.setTimeout(1500, () => req.destroy())
    }
    tick()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    title: '云湖客户端',
    backgroundColor: '#17181f',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 允许加载本地 127.0.0.1 服务（同源，无跨域问题）
      webSecurity: true,
    },
  })

  mainWindow.loadURL(BASE_URL)

  // 站内链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith(BASE_URL)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 关闭按钮 → 最小化到托盘（Windows/Linux）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      return
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function createTray() {
  // 优先使用项目里的图标，没有就用 Electron 内置空图标
  const icoPath = path.join(serverDir(), 'build', 'icon.png')
  tray = fs.existsSync(icoPath)
    ? new Tray(icoPath)
    : new Tray(path.join(__dirname, 'tray.png'))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开云湖客户端',
      click: () => { mainWindow ? mainWindow.show() : createWindow() },
    },
    { type: 'separator' },
    {
      label: '在浏览器中打开',
      click: () => shell.openExternal(BASE_URL),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setToolTip('云湖客户端')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => { mainWindow ? mainWindow.show() : createWindow() })
}

/** 单实例：第二个实例直接聚焦已有窗口 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // 先起服务端，再开窗，避免白屏
    startServer()
    try {
      await waitForServer()
    } catch (e) {
      console.error('[gui]', e.message)
    }
    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else if (mainWindow) mainWindow.show()
    })
  })
}

app.on('before-quit', () => { isQuitting = true })
app.on('will-quit', () => {
  // 退出时结束服务端子进程
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill() } catch { /* 忽略 */ }
  }
})
