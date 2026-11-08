import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPe, verifyWindowsRuntime, windowsRuntime } from './verify-windows-assets.mjs'

test('invalid executable headers never pass packaging', () => {
  assert.throws(() => verifyPe(Buffer.alloc(0)), /DOS header/)
  const bytes = Buffer.alloc(64); bytes.write('MZ'); bytes.writeUInt32LE(4096, 0x3c)
  assert.throws(() => verifyPe(bytes), /PE header/)
})

// Runs against the actual runtime used by this build, including the 1.0.19 truncation.
test('official runtime passes; 72 MiB prefix and same-size corruption fail', async () => {
  const path = process.env.WINDOWS_NODE_EXE || 'src-tauri/resources/node.exe'
  const verified = verifyWindowsRuntime(path)
  assert.equal(verified.sha256, windowsRuntime.sha256)
  const bytes = await readFile(path), temp = await mkdtemp(join(tmpdir(), 'yh-windows-assets-'))
  try {
    const broken = join(temp, 'broken.exe')
    await writeFile(broken, bytes.subarray(0, 72 * 1024 * 1024))
    assert.throws(() => verifyWindowsRuntime(broken), /truncated .* section/)
    bytes[bytes.length - 1] ^= 1
    await writeFile(broken, bytes)
    assert.throws(() => verifyWindowsRuntime(broken), /SHA-256 differs/)
    const wrongArchitecture = Buffer.from(bytes)
    wrongArchitecture.writeUInt16LE(0x14c, wrongArchitecture.readUInt32LE(0x3c) + 4)
    assert.throws(() => verifyPe(wrongArchitecture), /x64 executable/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
