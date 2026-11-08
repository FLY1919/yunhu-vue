#!/usr/bin/env node
/** Reject incomplete Windows runtime files BEFORE producing an installer. */
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const windowsRuntime = JSON.parse(readFileSync(new URL('./windows-runtime.json', import.meta.url), 'utf8'))

export function verifyPe(bytes, label = 'PE file', allowedMachines = [0x8664]) {
  const fail = detail => { throw new Error(`${label}: ${detail}`) }
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') fail('invalid DOS header')
  const pe = bytes.readUInt32LE(0x3c)
  if (pe < 64 || pe + 24 > bytes.length || bytes.toString('binary', pe, pe + 4) !== 'PE\0\0') fail('invalid PE header')
  const machine = bytes.readUInt16LE(pe + 4)
  if (!allowedMachines.includes(machine)) fail('expected Windows x64 executable')
  const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20)
  const optional = pe + 24, table = optional + optionalSize
  const directoryStart = machine === 0x8664 ? 112 : 96
  if (!sections || optionalSize < directoryStart || table + sections * 40 > bytes.length) fail('incomplete PE section table')
  if (bytes.readUInt16LE(optional) !== (machine === 0x8664 ? 0x20b : 0x10b)) fail('unexpected PE optional header')
  const headerSize = bytes.readUInt32LE(optional + 60)
  if (headerSize > bytes.length || headerSize < table + sections * 40) fail('incomplete PE headers')
  for (let n = 0; n < sections; n++) {
    const at = table + n * 40
    const name = bytes.toString('ascii', at, at + 8).replace(/\0.*$/, '')
    const size = bytes.readUInt32LE(at + 16), offset = bytes.readUInt32LE(at + 20)
    if (size && (offset < headerSize || offset + size > bytes.length)) fail(`truncated ${name} section (needs ${offset + size} bytes, has ${bytes.length})`)
  }
  // Unlike other PE directories, the Authenticode entry uses a file offset.
  const directoryCount = bytes.readUInt32LE(optional + directoryStart - 4)
  if (directoryCount > 4) {
    if (optionalSize < directoryStart + 5 * 8) fail('incomplete PE data directories')
    const offset = bytes.readUInt32LE(optional + directoryStart + 4 * 8), size = bytes.readUInt32LE(optional + directoryStart + 4 * 8 + 4)
    if (size && (!offset || offset + size > bytes.length)) fail('truncated signature data')
  }
}

export function verifyWindowsRuntime(path) {
  const bytes = readFileSync(path)
  verifyPe(bytes, path)
  if (bytes.length !== windowsRuntime.size) throw new Error(`${path}: expected ${windowsRuntime.size} bytes, got ${bytes.length}`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== windowsRuntime.sha256) throw new Error(`${path}: SHA-256 differs from official Node ${windowsRuntime.version}`)
  return { version: windowsRuntime.version, size: bytes.length, sha256 }
}

export function verifyWindowsAssets(directory, runtimeOnly = false) {
  const result = verifyWindowsRuntime(join(directory, 'node.exe'))
  if (runtimeOnly) return result
  for (const name of ['yunhulaoda-desktop.exe', 'WebView2Loader.dll']) verifyPe(readFileSync(join(directory, name)), name)
  // Microsoft's Evergreen bootstrapper is x86 and installs the appropriate runtime on x64 Windows.
  verifyPe(readFileSync(join(directory, 'MicrosoftEdgeWebview2Setup.exe')), 'MicrosoftEdgeWebview2Setup.exe', [0x14c, 0x8664])
  const bundle = readFileSync(join(directory, 'server-bundle.mjs'), 'utf8')
  if (!bundle.includes('/bot-ai/proof') || !bundle.includes('createServer')) throw new Error('sidecar bundle is missing or incomplete')
  const html = readFileSync(join(directory, 'dist', 'index.html'), 'utf8')
  const assets = [...html.matchAll(/(?:src|href)=["']\.\/([^"']+)["']/g)].map(match => match[1])
  if (!assets.some(name => name.endsWith('.js'))) throw new Error('frontend entry script is missing')
  for (const asset of assets) {
    if (asset.includes('..') || !statSync(join(directory, 'dist', asset)).size) throw new Error(`frontend asset is invalid: ${asset}`)
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), runtimeOnly = args.includes('--runtime-only')
    const directory = resolve(args.find(arg => !arg.startsWith('--')) || 'src-tauri/resources')
    console.log('PASS: Windows assets verified', verifyWindowsAssets(directory, runtimeOnly))
  } catch (error) { console.error('Windows packaging refused:', error.message); process.exitCode = 1 }
}
