import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import https from 'node:https'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { stickerDirectory } from './sticker-directory'

const RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i
const REFERER = 'http://myapp.jwznb.com'
const CONFIG_FILE = join(process.cwd(), 'yunhu.config.yml')

/** 开发时给云湖数据床补上防盗链 Referer */
function resProxyPlugin() {
  return {
    name: 'yunhu-res-proxy',
    configureServer(server: any) {
      server.middlewares.use('/res', (req: any, res: any, next: any) => {
        const m = (req.url || '').match(/^\/([^/]+)(\/.*)?$/)
        if (!m) return next()
        const host = decodeURIComponent(m[1])
        if (!RES_HOST_RE.test(host)) { res.statusCode = 403; res.end('host not allowed'); return }
        https.get(`https://${host}${m[2] || '/'}`, {
          headers: { Referer: REFERER, 'User-Agent': 'Mozilla/5.0' },
        }, up => {
          if (up.statusCode! >= 300 && up.statusCode! < 400 && up.headers.location) {
            res.writeHead(302, { location: up.headers.location }); res.end(); return
          }
          res.writeHead(up.statusCode!, {
            'content-type': up.headers['content-type'] || 'application/octet-stream',
            'cache-control': 'public, max-age=3600',
          })
          up.pipe(res)
        }).on('error', () => { res.statusCode = 502; res.end('proxy error') })
      })
    },
  }
}

/** 开发时支持 /up 上传代理 */
function upProxyPlugin() {
  return {
    name: 'yunhu-up-proxy',
    configureServer(server: any) {
      server.middlewares.use('/up', (req: any, res: any, next: any) => {
        const m = (req.url || '').match(/^\/([^/]+)(\/.*)?$/)
        if (!m) return next()
        const host = decodeURIComponent(m[1])
        if (!/^[\w.-]+$/.test(host)) { res.statusCode = 403; res.end('host not allowed'); return }
        const r = https.request({ hostname: host, port: 443, method: req.method, path: m[2] || '/', headers: { ...req.headers, host } }, up => {
          res.writeHead(up.statusCode!, { 'content-type': up.headers['content-type'] || 'application/octet-stream', 'access-control-allow-origin': '*' })
          up.pipe(res)
        })
        r.on('error', () => { res.statusCode = 502; res.end('up proxy error') })
        req.pipe(r)
      })
    },
  }
}

/** 开发时也支持 /config 读写 yunhu.config.yml */
function configPlugin() {
  return {
    name: 'yunhu-config',
    configureServer(server: any) {
      server.middlewares.use('/config', async (req: any, res: any) => {
        if (req.method === 'GET') {
          const text = existsSync(CONFIG_FILE) ? await readFile(CONFIG_FILE, 'utf8') : ''
          res.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' }); res.end(text); return
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          await writeFile(CONFIG_FILE, Buffer.concat(chunks).toString('utf8'), 'utf8')
          res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return
        }
        res.statusCode = 405; res.end()
      })
    },
  }
}

/** 开发时支持 /data/<name> 与 /update-check（与 server.ts 同一数据目录，行为一致） */
function dataPlugin() {
  const DIR = process.env.YH_DATA_DIR || join(homedir(), 'Documents', 'yhchat')
  const ALLOW = new Set(['session', 'accounts', 'cache', 'pin', 'lock', 'relay', 'recall'])
  const HDR = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  try { mkdirSync(DIR, { recursive: true }) } catch { /* 忽略 */ }
  return {
    name: 'yunhu-data',
    configureServer(server: any) {
      server.middlewares.use('/data', async (req: any, res: any) => {
        const name = (req.url || '').replace(/^\/+/, '').split('?')[0]
        if (!ALLOW.has(name)) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, msg: 'unknown data key' })); return }
        const file = join(DIR, name + '.json')
        if (req.method === 'GET') {
          const text = existsSync(file) ? await readFile(file, 'utf8') : ''
          res.writeHead(200, HDR); res.end(text || '{}'); return
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const body = Buffer.concat(chunks).toString('utf8')
          try { JSON.parse(body) } catch { res.statusCode = 400; res.end(JSON.stringify({ ok: false, msg: 'bad json' })); return }
          await writeFile(file, body, 'utf8')
          res.writeHead(200, HDR); res.end('{"ok":true}'); return
        }
        if (req.method === 'DELETE') {
          try { await unlink(file) } catch { /* 幂等 */ }
          res.writeHead(200, HDR); res.end('{"ok":true}'); return
        }
        res.statusCode = 405; res.end()
      })
      server.middlewares.use('/update-check', async (_req: any, res: any) => {
        // dev 下直接回「无更新信息」，真实检查走打包后的 server.ts
        res.writeHead(200, HDR); res.end(JSON.stringify({ ok: false, msg: 'dev' }))
      })
    },
  }
}

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [vue(), resProxyPlugin(), upProxyPlugin(), configPlugin(), dataPlugin(), {
    name: 'sticker-directory', configureServer(server) {
      server.middlewares.use('/sticker-directory', (req, res) => { void stickerDirectory(req, res, (req.url || '').split('?')[1] || '') })
    },
  }],
  base: './',
  // 构建目标 es2020：安卓 WebView（部分设备 Chrome < 90）不支持 es2022 新语法，
  // JS 一抛异常整页黑屏（WebView 里看不到 console）——es2020 是 Capacitor 官方推荐档
  build: { outDir: 'dist', target: 'es2020' },
  server: {
    proxy: {
      '/api': {
        target: 'https://chat-go.jwzhd.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api/, ''),
      },
    },
  },
})
