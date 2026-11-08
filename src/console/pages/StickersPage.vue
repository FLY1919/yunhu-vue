<script setup lang="ts">
/**
 * 表情页（stickers 插件注册）
 *   左：我收藏的表情包（/v1/sticker/list）—— 可以创建、重命名、删除、导入 zip、看包内表情
 *   右：个人表情收藏（/v1/expression/list）—— 可以置顶、删除、上传新增
 */
import { inject, ref, onMounted, onUnmounted, computed } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res'

const ctx = inject<any>('ctx')
const st = ctx.stickers
const s = st.state

const newPack = ref('')
const editing = ref<any>(null)

const favCount = computed(() => (s.list || []).length)

onMounted(() => {
  st.load(); ctx.stickers.loadPacks?.()
  document.addEventListener('paste', onPastePack)
})
onUnmounted(() => document.removeEventListener('paste', onPastePack))

/** Ctrl+V 粘贴图片 → 上传到当前展开的合集（未展开合集时提示先展开） */
async function onPastePack(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (f && f.type.startsWith('image/')) files.push(f)
  }
  if (!files.length) return
  e.preventDefault()
  if (!openPack.value) { ctx.ui?.toast?.('先点开一个表情包合集，再粘贴图片', 'warn'); return }
  for (const f of files) await st.addFileToTarget?.(f, openPack.value)
}

function src(u: string) {
  const v = String(u || '')
  if (!v) return ''
  // resUrl 统一处理：裸 key 补 img 桶域名走代理、完整 URL 改写代理；
  // ⚠️ 不要自己补 sticker/ 前缀（上传的裸 key 在桶根，补前缀 404 裂图）
  return resUrl(v)
}

/* ---- 合集展开态：左键点 pack 卡展开/收起，展开区带添加贴纸按钮 ---- */
const openPack = ref<number | null>(null)
function togglePack(id: number) {
  openPack.value = openPack.value === id ? null : id
}
async function addIntoPack(packId: number, ev: any) {
  const f: File | undefined = ev.target?.files?.[0]
  ev.target.value = ''
  if (!f) return
  await st.addFileToTarget?.(f, packId)
}

/** 完整文件名（含后缀）：优先 name，回退 url 末段 */
function fullName(e: any): string {
  if (e.name) return e.name
  const u = String(e.urlOriginal || e.url || '')
  return u.split('/').pop() || String(e.id)
}

/* ---- 批量重命名（PowerRename 式：多选 → 模式 {n}=序号 / 正则替换） ---- */
const batchMode = ref(false)
const batchSel = ref<Set<number>>(new Set())
const batchDlg = ref(false)
const batchPattern = ref('表情_{n}')
const batchStart = ref(1)
const batchRegexFrom = ref('')
const batchRegexTo = ref('')
const batchBusy = ref(false)
/** 反选：当前展开合集内，选中的取消、未选中的选上 */
function invertBatchSel() {
  const items = (s.packs || []).find((x: any) => x.id === openPack.value)?.items || []
  const next = new Set<number>()
  for (const i of items) if (!batchSel.value.has(i.id)) next.add(i.id)
  batchSel.value = next
}
const batchPreview = computed(() => {
  const pack = (s.packs || []).find((p: any) => p.id === openPack.value)
  if (!pack) return [] as Array<{ id: number; from: string; to: string }>
  const ids = [...batchSel.value]
  return ids.map((id, i) => {
    const it = (pack.items || []).find((x: any) => x.id === id)
    return { id, from: it?.name || fullName(it || { id }), to: applyPattern(batchPattern.value, batchStart.value + i, it?.name || '') }
  })
})
/** 模式应用：{n}=序号；若填了正则则先对原名做 replace */
function applyPattern(pattern: string, n: number, orig: string): string {
  let out = pattern.replace(/\{n\}/g, String(n))
  if (batchRegexFrom.value) {
    try { out = out.replace(new RegExp(batchRegexFrom.value, 'g'), batchRegexTo.value) } catch { /* 正则非法则跳过 */ }
  }
  return out || orig
}
function toggleBatchSel(id: number) {
  const s2 = new Set(batchSel.value)
  if (s2.has(id)) s2.delete(id)
  else s2.add(id)
  batchSel.value = s2
}
async function applyBatchRename() {
  const pack = (s.packs || []).find((p: any) => p.id === openPack.value)
  if (!pack || !batchSel.value.size || batchBusy.value) return
  batchBusy.value = true
  let ok = 0
  for (const row of batchPreview.value) {
    try { await ctx.api.stickerRenameSticker(row.id, row.to); ok++ } catch { /* 单条失败继续 */ }
  }
  batchBusy.value = false
  batchDlg.value = false
  batchMode.value = false
  batchSel.value = new Set()
  ctx.ui?.toast?.(`已重命名 ${ok} 张`, ok ? 'success' : 'error')
  await st.loadPacks()
}

async function importZip(ev: any) {
  const f = ev?.target?.files?.[0]
  if (!f) return
  pendingZip.value = f
  zipName.value = f.name.replace(/\.zip$/i, '')
  ev.target.value = ''
}
/** zip 导入命名（内联输入，不用原生 prompt）：上传 → import-pack */
const pendingZip = ref<File | null>(null)
const zipName = ref('')
const zipBusy = ref(false)
async function confirmZipImport() {
  const f = pendingZip.value
  if (!f || zipBusy.value) return
  zipBusy.value = true
  try {
    // zip 必须带 stickerZip/ 前缀（云湖约定）
    const res: any = await ctx.api.uploadFile(f, 'sticker')
    const key = typeof res === 'string' ? res : res?.key
    if (!key) throw new Error('上传没拿到 key')
    await ctx.api.stickerImportPack(zipName.value.trim() || f.name.replace(/\.zip$/i, ''), key)
    ctx.ui.toast('导入成功', 'success')
    pendingZip.value = null
    await st.loadPacks()
  } catch (e: any) { ctx.ui.toast('导入失败：' + e.message, 'error') }
  finally { zipBusy.value = false }
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
        <!-- zip 导入命名（内联，不用原生 prompt） -->
        <template v-if="pendingZip">
          <input v-model="zipName" placeholder="表情包名称" style="max-width: 160px" autofocus />
          <button class="small" :disabled="zipBusy || !zipName.trim()" @click="confirmZipImport">{{ zipBusy ? '导入中…' : '确认导入' }}</button>
          <button class="ghost small" @click="pendingZip = null">取消</button>
        </template>
      </div>

      <div class="packs">
        <div v-for="p in s.packs || []" :key="p.id" class="pack" @click="togglePack(p.id)">
          <div class="phead">
            <b>{{ p.name }}</b>
            <span class="dim small">{{ p.items.length }} 张 · {{ p.userCount }} 人在用</span>
            <span class="dim small">{{ openPack === p.id ? '▾ 已展开' : '▸ 点击展开合集' }}</span>
            <span class="grow"></span>
            <div class="acts" @click.stop>
              <button class="ghost small" @click="editing = { ...p }">重命名</button>
              <button class="ghost small" @click="st.removePack(p)">移除收藏</button>
              <button v-if="String(p.createBy) === String(ctx.auth?.state?.user?.id)" class="ghost small danger"
                      @click="st.deletePack(p)">删除</button>
            </div>
          </div>
          <div class="grid">
            <img v-for="i in p.items.slice(0, 14)" :key="i.id" :src="src(i.urlOriginal || i.url)" alt="" />
            <span v-if="p.items.length > 14" class="more">+{{ p.items.length - 14 }}</span>
          </div>
          <!-- 展开态：全部贴纸 + 名称 + 添加按钮 -->
          <div v-if="openPack === p.id" class="pack-open" @click.stop>
            <div class="po-bar">
              <span class="dim small">合集内容 · {{ p.items.length }} 张</span>
              <button class="ghost small" :class="{ on: batchMode }" @click="batchMode = !batchMode; batchSel = new Set()">
                {{ batchMode ? '退出多选' : '多选' }}
              </button>
              <template v-if="batchMode">
                <button class="ghost small" @click="batchSel = new Set(((s.packs || []).find((x: any) => x.id === openPack)?.items || []).map((i: any) => i.id))">全选</button>
                <button class="ghost small" @click="invertBatchSel()">反选</button>
              </template>
              <button v-if="batchMode && batchSel.size" class="ghost small" @click="batchDlg = true">
                批量重命名（{{ batchSel.size }}）
              </button>
              <span class="grow"></span>
              <label class="ghost small file">
                <input type="file" accept="image/*" hidden @change="addIntoPack(p.id, $event)" />+ 添加贴纸
              </label>
            </div>
            <div class="grid full">
              <div v-for="i in p.items" :key="i.id" class="po-cell"
                   :class="{ sel: batchSel.has(i.id) }"
                   @click="batchMode ? toggleBatchSel(i.id) : null">
                <img :src="src(i.urlOriginal || i.url)" alt="" />
                <span class="po-name" :title="fullName(i)">{{ fullName(i) }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!(s.packs || []).length" class="dim center">{{ s.packsLoading ? '加载中…' : '还没有收藏表情包' }}</p>
      </div>
    </KCard>

    <KCard title="个人收藏（发送表情时用这个）" class="mt" :pad="false">
      <div class="grid wide fav-grid">
        <div v-for="e in s.list || []" :key="e.id" class="fav-cell" :title="fullName(e)">
          <img :src="src(e.urlOriginal || e.url)" alt=""
               @error="(ev: any) => (ev.target.style.visibility = 'hidden')" />
          <span class="fav-name">{{ fullName(e) }}</span>
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
          <input v-model="editing.name" autofocus />
          <button class="small" @click="st.renamePack(editing.id, editing.name); editing = null">保存</button>
          <button class="ghost small" @click="editing = null">取消</button>
        </div>
      </KCard>
    </div>

    <!-- 批量重命名对话框（PowerRename 式：模式 {n}=序号 + 可选正则替换 + 实时预览） -->
    <div v-if="batchDlg" class="mask" @click.self="batchDlg = false">
      <KCard title="批量重命名" style="width: 460px; max-width: 94vw">
        <div class="row">
          <span class="lab">命名模式</span>
          <input v-model="batchPattern" placeholder="如：表情_{n}（{n}=序号）" autofocus />
        </div>
        <div class="row">
          <span class="lab">起始序号</span>
          <input v-model.number="batchStart" type="number" min="0" style="max-width: 90px" />
        </div>
        <div class="row">
          <span class="lab">正则替换</span>
          <input v-model="batchRegexFrom" placeholder="匹配（可空）" style="max-width: 130px" />
          <span class="dim small">→</span>
          <input v-model="batchRegexTo" placeholder="替换为" style="max-width: 130px" />
        </div>
        <div class="batch-prev">
          <div v-for="r in batchPreview.slice(0, 8)" :key="r.id" class="bp-row">
            <span class="dim small from">{{ r.from }}</span>
            <span class="dim small">→</span>
            <b>{{ r.to }}</b>
          </div>
          <div v-if="batchPreview.length > 8" class="dim small">…共 {{ batchPreview.length }} 项</div>
        </div>
        <div class="row">
          <button class="small" :disabled="batchBusy || !batchPreview.length" @click="applyBatchRename">
            {{ batchBusy ? '重命名中…' : `重命名 ${batchPreview.length} 项` }}
          </button>
          <button class="ghost small" @click="batchDlg = false">取消</button>
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
.pack { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.pack:hover { border-color: var(--acc); }
.pack-open { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; cursor: default; }
.po-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.po-bar .grow { flex: 1; }
.grid.full { gap: 10px; }
.po-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 72px; }
.po-cell img { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; background: var(--card2); }
.po-name { font-size: 10px; color: var(--fg2); max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 收藏格紧凑（与聊天右键收藏同款小格）+ 完整文件名 */
.fav-grid { gap: 8px; }
.fav-cell {
  position: relative; width: 52px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--card2); padding: 3px;
}
.fav-cell img { width: 44px; height: 44px; object-fit: contain; border-radius: 5px; }
.fav-name {
  font-size: 9px; color: var(--fg2); max-width: 50px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; text-align: center;
}
.fav-cell .top, .fav-cell .del {
  position: absolute; top: 1px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--card); color: var(--fg2); font-size: 11px; line-height: 1;
  display: grid; place-items: center; opacity: 0; cursor: pointer;
}
.fav-cell .top { left: 1px; } .fav-cell .del { right: 1px; }
.fav-cell:hover .top, .fav-cell:hover .del { opacity: .9; }
/* 多选态 */
.po-cell.sel { outline: 2px solid var(--acc); border-radius: 10px; }
.po-cell { cursor: pointer; }
/* 批量重命名预览 */
.batch-prev {
  max-height: 160px; overflow: auto; margin: 8px 0; padding: 6px 8px;
  background: var(--card2); border-radius: 8px; display: flex; flex-direction: column; gap: 3px;
}
.bp-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.bp-row .from { text-decoration: line-through; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab { flex: 0 0 64px; font-size: 12.5px; color: var(--fg2); }
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
