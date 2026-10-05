const { app, BrowserWindow } = require('electron')
console.log('[mini] app 加载成功, electron 版本 =', process.versions.electron)
app.whenReady().then(() => {
  console.log('[mini] ready')
  const w = new BrowserWindow({ width: 300, height: 200 })
  w.loadURL('data:text/html,<h1>hello</h1>')
  console.log('[mini] 窗口已创建')
})
