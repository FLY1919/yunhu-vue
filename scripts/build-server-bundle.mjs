/**
 * 把 server.ts（含 webdav/satori 依赖）打成单文件 ESM bundle，供 Tauri sidecar 用。
 * 用法：node scripts/build-server-bundle.mjs [outfile]
 * 产物默认 tauri/resources/server-bundle.mjs（CI 会再拷 node.exe 到同目录）。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = process.argv[2] || join(root, 'src-tauri', 'resources', 'server-bundle.mjs')

await build({
  entryPoints: [join(root, 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile,
  // node 内置模块不打包
  external: ['node:*'],
  logLevel: 'info',
})
console.log('[build-server-bundle] ->', outfile)
