export type ProviderFormat = 'chat' | 'responses' | 'anthropic'
export interface AiService {
  id: string; name: string; format: ProviderFormat; baseUrl: string; model: string
  maxTokens: number; useMaxTokens: boolean; temperature: number; useTemperature: boolean
  timeoutSeconds: number; anthropicVersion: string
  authMode?: 'default' | 'bearer' | 'x-api-key' | 'api-key' | 'none'
}
export interface Turn { role: 'user' | 'assistant'; content: string }
export interface AiUsage { input: number; output: number; total: number; estimated: boolean }
export interface AiResult { text: string; usage: AiUsage }

export function endpoint(base: string, path: string): string {
  const url = new URL(base.trim())
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 必须是有效的 HTTP 或 HTTPS 地址')
  const prefix = url.pathname.replace(/\/+$/, '')
  url.pathname = prefix.endsWith('/' + path) ? prefix : prefix + '/' + path
  return url.toString()
}
export function estimate(text: string): number {
  const eastAsian = (text.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length
  return Math.max(0, Math.ceil(eastAsian * 1.25 + (text.length - eastAsian) / 3.5))
}
export function boundedTurns(turns: Turn[], maxTurns: number, maxTokens: number): Turn[] {
  const source = turns.filter(x => x.content.trim()).slice(-Math.max(1, Math.min(200, maxTurns)))
  const budget = Math.max(1, Math.min(100000, maxTokens)); const out: Turn[] = []; let used = 0
  for (let i = source.length - 1; i >= 0; i--) {
    const t = source[i]; const cost = estimate(t.content) + 6
    if (used + cost > budget) {
      if (!out.length && budget > 6) {
        let low = 0, high = t.content.length
        while (low < high) { const mid = Math.ceil((low + high) / 2); if (estimate(t.content.slice(-mid)) + 6 <= budget) low = mid; else high = mid - 1 }
        if (low) out.unshift({ ...t, content: t.content.slice(-low) })
      }
      break
    }
    out.unshift(t); used += cost
  }
  return out
}
export function requestPayload(service: AiService, system: string, turns: Turn[]): any {
  const messages = turns.length ? turns : [{ role: 'user', content: '请根据会话内容生成一条自然的回复。' }]
  const payload: any = { model: service.model.trim() }
  if (!payload.model) throw new Error('请填写模型名称')
  if (service.format === 'anthropic') {
    payload.system = system
    payload.messages = messages
    // Messages API requires max_tokens even if optional parameters are disabled.
    payload.max_tokens = Math.max(1, Math.min(128000, Number(service.maxTokens) || 800))
  } else if (service.format === 'responses') {
    payload.instructions = system
    payload.input = messages
    if (service.useMaxTokens) payload.max_output_tokens = Math.max(1, Number(service.maxTokens) || 800)
  } else {
    payload.messages = [{ role: 'system', content: system }, ...messages]
    if (service.useMaxTokens) payload.max_tokens = Math.max(1, Number(service.maxTokens) || 800)
  }
  if (service.useTemperature) payload.temperature = Math.max(0, Math.min(service.format === 'anthropic' ? 1 : 2, Number(service.temperature)))
  return payload
}
export function parseResponse(format: ProviderFormat, data: any, system: string, turns: Turn[]): AiResult {
  let text = ''
  if (format === 'chat') {
    const c = data?.choices?.[0]?.message?.content
    text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text || '').join('') : ''
  } else if (format === 'responses') {
    text = typeof data?.output_text === 'string' ? data.output_text : (data?.output || []).flatMap((x: any) => x.content || []).filter((x: any) => x.type === 'output_text').map((x: any) => x.text || '').join('')
  } else text = (data?.content || []).filter((x: any) => x.type === 'text').map((x: any) => x.text || '').join('')
  text = text.trim()
  if (!text) throw new Error('服务返回了空回复或不支持的内容')
  const u = data?.usage
  const input = Number(format === 'chat' ? u?.prompt_tokens : u?.input_tokens)
  const output = Number(format === 'chat' ? u?.completion_tokens : u?.output_tokens)
  const provided = Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0
  const inCount = provided ? input : estimate(system + turns.map(x => x.content).join('\n'))
  const outCount = provided ? output : estimate(text)
  return { text, usage: { input: inCount, output: outCount, total: inCount + outCount, estimated: !provided } }
}
async function bridge(service: AiService, key: string, path: string, method: 'GET' | 'POST', payload?: any, signal?: AbortSignal): Promise<any> {
  const invoke = (window as any).__TAURI__?.core?.invoke
  if (!invoke) throw new Error('AI 服务需要 Windows 桌面客户端的安全存储和网络桥接')
  const capability = await invoke('ai_bridge_token')
  const r = await fetch('/bot-ai/request', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-yh-bot-capability': capability },
    body: JSON.stringify({ url: endpoint(service.baseUrl, path), format: service.format === 'anthropic' ? 'anthropic' : 'openai', key,
      method, payload, timeoutMs: Math.max(1, Math.min(300, Number(service.timeoutSeconds) || 60)) * 1000, anthropicVersion: service.anthropicVersion, authMode: service.authMode || 'default' }) })
  const result = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(String(result.error || `本地网络请求失败 HTTP ${r.status}`))
  if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}：${String(result.data?.error?.message || '服务返回错误')}`)
  return result.data
}
export async function generate(service: AiService, key: string, system: string, turns: Turn[], signal?: AbortSignal): Promise<AiResult> {
  const path = service.format === 'anthropic' ? 'messages' : service.format === 'responses' ? 'responses' : 'chat/completions'
  const data = await bridge(service, key, path, 'POST', requestPayload(service, system, turns), signal)
  return parseResponse(service.format, data, system, turns)
}
export async function models(service: AiService, key: string): Promise<string[]> {
  const data = await bridge(service, key, 'models', 'GET')
  return (Array.isArray(data?.data) ? data.data : []).map((x: any) => String(x.id || '')).filter(Boolean).slice(0, 500)
}
