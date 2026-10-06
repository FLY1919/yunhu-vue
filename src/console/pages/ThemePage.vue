<script setup lang="ts">
/** 主题页：预设配色 / 主色调 / 壁纸 / 圆角 */
import { inject, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { shade } from '../../plugins/theme'

const ctx = inject<any>('ctx')
const theme = ctx.theme
const ui = ctx.ui

const groups = computed(() => [...new Set(theme.presets.map((p: any) => p.group || '内置'))])

const accent = computed({
  get: () => theme.state.accent || theme.current().accent,
  set: (v: string) => theme.setAccent(v),
})
</script>

<template>
  <KLayout ns="theme" title="主题" desc="配色、壁纸与圆角，即时生效并记住选择">
    <template #actions>
      <button class="ghost small" @click="theme.reset()">恢复默认</button>
      <button class="ghost small" @click="ui.toggleTheme()">
        深色 / 浅色（当前 {{ ui.state.theme === 'dark' ? '深色' : '浅色' }}）
      </button>
    </template>

    <KCard v-for="g in groups" :key="g" :title="g">
      <div class="presets">
        <button v-for="p in theme.presets.filter((x: any) => (x.group || '内置') === g)" :key="p.id"
                class="preset" :class="{ on: theme.state.preset === p.id }"
                @click="theme.setPreset(p.id)">
          <span class="swatch" :style="{ background: `linear-gradient(135deg, ${p.accent}, ${shade(p.accent, -25)})` }"></span>
          <span class="pname">{{ p.name }}</span>
          <span class="pmode">{{ p.mode === 'dark' ? '深色' : '浅色' }}</span>
        </button>
      </div>
    </KCard>

    <KCard title="主色调" class="mt">
      <div class="rowline">
        <input type="color" :value="accent" @input="(e: any) => theme.setAccent(e.target.value)" />
        <input class="hex" :value="accent" @change="(e: any) => theme.setAccent(e.target.value)" placeholder="#5a8cf8" />
        <button class="ghost small" @click="theme.setAccent('')">跟随预设</button>
      </div>
      <p class="dim small mt-sm">主色调会派生出 --acc / --acc2 / --acc-soft 三个变量。</p>
    </KCard>

    <KCard title="壁纸">
      <div class="rowline">
        <input class="grow" v-model="theme.state.wallpaper" placeholder="图片 URL，留空则不使用" />
        <button class="small" @click="theme.setWallpaper(theme.state.wallpaper)">应用</button>
        <button class="ghost small" @click="theme.setWallpaper('')">清除</button>
      </div>
      <div class="rowline mt-sm">
        <span class="dim small">模糊 {{ theme.state.blur }}px</span>
        <input type="range" min="0" max="20" :value="theme.state.blur"
               @input="(e: any) => theme.setBlur(e.target.value)" />
      </div>
    </KCard>

    <KCard title="看板娘贴纸" class="mt">
      <div class="rowline">
        <input class="grow" v-model="theme.state.sticker" placeholder="贴纸图片 URL（Doki 主题自带）" />
        <button class="small" @click="theme.setSticker(theme.state.sticker)">应用</button>
        <button class="ghost small" @click="theme.setSticker('')">清除</button>
        <button class="ghost small" @click="theme.toggleSticker()">
          {{ theme.state.showSticker ? '隐藏' : '显示' }}
        </button>
      </div>
      <div class="rowline mt-sm">
        <span class="dim small">透明度 {{ theme.state.stickerOpacity.toFixed(2) }}</span>
        <input type="range" min="0" max="1" step="0.05" :value="theme.state.stickerOpacity"
               @input="(e: any) => theme.setStickerOpacity(e.target.value)" />
      </div>
      <p class="dim small mt-sm">Doki 系列主题自带对应角色的贴纸（来自 doki-theme-assets）。</p>
    </KCard>

    <KCard title="圆角" class="mt">
      <div class="rowline">
        <input type="range" min="0" max="20" :value="theme.state.radius"
               @input="(e: any) => theme.setRadius(e.target.value)" />
        <span class="dim small">{{ theme.state.radius }}px</span>
      </div>
    </KCard>

    <KCard title="预览" class="mt">
      <div class="preview">
        <button class="small">主按钮</button>
        <button class="ghost small">次按钮</button>
        <span class="pill">标签</span>
        <span class="bubble-demo">这是一条消息气泡，看看圆角与配色</span>
      </div>
    </KCard>
  </KLayout>
</template>

<style scoped>
.presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.preset {
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
  background: var(--card2); color: var(--fg); font-weight: 400;
  border: 1px solid var(--line); padding: 12px; border-radius: 10px;
}
.preset.on { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-soft); }
.swatch { width: 100%; height: 34px; border-radius: 7px; }
.pname { font-weight: 600; font-size: 13.5px; }
.pmode { font-size: 11px; color: var(--fg2); }
.rowline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rowline .grow, .hex { flex: 1; min-width: 160px; }
input[type='color'] { width: 46px; height: 34px; padding: 2px; cursor: pointer; }
input[type='range'] { flex: 1; min-width: 160px; }
.preview { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.bubble-demo {
  background: var(--bubble); border-radius: var(--radius, 10px); padding: 9px 13px; font-size: 13px;
}
</style>
