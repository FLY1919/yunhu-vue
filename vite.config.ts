import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import https from 'node:https'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

export default defineConfig({
  plugins: [vue(), resProxyPlugin(), upProxyPlugin(), configPlugin()],
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
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
