#!/usr/bin/env node
/** Download to a temporary file; install only after official size/hash/PE validation. */
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { windowsRuntime, verifyWindowsRuntime } from './verify-windows-assets.mjs'

const target = resolve(process.argv[2] || 'src-tauri/resources/node.exe')
const temporary = target + '.download'
await mkdir(dirname(target), { recursive: true })
try {
  const response = await fetch(windowsRuntime.url, { signal: AbortSignal.timeout(180000), redirect: 'error' })
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (length && length !== windowsRuntime.size) throw new Error(`Node download length differs: ${length}`)
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()))
  verifyWindowsRuntime(temporary)
  await rename(temporary, target)
  console.log(`PASS: installed verified Windows x64 Node ${windowsRuntime.version}`)
} finally { await unlink(temporary).catch(() => {}) }
