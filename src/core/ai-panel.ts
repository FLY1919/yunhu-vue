import { reactive, watch } from 'vue'

export const PANEL_COLORS = ['--bg', '--fg', '--fg2', '--card', '--card2', '--line', '--acc', '--acc-soft', '--rail']
export function newPanelId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
}
export function installAiPanelHost(ctx: any) {
  if (ctx.aiPanel) return ctx.aiPanel
  if (typeof BroadcastChannel !== 'function' || !globalThis.crypto?.getRandomValues) return
  const session = newPanelId()
  let view = newPanelId()
  const bus = new BroadcastChannel('yh-ai-panel-' + session)
  const state = reactive({ detached: false, opening: false })
  const native = !!(window as any).__TAURI_INTERNALS__
  const invoke = (command: string, args?: any) => (window as any).__TAURI__.core.invoke(command, args)
  let popup: Window | null = null, disposed = false, identity = '', revision = 0
  let offNative: (() => void) | undefined
  const handled = new Set<string>()
  const post = (value: any) => { if (!disposed) bus.postMessage({ ...value, view }) }
  function snapshot() {
    const current = ctx.chat?.state.current, owner = String(ctx.auth?.state.user?.id || '')
    const locked = !!ctx.lock?.isLocked
    const available = !!(owner && current && ctx.userbot?.state.ready && !locked)
    const key = available ? `${current.type}:${current.id}` : ''
    const nextIdentity = owner + ':' + key + ':' + locked
    if (identity !== nextIdentity) { identity = nextIdentity; revision++ }
    const bot = ctx.userbot?.state, queued = bot?.queued?.[key], busy = !!bot?.busy?.[key]
    const styles = getComputedStyle(document.documentElement)
    return { type: 'snapshot', revision, key, available, channel: available ? { id: current.id, type: current.type, name: current.name || current.id } : null,
      draft: available ? bot?.drafts?.[key] || '' : '', kind: available ? bot?.draftKinds?.[key] || 1 : 1,
      active: available && (busy || !!queued), busy, useAI: available ? ctx.userbot.usesAIFor(current) : true, workMode: available ? ctx.userbot.workModeFor(current) : 'conversation',
      status: !available ? '请在主窗口选择会话并解锁' : queued && !busy ? '等待合并消息 / 冷却结束' : bot?.context?.[key]?.stage || ctx.userbot.statusFor(current),
      started: bot?.started?.[key] || 0, error: '', theme: document.documentElement.dataset.theme || 'dark',
      colors: Object.fromEntries(PANEL_COLORS.map(k => [k, styles.getPropertyValue(k)])) }
  }
  const publish = () => post(snapshot())
  const stopWatch = watch(() => {
    const current = ctx.chat?.state.current, key = current ? `${current.type}:${current.id}` : '', bot = ctx.userbot?.state
    return JSON.stringify([current?.id, current?.type, current?.name, ctx.auth?.state.user?.id, ctx.lock?.isLocked,
      bot?.ready, bot?.config?.conversations?.[key]?.workMode, bot?.drafts[key], bot?.draftKinds[key], bot?.busy[key], bot?.queued[key], bot?.context[key]])
  }, publish)
  const observer = new MutationObserver(publish)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
  async function dock(focus = true) {
    state.detached = false
    post({ type: 'docked' })
    if (focus) ctx.console?.goto('/')
    if (native) await invoke('close_ai_panel', { focus }).catch(() => {})
    else { popup?.close(); popup = null; if (focus) window.focus() }
  }
  async function detach(position?: { x?: number; y?: number; drag?: boolean }) {
    if (state.opening) return
    state.opening = true
    try {
      if (!snapshot().available) throw new Error('请先选择会话并启用用户 Bot')
      if (!state.detached) view = newPanelId()
      if (native) await invoke('open_ai_panel', { sessionId: session, viewId: view, x: position?.x ?? null, y: position?.y ?? null, drag: !!position?.drag })
      else {
        const url = new URL(location.href); url.searchParams.set('ai-panel', session); url.searchParams.set('ai-view', view)
        popup = window.open(url.href, 'yh-ai-panel-' + session, 'popup,width=440,height=610')
        if (!popup) throw new Error('请允许此页面打开 AI 浮窗')
        popup.focus()
      }
      state.detached = true; publish()
    } catch (e: any) { ctx.ui?.toast?.('无法打开 AI 浮窗：' + e.message, 'error') }
    finally { state.opening = false }
  }
  bus.onmessage = async ({ data }) => {
    if (data?.view !== view) return
    if (data?.type === 'ready' || data?.type === 'ping') { publish(); return }
    if (data?.type === 'closed') { state.detached = false; return }
    if (data?.type !== 'command' || typeof data.id !== 'string' || handled.has(data.id)) return
    handled.add(data.id); if (handled.size > 100) handled.delete(handled.values().next().value!)
    const s = snapshot(), current = ctx.chat?.state.current, owner = String(ctx.auth?.state.user?.id || '')
    if (data.action === 'dock') { await dock(); return }
    if (!state.detached || !s.available || data.revision !== s.revision || data.key !== s.key) { post({ type: 'result', id: data.id, error: '会话已变化，请重新操作' }); publish(); return }
    try {
      let replyDraft: string | undefined
      if (data.action === 'generate') {
        if (s.active) throw new Error('当前会话正在生成回复')
        const instruction = typeof data.instruction === 'string' ? data.instruction.trim() : ''
        const answer = await ctx.userbot.runManual({ ...current }, { instruction, previousDraft: data.useDraft ? s.draft : undefined, replyOnly: false })
        if (owner === String(ctx.auth?.state.user?.id || '') && snapshot().revision === s.revision) {
          ctx.userbot.state.drafts[s.key] = answer
          ctx.userbot.state.draftKinds[s.key] = ctx.userbot.state.replyKinds[s.key] || 1
          replyDraft = answer
        }
      } else if (data.action === 'mode') { ctx.userbot.setWorkMode(current, data.mode)
      } else if (data.action === 'use') {
        if (!s.draft) throw new Error('请先生成回复草稿')
        const draft = ctx.chat.drafts.get(current)
        draft.text = draft.text ? draft.text.replace(/\s+$/, '') + '\n' + s.draft : s.draft
        draft.kind = s.kind
        delete ctx.userbot.state.drafts[s.key]; delete ctx.userbot.state.draftKinds[s.key]
        ctx.console.goto('/')
      } else if (data.action === 'settings') ctx.userbot.open(current)
      else throw new Error('未知操作')
      post({ type: 'result', id: data.id, draft: replyDraft })
    } catch (e: any) { post({ type: 'result', id: data.id, error: e?.message || '操作失败' }) }
    publish()
  }
  const heartbeat = setInterval(() => {
    if (popup?.closed) { popup = null; state.detached = false }
    if (state.detached) publish()
  }, 1000)
  if (native) void (window as any).__TAURI__.event.listen('ai-panel-closed', (event: any) => { if (event.payload === view) state.detached = false }).then((off: () => void) => { if (disposed) off(); else offNative = off }).catch(() => {})
  const offLogout = ctx.on?.('auth/logout', () => { revision++; identity = ''; post({ ...snapshot(), available: false, draft: '', channel: null }); void dock(false) })
  function dispose() {
    if (disposed) return
    void dock(false); disposed = true; clearInterval(heartbeat); stopWatch(); observer.disconnect(); offNative?.(); offLogout?.(); bus.close()
    window.removeEventListener('beforeunload', dispose)
  }
  window.addEventListener('beforeunload', dispose)
  const panel = { state, detach, dock, dispose }
  ctx.set('aiPanel', panel)
  ctx.effect?.(() => dispose)
  return panel
}
