/** Tauri 的 WebView 不会自动把 target=_blank 交给系统浏览器。 */
export async function openExternalUrl(raw: string) {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('不支持的链接协议')
  const invoke = (window as any).__TAURI__?.core?.invoke
  if (invoke) await invoke('open_external_url', { url: url.href })
  else window.open(url.href, '_blank', 'noopener,noreferrer')
}
