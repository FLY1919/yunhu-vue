/**
 * http 服务 —— 对标 Koishi 的 ctx.http（axios 风格）
 *
 *   const data = await ctx.http.get('/v1/conversation/list')
 *   const r = await ctx.http.post('/api/v1/msg/send', { data, headers: { token } })
 *   const raw = await ctx.http.get(url, { responseType: 'arraybuffer' })
 *
 * 说明：
 *   · 相对路径会走本站 /api 反代到 chat-go.jwzhd.com（绕开跨域）
 *   · 绝对 http(s):// 地址直连
 *   · 默认带 token（已登录时），可被 config.headers 覆盖
 *   · 支持 get / post / put / patch / delete / head / request
 */
import { CapacitorHttp } from '@capacitor/core'
import type { Context } from '../core/context'

export const inject = { optional: ['api', 'auth', 'cfg'] }

interface HttpConfig {
  method?: string
  data?: any                 // 对象 → JSON；Uint8Array/ArrayBuffer → 二进制
  params?: Record<string, any>
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob'
  withToken?: boolean        // 默认 true
  baseURL?: string
}

function qs(params?: Record<string, any>) {
  if (!params || !Object.keys(params).length) return ''
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.append(k, String(v))
  return '?' + u.toString()
}

async function request(ctx: Context, url: string, config: HttpConfig = {}) {
  const auth: any = ctx.get('auth')
  const cfg: any = (ctx.get('cfg')?.all?.()?.http) || {}
  const baseURL = config.baseURL ?? cfg.baseURL ?? ''

  let finalUrl = url
  if (!/^https?:\/\//i.test(url)) {
    // 相对路径 → 本站 /api 反代
    finalUrl = (url.startsWith('/api') ? url : '/api' + url) + qs(config.params)
  } else if (config.params) {
    finalUrl = url + qs(config.params)
  }

  const headers: Record<string, string> = { ...(config.headers || {}) }
  // ⚠️ token 存在 **api 服务**里（api.token），不是 auth.state.token —— 之前读错地方导致一直「未登录」
  const token: string = ctx.get('api')?.token || auth?.state?.token || ''
  if (config.withToken !== false && token && !headers.token) headers.token = token

  let body: BodyInit | undefined
  if (config.data !== undefined) {
    if (config.data instanceof Uint8Array || config.data instanceof ArrayBuffer) {
      body = config.data as any
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream'
    } else if (typeof config.data === 'string') {
      body = config.data
    } else {
      body = JSON.stringify(config.data)
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
    }
  }

  const ctl = new AbortController()
  const timeout = config.timeout ?? cfg.timeout ?? 30000
  const timer = window.setTimeout(() => ctl.abort(), timeout)

  try {
    // ⚠️ Capacitor 原生（安卓内置）：用原生 HTTP 直连云湖，绕 CORS
    const isNative = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()
    if (isNative) {
      return await nativeRequest(finalUrl, config, headers, body, timeout)
    }
    const res = await fetch(finalUrl, {
      method: (config.method || 'GET').toUpperCase(),
      headers,
      body,
      signal: ctl.signal,
    })
    const rt = config.responseType || 'json'
    let data: any
    if (rt === 'arraybuffer') data = await res.arrayBuffer()
    else if (rt === 'blob') data = await res.blob()
    else if (rt === 'text') data = await res.text()
    else {
      const text = await res.text()
      try { data = text ? JSON.parse(text) : null } catch { data = text }
    }
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      data,
      ok: res.ok,
      get raw() { return data },
    }
  } finally {
    window.clearTimeout(timer)
  }
}

/** Capacitor 原生 HTTP 请求（安卓「内置」时走这里，直连云湖绕 CORS） */
async function nativeRequest(finalUrl: string, config: HttpConfig, headers: Record<string, string>, body: any, timeout: number) {
  // 动态 import + vite-ignore：web 端没装 @capacitor/core 也不影响构建，
  // 运行时只有 native 分支才会真正走到这里。
  // @ts-ignore - @capacitor/core 只在 android 分支安装，web 端构建忽略类型
  const UPSTREAM = 'https://chat-go.jwzhd.com'
  let url = finalUrl
  if (url.startsWith('/api')) url = UPSTREAM + url.slice(4)
  else if (!/^https?:\/\//i.test(url)) url = UPSTREAM + url
  // 原生层手动补 Referer（有些接口校验来源）
  const h: Record<string, string> = { ...headers }
  if (!h.referer) h.referer = 'https://myapp.jwznb.com/'

  const resp = await CapacitorHttp.request({
    url,
    method: (config.method || 'GET').toUpperCase(),
    headers: h,
    data: typeof body === 'string' ? body : undefined,
    connectTimeout: timeout,
    readTimeout: timeout,
  })
  let data = resp.data
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { /* 保留原文 */ } }
  const st = resp.status || 0
  return {
    status: st,
    headers: resp.headers || {},
    data,
    ok: st >= 200 && st < 300,
    get raw() { return data },
  }
}

/**
 * 建一个 http 实例（可带默认配置）。
 * ctx.http.extend({ baseURL, headers, timeout, withToken }) → 新实例，
 * 之后所有请求都会合并这层默认值（对标 Koishi/axios 的 http.extend）。
 */
function makeHttp(ctx: Context, defaults: HttpConfig = {}) {
  const merge = (config?: HttpConfig): HttpConfig => ({
    ...defaults,
    ...config,
    headers: { ...(defaults.headers || {}), ...(config?.headers || {}) },
    baseURL: config?.baseURL ?? defaults.baseURL,
    timeout: config?.timeout ?? defaults.timeout,
    withToken: config?.withToken ?? defaults.withToken,
  })
  const self: any = {
    /** 继承一层默认配置，生成新实例 */
    extend: (more: HttpConfig = {}) => makeHttp(ctx, merge(more)),
    request: (url: string, config?: HttpConfig) => request(ctx, url, merge(config)),
    get: (url: string, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'GET' })),
    head: (url: string, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'HEAD' })),
    post: (url: string, data?: any, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'POST', data })),
    put: (url: string, data?: any, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'PUT', data })),
    patch: (url: string, data?: any, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'PATCH', data })),
    delete: (url: string, config?: HttpConfig) => request(ctx, url, merge({ ...config, method: 'DELETE' })),
  }
  return self
}

export function apply(ctx: Context) {
  const http = makeHttp(ctx)

  ctx.set('http', http)
  ctx.logger('http').info('http 服务就绪 · ctx.http.get/post/... ')
}
