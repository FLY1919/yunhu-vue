<script setup lang="ts">
/**
 * 表情页（stickers 插件注册）
 *   左：我收藏的表情包（/v1/sticker/list）—— 可以创建、重命名、删除、导入 zip、看包内表情
 *   右：个人表情收藏（/v1/expression/list）—— 可以置顶、删除、上传新增
 */
import { inject, ref, onMounted, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res'

const ctx = inject<any>('ctx')
const st = ctx.stickers
const s = st.state

const newPack = ref('')
const editing = ref<any>(null)

const favCount = computed(() => (s.list || []).length)

onMounted(() => { st.load(); ctx.stickers.loadPacks?.() })

function src(u: string) {
  const v = String(u || '')
  if (!v) return ''
  return /^https?:/i.test(v) ? v : resUrl(v.startsWith('sticker/') || v.startsWith('expression/') ? v : `sticker/${v}`)
}

async function importZip(ev: any) {
  const f = ev?.target?.files?.[0]
  if (!f) return
  try {
    // zip 必须带 stickerZip/ 前缀（云湖约定）
    const res: any = await ctx.api.uploadFile(f, 'sticker')
    const key = typeof res === 'string' ? res : res?.key
    if (!key) throw new Error('上传没拿到 key')
    const name = window.prompt('这个表情包叫什么？', f.name.replace(/\.zip$/i, '')) || f.name.replace(/\.zip$/i, '')
    await ctx.api.stickerImportPack(name, key)
    ctx.ui.toast('导入成功', 'success')
    await st.loadPacks()
  } catch (e: any) { ctx.ui.toast('导入失败：' + e.message, 'error') }
  ev.target.value = ''
}
</script>

<template>
  <KLayout ns="stickers" title="表情" desc="表情包与个人收藏的管理">
    <template #actions>
      <span class="pill">{{ (s.packs || []).length }} 个表情包</span>
      <span class="pill">{{ favCount }} 个收藏</span>
      <button class="ghost small" @click="st.loadPacks(); st.load()">刷新</button>
    </template>

    <KCard title="表情包">
      <div class="row">
        <input v-model="newPack" placeholder="新表情包名称" />
        <button class="small" @click="st.createPack(newPack); newPack = ''">创建</button>
        <label class="ghost small file">
          <input type="file" accept=".zip,application/zip" hidden @change="importZip" />导入 zip
        </label>
      </div>

      <div class="packs">
        <div v-for="p in s.packs || []" :key="p.id" class="pack">
          <div class="phead">
            <b>{{ p.name }}</b>
            <span class="dim small">{{ p.items.length }} 张 · {{ p.userCount }} 人在用</span>
            <span class="grow"></span>
            <div class="acts">
              <button class="ghost small" @click="editing = { ...p }">重命名</button>
              <button class="ghost small" @click="st.removePack(p)">移除收藏</button>
              <button v-if="String(p.createBy) === String(ctx.auth?.state?.user?.id)" class="ghost small danger"
                      @click="st.deletePack(p)">删除</button>
            </div>
          </div>
          <div class="grid">
            <img v-for="i in p.items.slice(0, 14)" :key="i.id" :src="src(i.urlOriginal || i.url)" loading="lazy" alt="" />
            <span v-if="p.items.length > 14" class="more">+{{ p.items.length - 14 }}</span>
          </div>
        </div>
        <p v-if="!(s.packs || []).length" class="dim center">{{ s.packsLoading ? '加载中…' : '还没有收藏表情包' }}</p>
      </div>
    </KCard>

    <KCard title="个人收藏（发送表情时用这个）" class="mt" :pad="false">
      <div class="grid wide">
        <div v-for="e in s.list || []" :key="e.id" class="cell">
          <img :src="src(e.urlOriginal || e.url)" loading="lazy" alt=""
               @error="(ev: any) => (ev.target.style.visibility = 'hidden')" />
          <span class="top" @click="st.topping(e)" title="置顶">↑</span>
          <span class="del" @click="st.remove(e)" title="删除">×</span>
        </div>
      </div>
      <p v-if="!(s.list || []).length" class="dim center">还没有收藏</p>
    </KCard>

    <!-- 重命名弹窗 -->
    <div v-if="editing" class="mask" @click.self="editing = null">
      <KCard title="重命名表情包" style="width: 380px; max-width: 92vw">
        <div class="row">
          <input v-model="editing.name" />
          <button class="small" @click="st.renamePack(editing.id, editing.name); editing = null">保存</button>
          <button class="ghost small" @click="editing = null">取消</button>
        </div>
      </KCard>
    </div>
  </KLayout>
</template>

<style scoped>
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 130px; }
.file { display: inline-flex; align-items: center; cursor: pointer; padding: 3px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); }
.packs { margin-top: 10px; display: flex; flex-direction: column; gap: 12px; }
.pack { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.phead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.acts { display: flex; gap: 6px; flex: 1 0 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.acts::-webkit-scrollbar { display: none; }
.acts > * { flex: 0 0 auto; }
.phead .grow { flex: 1; }
.grid { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.grid img { width: 44px; height: 44px; object-fit: contain; border-radius: 7px; background: var(--card2); }
.grid.wide { padding: 12px; }
.more { font-size: 12px; color: var(--fg2); }
.cell { position: relative; width: 56px; height: 56px; border: 1px solid var(--line); border-radius: 9px; background: var(--card2); padding: 4px; }
.cell img { width: 100%; height: 100%; object-fit: contain; }
.top, .del { position: absolute; top: 1px; font-size: 12px; color: var(--fg2); width: 16px; height: 16px; line-height: 15px; text-align: center; border-radius: 50%; background: var(--card); opacity: 0; cursor: pointer; }
.top { left: 2px; } .del { right: 2px; }
.cell:hover .top, .cell:hover .del { opacity: .9; }
.top:hover { color: var(--acc); } .del:hover { color: var(--err); }
.center { text-align: center; padding: 16px 0; }
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 200; display: flex; align-items: center; justify-content: center; }
.mt { margin-top: 12px; }
</style>
