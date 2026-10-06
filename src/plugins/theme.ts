/**
 * theme 插件（仿 Koishi 的主题插件）
 * ------------------------------------------------------------------
 * 参考实现：
 *   · koishi-plugin-theme-neonheart（Vincent-the-gamer）—— 霓虹发光 + 渐变背景
 *   · koishi-plugin-theme-doki（lgc-KoiDev）———— Doki Theme 配色 + 壁纸 + 看板娘贴纸
 *     （配色取自 doki-theme/doki-master-theme 的 VS Code 主题定义）
 *
 * 能力：
 *   · 预设配色（含深/浅）、主色调派生、壁纸 + 模糊、圆角
 *   · 每个预设可带一段附加 CSS（注入 <style id="yh-theme-css">）
 *   · 看板娘贴纸：URL / 透明度 / 水平垂直偏移
 *   · 自带「主题」控制台页面，配置写在 yunhu.config.yml → plugins.theme
 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import ThemePage from '../console/pages/ThemePage.vue'
import SettingsUserPage from '../console/pages/SettingsUserPage.vue'

export interface ThemePreset {
  id: string
  name: string
  group?: string
  mode: 'dark' | 'light'
  accent: string
  bg?: string
  rail?: string
  card?: string
  border?: string
  fg?: string
  fg2?: string
  /** 附加 CSS（注入 <style id="yh-theme-css">） */
  css?: string
  /** 看板娘贴纸 URL */
  sticker?: string
}

const DOKI_CDN = 'https://cdn.jsdmirror.com/gh/doki-theme/doki-theme-assets@master/'

/* ---------------- 颜色工具 ---------------- */
function hex2rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
function rgb2hex(r: number, g: number, b: number): string {
  const f = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + f(r) + f(g) + f(b)
}
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hex2rgb(hex)
  const t = amount < 0 ? 0 : 255
  const p = Math.abs(amount) / 100
  return rgb2hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}
function alpha(hex: string, a: number): string {
  const [r, g, b] = hex2rgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/* ===================================================================
 *  预设
 * =================================================================== */

/** NeonHeart：霓虹发光 + 渐变背景（深/浅两套） */
const NEON_CSS_DARK = `
.rail-btn.on { background: rgba(255,51,255,.18); color: #ff8bff; }
.rail-btn.on::before { background: #ff33ff; box-shadow: 0 0 8px #ff33ff; }
.k-card:hover, .convs li:hover, .preset:hover {
  box-shadow: 0 0 10px deeppink, 1px 0 15px deeppink, -1px 0 20px deeppink;
  transition: box-shadow .3s;
}
.chat-header .t, .k-title h2 { text-shadow: 0 0 10px #ff33ff; }
.bubble { text-shadow: 0 0 6px rgba(255,51,255,.55); }
.row.right .bubble { text-shadow: 0 0 6px rgba(255,255,255,.5); }
button { color: #fff; text-shadow: 0 0 5px #ff33ff, 0 0 10px #ff33ff; }
.rail-logo { background: linear-gradient(135deg, #9700ff, #d20076); }
.k-header, .statusbar { backdrop-filter: blur(6px); }
.badge { box-shadow: 0 0 8px #ff33ff; }
`
const NEON_BG_DARK = 'linear-gradient(45deg, #00009c, #9700ff, #d20076)'
const NEON_BG_LIGHT = 'linear-gradient(45deg, #d8c7ff, #ffd6f5, #cfe3ff)'

export const PRESETS: ThemePreset[] = [
  { id: 'yunhu', name: '云湖蓝', group: '内置', mode: 'dark', accent: '#5a8cf8' },
  { id: 'midnight', name: '深夜紫', group: '内置', mode: 'dark', accent: '#a78bfa', bg: '#141225', rail: '#0d0b1a', card: '#1d1a33' },
  { id: 'forest', name: '森野绿', group: '内置', mode: 'dark', accent: '#34d399', bg: '#101a16', rail: '#0a1310', card: '#17241e' },
  { id: 'sunset', name: '落日橙', group: '内置', mode: 'dark', accent: '#fb923c', bg: '#1a1411', rail: '#120d0a', card: '#241c17' },
  { id: 'sakura', name: '樱花粉', group: '内置', mode: 'light', accent: '#ec4899', bg: '#fdf3f8', rail: '#ffffff', card: '#ffffff' },
  { id: 'minimal', name: '极简灰', group: '内置', mode: 'light', accent: '#64748b' },

  /* ---------------- NeonHeart ---------------- */
  {
    id: 'neonheart-dark', name: 'NeonHeart Dark', group: 'NeonHeart', mode: 'dark',
    accent: '#ff33ff', bg: 'transparent', rail: 'transparent', card: 'rgba(20,0,40,.55)',
    border: '#c297ff', fg: '#ffffff', fg2: '#e3b8ff',
    css: NEON_CSS_DARK + `.messages::before { background: ${NEON_BG_DARK} !important; opacity: .55 !important; }`,
  },
  {
    id: 'neonheart-light', name: 'NeonHeart Light', group: 'NeonHeart', mode: 'light',
    accent: '#c026d3', bg: 'transparent', rail: 'rgba(255,255,255,.7)', card: 'rgba(255,255,255,.82)',
    border: '#e9a8ff', fg: '#3b0764', fg2: '#7e22ce',
    css: `
.k-card:hover, .convs li:hover { box-shadow: 0 0 10px #e879f9, 0 0 20px #f0abfc; transition: box-shadow .3s; }
.rail-btn.on { background: rgba(192,38,211,.14); color: #c026d3; }
.rail-logo { background: linear-gradient(135deg, #a855f7, #ec4899); }
.messages::before { background: ${NEON_BG_LIGHT} !important; opacity: .75 !important; }
`,
  },

  /* ---------------- Doki Theme ---------------- */
  {
    id: 'doki-monika', name: 'Monika Dark', group: 'Doki · Literature Club', mode: 'dark',
    accent: '#388E3C', bg: '#1A1E12', rail: '#14180e', card: '#1d2115', border: '#2b331d', fg: '#d6e0c8', fg2: '#8fa07a',
    sticker: DOKI_CDN + 'stickers/vscode/literature/monika/just_monika_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#388E3C,#7ac142); } .bubble { background:#232a17; }`,
  },
  {
    id: 'doki-mai', name: 'Mai Dark', group: 'Doki · Bunny Senpai', mode: 'dark',
    accent: '#fee3cf', bg: '#25254B', rail: '#1c1c3c', card: '#242448', border: '#33335f', fg: '#e6e6ff', fg2: '#a0a0cf',
    sticker: DOKI_CDN + 'stickers/vscode/bunnySenpai/mai/mai_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#5b5bff,#fee3cf); } .row.right .bubble { color:#2a2a52; }`,
  },
  {
    id: 'doki-nagatoro', name: 'Hayase Nagatoro', group: 'Doki · 不要欺负我', mode: 'dark',
    accent: '#d2824e', bg: '#1d1d1d', rail: '#151515', card: '#151515', border: '#2c2b2b', fg: '#e0e0e0', fg2: '#8f8f8f',
    sticker: DOKI_CDN + 'stickers/vscode/dontToyWithMeMiss/nagatoro/nagatoro_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#d2824e,#7a3f18); }`,
  },
  {
    id: 'doki-rias', name: 'Rias: Crimson', group: 'Doki · High School DxD', mode: 'dark',
    accent: '#e03943', bg: '#401112', rail: '#2c0b0c', card: '#3E1010', border: '#5a1c1c', fg: '#fafafa', fg2: '#d3a0a2',
    sticker: DOKI_CDN + 'stickers/vscode/highSchoolDxD/rias/rias_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#e03943,#7c1d22); } .badge { box-shadow: 0 0 8px #e03943; }`,
  },
  {
    id: 'doki-emilia', name: 'Emilia Dark', group: 'Doki · Re:Zero', mode: 'dark',
    accent: '#a53ba0', bg: '#4e3162', rail: '#3a2450', card: '#492d5a', border: '#5d416e', fg: '#efe6f7', fg2: '#c0a8d6',
    sticker: DOKI_CDN + 'stickers/vscode/reZero/emilia/emilia_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#a53ba0,#6d3f8f); }`,
  },
  {
    id: 'doki-ishtar-dark', name: 'Ishtar Dark', group: 'Doki · Fate', mode: 'dark',
    accent: '#f5c443', bg: '#0f0d0e', rail: '#0a0a06', card: '#141210', border: '#2a2616', fg: '#e8e4d8', fg2: '#a09a86',
    sticker: DOKI_CDN + 'stickers/vscode/fate/ishtar/ishtar_dark.png',
    css: `.rail-logo { background: linear-gradient(135deg,#f5c443,#8a6a12); }`,
  },
  {
    id: 'doki-ishtar-light', name: 'Ishtar Light', group: 'Doki · Fate', mode: 'light',
    accent: '#f5a821', bg: '#fffffc', rail: '#fffefb', card: '#ffffff', border: '#eeeeee', fg: '#252427', fg2: '#7b7b74',
    sticker: DOKI_CDN + 'stickers/vscode/fate/ishtar/ishtar_light.png',
    css: `.rail-logo { background: linear-gradient(135deg,#f5a821,#d97b00); }`,
  },
]

export const name = 'theme'

export interface ThemeCfg {
  preset: string
  radius: number
}

export const themeConfig: Schema<ThemeCfg> = Schema.object({
  preset: Schema.string().default('dark').description('默认配色预设'),
  radius: Schema.number().default(8).role('slider').description('圆角大小（像素）'),
})

export const themePlugin = {
  Config: themeConfig,
  name: 'theme',
  inject: ['ui'],
  provide: ['theme'],

  apply(ctx: Context, config: any = {}) {
    const saved = JSON.parse(localStorage.getItem('yh.theme.pref') || 'null') || {}
    const state = reactive({
      preset: saved.preset || config.preset || 'yunhu',
      accent: saved.accent || config.accent || '',
      wallpaper: saved.wallpaper || config.wallpaper || '',
      radius: saved.radius ?? config.radius ?? 10,
      blur: saved.blur ?? config.blur ?? 0,
      sticker: saved.sticker ?? config.sticker ?? '',
      stickerOpacity: saved.stickerOpacity ?? config.stickerOpacity ?? 0.35,
      stickerX: saved.stickerX ?? config.stickerX ?? '0px',
      stickerY: saved.stickerY ?? config.stickerY ?? '0px',
      showSticker: saved.showSticker ?? config.showSticker ?? true,
    })

    const current = (): ThemePreset => PRESETS.find(p => p.id === state.preset) || PRESETS[0]

    function ensureStyle(): HTMLStyleElement {
      let el = document.getElementById('yh-theme-css') as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = 'yh-theme-css'
        document.head.appendChild(el)
      }
      return el
    }

    function ensureSticker(): HTMLDivElement {
      let el = document.getElementById('yh-sticker') as HTMLDivElement | null
      if (!el) {
        el = document.createElement('div')
        el.id = 'yh-sticker'
        el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;background-repeat:no-repeat;'
        document.body.appendChild(el)
      }
      return el
    }

    /** 把主题写进 CSS 变量 / 注入附加 CSS / 应用贴纸 */
    function apply() {
      const root = document.documentElement
      const p = current()
      const accent = state.accent || p.accent

      root.dataset.theme = p.mode
      root.style.setProperty('--acc', accent)
      root.style.setProperty('--acc2', shade(accent, p.mode === 'dark' ? -14 : -12))
      root.style.setProperty('--acc-soft', alpha(accent, p.mode === 'dark' ? 0.16 : 0.1))
      root.style.setProperty('--radius', state.radius + 'px')

      const setOrClear = (name: string, val?: string) => {
        if (val) root.style.setProperty(name, val)
        else root.style.removeProperty(name)
      }
      setOrClear('--bg', p.bg)
      setOrClear('--rail', p.rail)
      setOrClear('--card', p.card)
      setOrClear('--line', p.border)
      setOrClear('--fg', p.fg)
      setOrClear('--fg2', p.fg2)

      if (state.wallpaper) root.style.setProperty('--wallpaper', `url("${state.wallpaper}")`)
      else root.style.removeProperty('--wallpaper')
      root.style.setProperty('--wallpaper-blur', state.blur + 'px')

      // 附加 CSS
      ensureStyle().textContent = p.css || ''

      // 看板娘贴纸
      const stickerUrl = state.sticker || p.sticker || ''
      const el = ensureSticker()
      if (stickerUrl && state.showSticker) {
        el.style.display = 'block'
        el.style.backgroundImage = `url("${stickerUrl}")`
        el.style.backgroundPosition = `bottom ${state.stickerY} right ${state.stickerX}`
        el.style.backgroundSize = 'contain'
        el.style.opacity = String(state.stickerOpacity)
      } else {
        el.style.display = 'none'
      }

      localStorage.setItem('yh.theme.pref', JSON.stringify({ ...state }))
    }

    const theme = {
      state,
      presets: PRESETS,
      current,
      apply,
      setPreset(id: string) { state.preset = id; state.accent = ''; state.sticker = ''; apply() },
      setAccent(hex: string) { state.accent = hex; apply() },
      setWallpaper(url: string) { state.wallpaper = url; apply() },
      setRadius(n: number) { state.radius = Number(n) || 0; apply() },
      setBlur(n: number) { state.blur = Number(n) || 0; apply() },
      setSticker(url: string) { state.sticker = url; apply() },
      setStickerOpacity(n: number) { state.stickerOpacity = Number(n); apply() },
      setStickerOffset(x: string, y: string) { state.stickerX = x; state.stickerY = y; apply() },
      toggleSticker() { state.showSticker = !state.showSticker; apply() },
      reset() {
        state.preset = 'yunhu'; state.accent = ''; state.wallpaper = ''
        state.radius = 10; state.blur = 0
        state.sticker = ''; state.showSticker = true; state.stickerOpacity = 0.35
        apply()
      },
    }

    if (config.mode) (ctx as any).ui?.setTheme?.(config.mode)

    // cordis 的 effect 回调必须返回一个「可销毁物」，卸载时自动执行
    ctx.effect(() => { apply(); return () => { /* 主题副作用随插件卸载回收 */ } })
    ctx.set('theme', theme)
    ctx.logger?.info(`theme 插件已加载（${current().name}）`)

    /* ---- 控制台扩展：主题页 ---- */
    ctx.inject(['console'], (ctx: Context) => {
      ctx.console.addEntry((cc: any) => {
                cc.settings({
          id: 'appearance',
          title: '外观（用户设置）',
          schema: themeConfig,
          value: { preset: 'dark', radius: 8 },
        })
cc.page({ name: '主题', path: '/theme', icon: 'palette', order: 850, component: ThemePage })
        cc.page({ name: '用户设置', path: '/settings-user', icon: 'sliders', order: 870, component: SettingsUserPage })
      })
    })
  },
}
