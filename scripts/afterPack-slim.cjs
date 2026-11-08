/**
 * electron-builder afterPack 钩子：砍掉运行时用不到的大块组件，压缩安装包与安装后体积。
 * 依据（实测解包便携版 393MB 的构成）：
 *   · locales/ 49MB —— 只保留 zh-CN / en-US
 *   · dxcompiler.dll 25MB —— DirectX 着色器编译器，Chromium 缺失时自动回退，删
 *   · d3dcompiler_47.dll 5MB —— Win10+ 系统自带，删（Electron 官方说明）
 *   · vk_swiftshader.dll 6MB —— 软件 Vulkan 回退；无 GPU 环境才需要，删（目标机均有 GPU）
 * node_modules 不进 asar 由 package.json build.files 的排除规则负责
 * （main.cjs 只 require electron 与 node 内置模块，前端依赖已编译进 dist）。
 */
const fs = require('fs')
const path = require('path')

const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak', 'zh_CN.pak', 'en_US.pak'])
const DROP_FILES = ['dxcompiler.dll', 'dxil.dll', 'd3dcompiler_47.dll', 'vk_swiftshader.dll', 'libEGL.dll.keep']

exports.default = async function afterPack(context) {
  const root = context.appOutDir
  // 1) locales 只留中英文
  const loc = path.join(root, 'locales')
  if (fs.existsSync(loc)) {
    for (const f of fs.readdirSync(loc)) {
      if (!KEEP_LOCALES.has(f)) fs.rmSync(path.join(loc, f), { force: true })
    }
  }
  // 2) 删可回退的大 dll
  for (const f of DROP_FILES) {
    const p = path.join(root, f)
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
  }
  // 3) LICENSES.chromium.html 20MB 纯文本：压成一行说明（合规声明保留在关于页与仓库）
  const lic = path.join(root, 'LICENSES.chromium.html')
  if (fs.existsSync(lic)) {
    fs.writeFileSync(lic, '<html><body>Chromium licenses: see https://chromium.googlesource.com/chromium/src/+/main/LICENSE</body></html>')
  }
  console.log('[afterPack] slimmed locales/dxcompiler/d3dcompiler/swiftshader/licenses in', root)
}
