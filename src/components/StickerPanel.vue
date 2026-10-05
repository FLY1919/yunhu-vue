<script setup lang="ts">
/**
 * 表情面板（输入区「表情」按钮唤起，走 chat 的 global 插槽）。
 *
 * 数据：/v1/expression/list（个人收藏）。
 * 发送：把选中项包成 h.sticker(...) 走 chat.sendMedia（content_type=7）。
 * 过滤：url 为空或 CDN 上已不存在的 .tmp 条目直接不显示（否则一片裂图）。
 * 收藏/置顶/删除：expression/create、expression/topping、expression/delete。
 */
import { inject, computed } from 'vue'
import { resUrl } from '../core/res'

const ctx = inject<any>('ctx')
const st = ctx.stickers
const s = st.state

const list = computed(() => {
  // 过滤掉 url 为空的、以及 CDN 上已不存在的 .tmp 条目
  let arr = (s.list || []).filter((e: any) => {
    const u = String(e.urlOriginal || e.url || '')
    return u && !u.endsWith('.tmp')
  })
  const k = s.keyword.trim()
  if (k) arr = arr.filter((e: any) => String(e.id).includes(k))
  return arr
})

/** 收藏里的 url 是相对 key（expression/xxx.jpg），要补域名 */
function src(e: any) {
  const u = e.urlOriginal || e.url || ''
  return resUrl(u)
}
</script>

<template>
  <div v-if="s.panelOpen" class="sp-mask" @click.self="st.close()">
    <div class="sp">
      <header>
        <b>表情</b>
        <span class="dim small">{{ s.list.length }} 个收藏</span>
        <span class="grow"></span>
        <input v-model="s.keyword" placeholder="搜索…" style="max-width: 130px" />
        <label class="ghost small file">
          <input type="file" accept="image/*" hidden @change="(e: any) => st.uploadAndAdd(e)" />上传并收藏
        </label>
        <button class="ghost small" @click="st.load()">刷新</button>
        <button class="sp-x" @click="st.close()">×</button>
      </header>

      <div class="sp-body">
        <div class="grid">
          <button v-for="e in list" :key="e.id" class="cell" :title="'点击发送'" @click="st.send(e)">
            <img :src="src(e)" loading="lazy" alt=""
                 @error="(ev: any) => { ev.target.style.visibility = 'hidden' }" />
            <span class="top" @click.stop="st.topping(e)" title="置顶">↑</span>
            <span class="del" @click.stop="st.remove(e)" title="从收藏删除">×</span>
          </button>
        </div>
        <p v-if="!list.length" class="dim center">
          {{ s.loading ? '加载中…' : '还没有收藏。可以用「上传并收藏」加一张，或在消息图片上右键收藏。' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 190; display: flex; align-items: flex-end; justify-content: center; }
.sp { width: 720px; max-width: 96vw; max-height: 62vh; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px 14px 0 0; box-shadow: var(--shadow); overflow: hidden; }
.sp > header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.sp > header .grow { flex: 1; }
.sp-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.sp-body { overflow: auto; padding: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
.cell { position: relative; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 9px; background: var(--card2); padding: 4px; cursor: pointer; overflow: hidden; }
.cell:hover { border-color: var(--acc); }
.cell img { width: 100%; height: 100%; object-fit: contain; }
.top { position: absolute; top: 2px; left: 4px; font-size: 12px; color: var(--fg2); background: var(--card); border-radius: 50%; width: 16px; height: 16px; line-height: 15px; text-align: center; opacity: 0; }
.cell:hover .top { opacity: .9; }
.top:hover { color: var(--acc); }
.del { position: absolute; top: 2px; right: 4px; font-size: 13px; color: var(--fg2); background: var(--card); border-radius: 50%; width: 16px; height: 16px; line-height: 15px; text-align: center; opacity: 0; }
.cell:hover .del { opacity: .9; }
.del:hover { color: var(--err); }
.file { display: inline-flex; align-items: center; cursor: pointer; padding: 3px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); }
.center { text-align: center; padding: 22px 0; }
</style>
