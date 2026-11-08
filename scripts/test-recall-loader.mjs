// Lightweight dependency boundary for the focused chat integration test.
// Production builds still use the real Vue, Schemastery and SFC compiler.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const stub = code => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true })
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vue') return stub('export const computed = fn => ({ get value() { return fn() } }); export const reactive = v => v; export const toRaw = v => v; export const watch = () => () => {};')
  if (specifier === 'schemastery') return stub('const s = new Proxy(() => s, { get: () => s, apply: () => s }); export default s;')
  if (specifier.endsWith('.vue')) return stub('export default {};')
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL)
    if (existsSync(fileURLToPath(url) + '.ts')) return { url: url.href + '.ts', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
