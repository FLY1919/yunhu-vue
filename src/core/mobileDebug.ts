/**
 * 移动端内置调试浮层（那狗吧的建议：别让用户去 adb 抓日志）
 *
 * 仅在 Capacitor 原生环境启用。捕获：
 *   window.onerror / unhandledrejection / console.error
 * 显示为屏幕底部可展开的红色浮层，点条目可看完整堆栈并复制。
 * 这样真机黑屏/接口报错时，用户直接截图 APP 里的浮层就能定位，不用连电脑。
 */
export function enableMobileDebug() {
  const native = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()
  if (!native) return

  const logs: string[] = []
  let box: HTMLDivElement | null = null
  let list: HTMLDivElement | null = null

  function ensureBox() {
    if (box) return
    box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:45vh;overflow:auto;background:rgba(20,0,0,.92);color:#ffb4b4;font:11px/1.5 monospace;padding:8px 10px;border-top:2px solid #ff5252;word-break:break-all;display:none'
    const bar = document.createElement('div')
    bar.style.cssText = 'position:sticky;top:0;background:#5c1010;color:#fff;font-weight:700;padding:2px 0;cursor:pointer'
    bar.textContent = '调试日志（点击收起/展开）'
    list = document.createElement('div')
    bar.onclick = () => { list!.style.display = list!.style.display === 'none' ? '' : 'none' }
    box.appendChild(bar)
    box.appendChild(list!)
    document.body.appendChild(box)
  }

  function push(msg: string) {
    try {
      logs.push(msg)
      if (logs.length > 50) logs.shift()
      ensureBox()
      if (box) box.style.display = 'block'
      const item = document.createElement('div')
      item.style.cssText = 'border-bottom:1px dashed #733;padding:3px 0;white-space:pre-wrap'
      item.textContent = msg.slice(0, 1200)
      item.onclick = () => { navigator.clipboard?.writeText(logs.join('\n\n')); item.textContent = '已复制全部日志' }
      list!.appendChild(item)
    } catch { /* 调试器自身出错就静默 */ }
  }

  window.addEventListener('error', (e) => push('[error] ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + e.lineno))
  window.addEventListener('unhandledrejection', (e: any) => push('[promise] ' + String(e.reason?.message || e.reason).slice(0, 600)))
  const origError = console.error.bind(console)
  console.error = (...args: any[]) => { push('[console.error] ' + args.map(a => String(a?.message || a)).join(' ').slice(0, 600)); origError(...args) }
}
