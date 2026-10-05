/**
 * GUI 自检：在 Electron 窗口里加载页面 → 用账号登录 → 检查关键功能是否可用。
 * 用法：DISPLAY=:99 YH_PORT=8906 node electron/selftest.cjs
 * （需要 xvfb 提供虚拟显示）
 */
const { app, BrowserWindow } = require('electron')

const PORT = process.env.YH_PORT || 8906
const EMAIL = 'qw687255511@163.com'
const PASSWORD = 'a20090101'

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 860 })
  await win.loadURL(`http://127.0.0.1:${PORT}`)

  // 等应用就绪
  await new Promise((r) => setTimeout(r, 6000))

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const y = window.__yunhu
      if (!y) return { 错误: '应用未加载' }
      const out = {}
      // 登录
      const inputs = document.querySelectorAll('input')
      if (inputs.length >= 2 && !y.auth?.state?.user) {
        const set = (el, v) => {
          const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          d.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set(inputs[0], '${EMAIL}')
        set(inputs[1], '${PASSWORD}')
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('登录'))
        if (btn) btn.click()
      }
      await new Promise(r => setTimeout(r, 12000))
      out.已登录 = !!y.auth?.state?.user
      out.昵称 = y.auth?.state?.user?.name
      const names = ['api','chat','auth','social','botconsole','community','stickers','commands','session','event','logs','cfg','ui','theme','console','bots','satori','ws','messageActions','group','quickreply','charbg','http']
      out.服务 = names.filter(n => !!(y.get && y.get(n))).length + '/' + names.length
      out.插件 = y.app?.registry ? y.app.registry.filter(p => p.fiber).length + '/' + y.app.registry.length : '无'
      out.页面 = y.console?.state?.pages?.length
      out.会话数 = y.chat?.state?.conversations?.length
      out.错误日志 = (y.logs?.state?.logs || []).filter(l => l.level === 'error').slice(-3).map(l => l.text.slice(0,100))
      return JSON.stringify(out)
    })()
  `)

  console.log('=== GUI 自检结果 ===')
  console.log(result)
  app.quit()
})
