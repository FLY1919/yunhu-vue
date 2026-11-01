<script setup lang="ts">
/**
 * 表情面板（输入区「表情」按钮唤起，走 chat 的 global 插槽）。
 *
 * 数据：/v1/expression/list（个人收藏）。
 * 发送：把选中项包成 h.sticker(...) 走 chat.sendMedia（content_type=7）。
 * 过滤：url 为空或 CDN 上已不存在的 .tmp 条目直接不显示（否则一片裂图）。
 * 收藏/置顶/删除：expression/create、expression/topping、expression/delete。
 */
import { vResourceMedia } from '../core/resource-media'
import { inject, computed, ref, watch, onUnmounted, nextTick } from 'vue'
import { resUrl } from '../core/res'
import { orderStickerPacks, moveStickerPack, type StickerMove } from '../core/sticker-order'
import Icon from '../console/components/Icon.vue'

const ctx = inject<any>('ctx')
const st = ctx.stickers
const s = st.state
const renaming = ref<{ id: number; name: string } | null>(null)
const packRenaming = ref<{ id: number; name: string } | null>(null)
const packActionBusy = ref(false)
type PanelMenu = { kind: 'favorites' | 'pack' | 'favorite-item' | 'pack-item' | 'browse-item'; item?: any; pack?: any; x: number; y: number }
const menu = ref<PanelMenu | null>(null)
const menuEl = ref<HTMLElement | null>(null)

function closeMenu() { menu.value = null }
function openMenu(kind: PanelMenu['kind'], ev: MouseEvent, item?: any, pack?: any) {
  ev.preventDefault()
  ev.stopPropagation()
  const target = ev.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  // 键盘或“更多”按钮从按钮边缘展开；右键从鼠标位置展开。
  const x = ev.type === 'contextmenu' && (ev.clientX || ev.clientY) ? ev.clientX : rect.right
  const y = ev.type === 'contextmenu' && (ev.clientX || ev.clientY) ? ev.clientY : rect.bottom
  menu.value = { kind, item, pack, x, y }
  nextTick(() => {
    if (!menu.value || !menuEl.value) return
    const bounds = menuEl.value.getBoundingClientRect()
    menu.value.x = Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))
    menu.value.y = Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))
    menuEl.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  })
}
function navigateMenu(ev: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key) || !menuEl.value) return
  const items = Array.from(menuEl.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (!items.length) return
  ev.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1
    : ev.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length - 1 : current - 1)
  items[next].focus({ preventScroll: true })
}
function dismissMenuOnPointer(ev: PointerEvent) {
  if (menu.value && !menuEl.value?.contains(ev.target as Node)) closeMenu()
}
function dismissMenuOnKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && menu.value) { ev.preventDefault(); ev.stopPropagation(); closeMenu() }
}
function dismissMenuOnScroll(ev: Event) {
  if (menu.value && !menuEl.value?.contains(ev.target as Node)) closeMenu()
}

/** 页签：收藏 / 各表情包组（之前面板只渲染收藏，表情包组识别不到 —— 补上） */
const normalizeTab = (t: any): 'fav' | number => t === 'fav' ? 'fav' : Number(t)
const tab = ref<'fav' | number>(normalizeTab(s.activeTab || 'fav'))
const packKeyword = ref('')
const accountId = computed(() => String(ctx.auth?.state?.user?.id || ''))
const orderKey = computed(() => accountId.value ? `yh.stickers.packOrder.${accountId.value}` : '')
const packOrder = ref<string[]>([])
watch(orderKey, key => {
  try {
    const value = key ? JSON.parse(localStorage.getItem(key) || '[]') : []
    packOrder.value = Array.isArray(value) ? [...new Set(value.map(String))] : []
  } catch { packOrder.value = [] }
}, { immediate: true })
const orderedPacks = computed<any[]>(() => orderStickerPacks<any>(s.packs || [], packOrder.value))
const filteredPacks = computed(() => orderedPacks.value.filter((p: any) =>
  matches(packKeyword.value, p.name, p.id)))
function isOwnPack(pack: any): boolean {
  return !!accountId.value && !!pack?.createBy && String(pack.createBy) === accountId.value
}
function savePackOrder(ids: string[]) {
  if (!orderKey.value) { ctx.ui?.toast?.('请登录后调整排序', 'warn'); return }
  try { localStorage.setItem(orderKey.value, JSON.stringify(ids)); packOrder.value = ids }
  catch { ctx.ui?.toast?.('无法保存排序，请检查本地存储', 'error') }
}
function movePack(pack: any, direction: StickerMove) {
  savePackOrder(moveStickerPack(orderedPacks.value.map((p: any) => String(p.id)), String(pack.id), direction))
}
function packPosition(pack: any) { return orderedPacks.value.findIndex((p: any) => String(p.id) === String(pack?.id)) }
function resetPackOrder() { savePackOrder([]) }
function pickTab(t: 'fav' | number) {
  tab.value = normalizeTab(t)
  s.activeTab = tab.value
  s.keyword = ''
  closeMenu()
  renaming.value = null
  packRenaming.value = null
  st.closeBrowse()
  s.locateSticker = null          // 手动切页签即取消圈线定位
  if (t !== 'fav' && !s.packs.length) st.loadPacks?.()
}
// 外部定位（聊天里点表情 → openPackOf 设 activeTab）
watch(() => s.activeTab, (value) => {
  const t = normalizeTab(value)
  if (t !== tab.value) {
    tab.value = t
    s.keyword = ''
    packKeyword.value = ''
    closeMenu()
    renaming.value = null
    packRenaming.value = null
    if (t !== 'fav' && !s.packs.length && !s.packsLoading) st.loadPacks?.()
  }
})
// 打开面板时顺带拉一次表情包组
watch(() => s.panelOpen, (v) => { if (v && !s.packs.length && !s.packsLoading) st.loadPacks?.() }, { immediate: true })

function matches(keyword: string, ...values: any[]): boolean {
  const normalize = (value: any) => String(value ?? '').normalize('NFKC').toLowerCase()
  const q = normalize(keyword).trim()
  return !q || values.some(value => normalize(value).includes(q))
}
function filterItems(items: any[]) {
  return items.filter(e => matches(s.keyword, nameOf(e), e.id, e.itemId))
}

const list = computed(() => {
  // 过滤掉 url 为空的、以及 CDN 上已不存在的 .tmp 条目
  return (s.list || []).filter((e: any) => {
    const u = String(e.urlOriginal || e.url || '')
    return u && !u.endsWith('.tmp')
  })
})

/** 当前页签的表情包组内容 */
const packItems = computed(() => {
  if (tab.value === 'fav') return []
  // ⚠️ 包 id 可能是字符串、activeTab 可能是数字：双侧强转再比，否则合集页签空
  const p = (s.packs || []).find((x: any) => Number(x.id) === Number(tab.value))
  return (p?.items || []).filter((e: any) => e.urlOriginal || e.url)
})
const curPack = computed(() => (s.packs || []).find((x: any) => Number(x.id) === Number(tab.value)) || null)
const matchingFavs = computed(() => filterItems(list.value))
const matchingPackItems = computed(() => filterItems(packItems.value))
const matchingBrowseItems = computed(() => filterItems(s.browsePack?.items || []))
const page = ref(1)
const savedPageSize = Number(localStorage.getItem('yh.stickers.pageSize'))
const pageSize = ref([12, 24, 48, 96].includes(savedPageSize) ? savedPageSize : 24)
const matchingItems = computed(() => s.browsePack ? matchingBrowseItems.value : tab.value === 'fav' ? matchingFavs.value : matchingPackItems.value)
const pageCount = computed(() => Math.max(1, Math.ceil(matchingItems.value.length / pageSize.value)))
const pageItems = computed(() => matchingItems.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const visibleFavs = computed(() => tab.value === 'fav' ? pageItems.value : [])
const visiblePackItems = computed(() => tab.value !== 'fav' ? pageItems.value : [])
const browseItems = pageItems
const cellSize = computed(() => pageSize.value === 12 ? '152px' : pageSize.value === 24 ? '116px' : pageSize.value === 48 ? '96px' : '82px')
watch(pageSize, value => { localStorage.setItem('yh.stickers.pageSize', String(value)); page.value = 1 })
watch(() => [tab.value, s.keyword, s.browsePack?.id], () => { page.value = 1 }, { flush: 'sync' })
watch(pageCount, count => { page.value = Math.min(page.value, count) })
watch(page, () => nextTick(() => bodyEl.value?.scrollTo({ top: 0 })))
const currentTitle = computed(() => s.browsePack?.name || (tab.value === 'fav' ? '收藏' : curPack.value?.name || `表情包 ${tab.value}`))
const currentTotal = computed(() => s.browsePack ? s.browsePack.items.length : tab.value === 'fav' ? list.value.length : packItems.value.length)
const visibleCount = computed(() => matchingItems.value.length)

async function refresh() {
  await Promise.all([st.load(), st.loadPacks()])
  if (s.browsePack) await st.openPackOf({ packId: s.browsePack.id, itemId: s.browsePack.locateId })
}

/** 是否是「聊天里点进来的」要圈线高亮的那一张。
 *  收藏页签按 expression id 比，合集页签按包内贴纸 itemId 比。 */
function isLocated(e: any): boolean {
  const loc = s.locateSticker
  if (!loc || normalizeTab(loc.tab) !== tab.value) return false
  const id = Number(tab.value === 'fav' ? e.id : (e.id || e.itemId))
  return !!id && id === loc.id
}
/** 定位到目标表情并滚到可视区（圈线 + 居中） */
const bodyEl = ref<HTMLElement | null>(null)
const packListEl = ref<HTMLElement | null>(null)
function scrollLocateIntoView() {
  const index = matchingItems.value.findIndex((e: any) => s.browsePack ? Number(e.id) === Number(s.browsePack.locateId) : isLocated(e))
  if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1
  nextTick(() => {
    const body = bodyEl.value
    const hit = body?.querySelector('.cell.located') as HTMLElement | null
    if (!body || !hit) return
    // 只滚动图片区，不能把整个弹层或聊天记录一起滚走。
    const top = hit.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    body.scrollTo({ top: Math.max(0, top - (body.clientHeight - hit.offsetHeight) / 2), behavior: 'auto' })
  })
}
// activeTab / locateSticker 变化（外部定位）后，等渲染完滚动到那张
watch(() => [s.locateSticker, s.browsePack?.locateId], () => {
  if (s.locateSticker || s.browsePack?.locateId) { s.keyword = ''; packKeyword.value = '' }
}, { flush: 'sync' })
watch(() => [tab.value, s.locateSticker, s.browsePack, s.packs, s.list, s.panelOpen, s.keyword], () => {
  if (!s.panelOpen) return
  if (s.locateSticker || s.browsePack?.locateId) scrollLocateIntoView()
  else nextTick(() => bodyEl.value?.scrollTo({ top: 0 }))
}, { flush: 'post' })
watch(() => [tab.value, s.packs, s.panelOpen], () => {
  if (!s.panelOpen) return
  nextTick(() => {
    const nav = packListEl.value
    const selected = nav?.querySelector('[aria-current="true"]') as HTMLElement | null
    if (!nav || !selected) return
    const delta = selected.getBoundingClientRect().top - nav.getBoundingClientRect().top
    if (delta < 0) nav.scrollTop += delta
    else if (delta + selected.offsetHeight > nav.clientHeight) nav.scrollTop += delta + selected.offsetHeight - nav.clientHeight
  })
}, { flush: 'post' })

/** 收藏里的 url 是相对 key（expression/xxx.jpg），要补域名 */
function src(e: any) {
  const u = e.urlOriginal || e.url || ''
  return resUrl(u)
}

/** 上传到「当前选中的页签」：收藏 or 某个表情包组 */
async function onPickUpload(e: any) {
  const fs: File[] = Array.from(e.target?.files || [])
  e.target.value = ''
  if (s.browsePack) return ctx.ui?.toast?.('请先收藏该合集，再上传图片', 'warn')
  for (const f of fs) await st.addFileToTarget(f, tab.value)
}

/** 面板打开时支持直接 Ctrl+V 粘贴图片进当前页签（document 级，不依赖焦点） */
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  let took = false
  for (const it of Array.from(items)) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (!f || !f.type.startsWith('image/')) continue
    took = true
    if (!s.browsePack) st.addFileToTarget(f, tab.value)
  }
  if (took) {
    e.preventDefault()
    if (s.browsePack) ctx.ui?.toast?.('请先收藏该合集，再粘贴图片', 'warn')
  }
}
watch(() => s.panelOpen, (v) => {
  if (v) {
    document.addEventListener('paste', onPaste)
    document.addEventListener('pointerdown', dismissMenuOnPointer, true)
    document.addEventListener('keydown', dismissMenuOnKey, true)
    window.addEventListener('scroll', dismissMenuOnScroll, true)
    window.addEventListener('resize', closeMenu)
  } else {
    document.removeEventListener('paste', onPaste)
    document.removeEventListener('pointerdown', dismissMenuOnPointer, true)
    document.removeEventListener('keydown', dismissMenuOnKey, true)
    window.removeEventListener('scroll', dismissMenuOnScroll, true)
    window.removeEventListener('resize', closeMenu)
    closeMenu()
  }
}, { immediate: true })
onUnmounted(() => {
  document.removeEventListener('paste', onPaste)
  document.removeEventListener('pointerdown', dismissMenuOnPointer, true)
  document.removeEventListener('keydown', dismissMenuOnKey, true)
  window.removeEventListener('scroll', dismissMenuOnScroll, true)
  window.removeEventListener('resize', closeMenu)
  closeMenu()
})

/** 表情显示名：完整文件名（含后缀），截断交给 CSS 省略号 */
function nameOf(e: any): string {
  if (e.name) return e.name
  const u = String(e.urlOriginal || e.url || '')
  return u.split('/').pop() || String(e.id)
}

async function favFromPack(e: any) {
  const u = e.urlOriginal || e.url || ''
  if (!u) { ctx.ui?.toast?.('这张表情没有可用地址', 'warn'); return }
  const full = /^https?:\/\//i.test(u) ? u : `https://chat-img.jwznb.com/${String(u).replace(/^\/+/, '')}`
  await st.addFromUrl?.(full)
}

/* ---- 收藏他人表情包（/v1/sticker/add）与单贴纸管理（rename/remove） ---- */
const addPackOpen = ref(false)
const addPackId = ref('')
async function addPackById(id: number) {
  try {
    await ctx.api.stickerAddPack(id)
    ctx.ui?.toast?.('合集已添加', 'success')
    st.suggestPack.id = 0
    await st.loadPacks()
    pickTab(id)
  } catch (e: any) { ctx.ui?.toast?.('添加失败：' + e.message, 'error') }
}
async function addPack() {
  const id = Number(addPackId.value.trim())
  if (!id) return
  try {
    await ctx.api.stickerAddPack(id)
    ctx.ui?.toast?.('表情包已收藏', 'success')
    addPackId.value = ''
    addPackOpen.value = false
    await st.loadPacks()
  } catch (e: any) { ctx.ui?.toast?.('收藏失败：' + e.message, 'error') }
}
async function renameSticker(e: any) {
  if (!isOwnPack(curPack.value) || s.browsePack) return
  renaming.value = { id: e.id, name: e.name || '' }
}
async function renameStickerOk() {
  const rn = renaming.value
  renaming.value = null
  if (!rn || !rn.name.trim()) return
  try {
    await ctx.api.stickerRenameSticker(rn.id, rn.name.trim())
    ctx.ui?.toast?.('已重命名', 'success')
    await st.loadPacks()
  } catch (err: any) { ctx.ui?.toast?.('重命名失败：' + err.message, 'error') }
}
async function removeSticker(e: any, pack: any = curPack.value) {
  if (!isOwnPack(pack) || !e?.id) return
  if (!(await ctx.ui?.confirm?.('删除表情', `从「${pack.name}」中删除「${nameOf(e)}」？此操作会影响该合集。`, { danger: true }))) return
  try {
    await ctx.api.stickerRemoveSticker(Number(pack.id), e.id)
    ctx.ui?.toast?.('已删除', 'success')
    await st.loadPacks()
  } catch (err: any) { ctx.ui?.toast?.('删除失败：' + err.message, 'error') }
}
async function removeFavorite(e: any) {
  if (!e?.id || !(await ctx.ui?.confirm?.('删除收藏表情', `从收藏中删除「${nameOf(e)}」？`, { danger: true }))) return
  await st.remove(e)
}
async function removePack(pack: any, permanently: boolean) {
  if (!pack?.id || packActionBusy.value || (permanently && !isOwnPack(pack))) return
  const title = permanently ? '删除表情包' : '移出表情包'
  const detail = permanently
    ? `永久删除自己创建的「${pack.name}」？合集中的表情也会被删除，其他用户将无法使用。`
    : `将「${pack.name}」从我的表情包中移出？合集本身不会被删除，以后可以重新收藏。`
  if (!(await ctx.ui?.confirm?.(title, detail, { danger: true }))) return
  packActionBusy.value = true
  try {
    if (permanently) await ctx.api.stickerDeletePack(Number(pack.id))
    else await ctx.api.stickerRemovePack(Number(pack.id))
    s.packs = s.packs.filter((p: any) => Number(p.id) !== Number(pack.id))
    if (Number(tab.value) === Number(pack.id) && !s.browsePack) pickTab('fav')
    ctx.ui?.toast?.(permanently ? '表情包已删除' : '表情包已移出', 'success')
    await st.loadPacks()
  } catch (err: any) { ctx.ui?.toast?.(`${title}失败：${err.message}`, 'error') }
  finally { packActionBusy.value = false }
}
async function renamePackOk() {
  const pending = packRenaming.value
  const pack = pending && s.packs.find((p: any) => Number(p.id) === Number(pending.id))
  if (!pending || !isOwnPack(pack) || !pending.name.trim() || packActionBusy.value) return
  packActionBusy.value = true
  try {
    await ctx.api.stickerRenamePack(pending.id, pending.name.trim())
    packRenaming.value = null
    ctx.ui?.toast?.('表情包已重命名', 'success')
    await st.loadPacks()
  } catch (err: any) { ctx.ui?.toast?.('重命名失败：' + err.message, 'error') }
  finally { packActionBusy.value = false }
}
function menuAction(action: string) {
  const selected = menu.value
  if (!selected) return
  closeMenu()
  const { item, pack, kind } = selected
  if (action === 'refresh') { void st.load(); return }
  if (action === 'reset-order') { resetPackOrder(); return }
  if (action === 'move-top' || action === 'move-up' || action === 'move-down' || action === 'move-bottom') {
    if (kind === 'pack' && pack) movePack(pack, action.slice(5) as StickerMove)
    return
  }
  if (action === 'rename-pack' && kind === 'pack' && isOwnPack(pack)) {
    packRenaming.value = { id: Number(pack.id), name: pack.name || '' }; return
  }
  if (action === 'remove-pack' && kind === 'pack') { void removePack(pack, false); return }
  if (action === 'delete-pack' && kind === 'pack') { void removePack(pack, true); return }
  if (action === 'favorite' && (kind === 'pack-item' || kind === 'browse-item')) { void favFromPack(item); return }
  if (action === 'top-favorite' && kind === 'favorite-item') { void st.topping(item); return }
  if (action === 'delete-favorite' && kind === 'favorite-item') { void removeFavorite(item); return }
  if (action === 'rename-item' && kind === 'pack-item' && isOwnPack(pack)) {
    // 如果菜单指向的合集已不在当前页，先切换再编辑。
    if (Number(tab.value) !== Number(pack.id) || s.browsePack) pickTab(Number(pack.id))
    void renameSticker(item); return
  }
  if (action === 'delete-item' && kind === 'pack-item') void removeSticker(item, pack)
}
/* ---- 快捷回复条（从输入区迁移至此；quickreply.enabled 默认 false，用户在设置或此处开启） ---- */
const qr = ctx.quickreply
const qrEnabled = computed(() => !!qr?.state?.enabled)
const QR_ORDER_KEY = 'yh.qr.order'
function loadOrder(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}
const qrOrder = ref<string[]>(loadOrder(QR_ORDER_KEY))
const qrItems = computed(() => {
  const items = (ctx.chat?.composerOf?.('composer') || []).filter((it: any) => it.kind === 'quick')
  const ord = qrOrder.value
  return [...items].sort((a: any, b: any) => {
    const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
})
const qrAdding = ref(false)
const qrNew = ref('')
const qrDrag = ref('')
function qrAdd() {
  const t = qrNew.value.trim()
  if (t) qr?.add?.(t)
  qrNew.value = ''
  qrAdding.value = false
}
function qrDrop(targetId: string) {
  const from = qrDrag.value
  qrDrag.value = ''
  if (!from || from === targetId) return
  const ids = qrItems.value.map((x: any) => x.id).filter((x: string) => x !== from)
  ids.splice(ids.indexOf(targetId) + 1, 0, from)
  qrOrder.value = ids
  localStorage.setItem(QR_ORDER_KEY, JSON.stringify(ids))
}
</script>

<template>
  <div v-if="s.panelOpen" class="sp-mask" @click.self="st.close()">
    <div class="sp" role="dialog" aria-label="表情面板">
      <header>
        <b>表情</b>
        <div class="sp-header-actions">
          <label class="ghost small file" :class="{ disabled: !!s.browsePack }"
                 :title="s.browsePack ? '请先收藏该合集，再上传图片' : '上传图片到当前分类'">
            <input type="file" accept="image/*" multiple hidden :disabled="!!s.browsePack" @change="onPickUpload" />上传到当前栏
          </label>
          <button class="ghost small" :disabled="s.loading || s.packsLoading" @click="refresh">刷新</button>
          <button class="ghost small" :class="{ on: addPackOpen }" @click="addPackOpen = !addPackOpen">收藏合集</button>
          <button class="ghost small" :class="{ on: qrEnabled }" title="在面板底部显示快捷回复条"
                  @click="qr?.toggle?.()">快捷回复</button>
        </div>
        <button class="sp-x" aria-label="关闭表情面板" @click="st.close()">×</button>
      </header>

      <div class="sp-workspace">
        <nav class="sp-nav" aria-label="表情包分类">
          <div class="sp-nav-title"><span>我的表情包</span><span>{{ s.packs.length }}</span></div>
          <input v-model="packKeyword" class="sp-pack-search" type="search" placeholder="搜索表情包名称 / ID" aria-label="搜索表情包" />
          <select class="sp-mobile-select" :value="tab" aria-label="选择表情分类"
                  @change="pickTab(normalizeTab(($event.target as HTMLSelectElement).value))">
            <option value="fav">收藏（{{ list.length }}）</option>
            <option v-for="p in filteredPacks" :key="p.id" :value="p.id">{{ p.name }}（{{ p.items?.length || 0 }}）</option>
          </select>
          <button class="sp-pack sp-fav" :class="{ on: tab === 'fav' && !s.browsePack }"
                  :aria-current="tab === 'fav' && !s.browsePack ? 'true' : undefined" @click="pickTab('fav')"
                  @contextmenu.prevent="openMenu('favorites', $event)">
            <Icon name="star" :size="16" /><span class="sp-pack-name">收藏</span><em>{{ list.length }}</em>
          </button>
          <div class="sp-pack-list" ref="packListEl">
            <button v-for="p in filteredPacks" :key="p.id" class="sp-pack"
                    :class="{ on: tab === Number(p.id) && !s.browsePack }"
                    :aria-current="tab === Number(p.id) && !s.browsePack ? 'true' : undefined"
                    :title="`${p.name} · ${p.items?.length || 0} 张 · ID ${p.id} · 右键管理`" @click="pickTab(p.id)"
                    @contextmenu.prevent="openMenu('pack', $event, undefined, p)">
              <span class="sp-pack-name">{{ p.name }}</span><em>{{ p.items?.length || 0 }}</em>
            </button>
            <p v-if="!filteredPacks.length" class="sp-nav-empty dim small">
              {{ s.packsLoading ? '加载表情包…' : packKeyword.trim() ? '没有匹配的表情包' : '还没有收藏合集' }}
            </p>
          </div>
        </nav>

        <section class="sp-content" aria-label="当前分类">
          <div class="sp-content-head">
            <div class="sp-current">
              <strong :title="currentTitle">{{ currentTitle }}</strong>
              <span class="dim small">{{ s.keyword.trim() ? `${visibleCount} / ${currentTotal}` : currentTotal }} 张{{ s.browsePack ? ' · 未收藏' : '' }}</span>
            </div>
            <div v-if="curPack && !s.browsePack && tab !== 'fav'" class="sp-pack-actions">
              <button class="ghost small" :disabled="packActionBusy" :title="isOwnPack(curPack) ? '永久删除自己创建的合集' : '从我的表情包中移出'"
                      @click="removePack(curPack, isOwnPack(curPack))">
                <Icon name="trash" :size="14" /> {{ isOwnPack(curPack) ? '删除合集' : '移出合集' }}
              </button>
              <button class="ghost small" aria-label="管理当前表情包" aria-haspopup="menu" @click="openMenu('pack', $event, undefined, curPack)">···</button>
            </div>
            <input v-model="s.keyword" type="search" placeholder="搜索表情名称 / ID" aria-label="搜索当前表情" />
          </div>
          <div v-if="s.browsePack" class="sp-addrow">
            <button class="ghost tiny" @click="addPackById(s.browsePack.id)">添加该合集</button>
            <button class="ghost tiny" @click="st.closeBrowse()">返回我的表情</button>
          </div>
          <div v-else-if="st.suggestPack?.id" class="sp-addrow">
            <span class="dim small">{{ st.suggestPack.name }}未收藏</span>
            <button class="ghost tiny" @click="addPackById(st.suggestPack.id)">添加该合集</button>
            <button class="ghost tiny" @click="st.suggestPack.id = 0">忽略</button>
          </div>
          <div v-if="addPackOpen" class="sp-addrow">
            <input v-model="addPackId" placeholder="表情包 ID" aria-label="要收藏的表情包 ID" inputmode="numeric" @keyup.enter="addPack" />
            <button class="ghost tiny" :disabled="!addPackId.trim()" @click="addPack">收藏</button>
            <button class="ghost tiny" @click="addPackOpen = false">取消</button>
          </div>
          <div v-if="renaming" class="sp-addrow">
            <input v-model="renaming.name" aria-label="表情名称" @keyup.enter="renameStickerOk" @keyup.esc="renaming = null" autofocus />
            <button class="ghost tiny" @click="renameStickerOk">保存</button>
            <button class="ghost tiny" @click="renaming = null">取消</button>
          </div>
          <div v-if="packRenaming" class="sp-addrow">
            <input v-model="packRenaming.name" aria-label="表情包名称" @keyup.enter="renamePackOk" @keyup.esc="packRenaming = null" autofocus />
            <button class="ghost tiny" :disabled="packActionBusy || !packRenaming.name.trim()" @click="renamePackOk">保存名称</button>
            <button class="ghost tiny" @click="packRenaming = null">取消</button>
          </div>

          <div class="sp-body" ref="bodyEl" role="region" aria-label="表情列表" tabindex="0">
            <div class="grid" :style="{ '--sticker-cell-size': cellSize }">
              <template v-if="s.browsePack">
                <div v-for="e in browseItems" :key="e.id" class="cell"
                        :class="{ located: Number(e.id) === Number(s.browsePack.locateId) }"
                        @contextmenu.prevent="openMenu('browse-item', $event, e)">
                  <button class="cell-send" :title="nameOf(e) + ' · 点击发送 · 右键更多'" @click="st.send(e)">
                    <img v-resource-media="{ src: src(e), animated: true, width: 96, height: 96 }" alt="" loading="eager" decoding="async" @error="(ev: any) => { ev.target.style.visibility = 'hidden' }" />
                    <span class="cell-name" :title="nameOf(e)">{{ nameOf(e) }}</span>
                  </button>
                  <div class="cell-actions"><button class="cell-action" :aria-label="`管理表情 ${nameOf(e)}`" aria-haspopup="menu" @click="openMenu('browse-item', $event, e)">···</button></div>
                </div>
              </template>
              <template v-else-if="tab === 'fav'">
                <div v-for="e in visibleFavs" :key="e.id" class="cell" :class="{ located: isLocated(e) }" @contextmenu.prevent="openMenu('favorite-item', $event, e)">
                  <button class="cell-send" :title="nameOf(e) + ' · 点击发送 · 右键更多'" @click="st.send(e)">
                    <img v-resource-media="{ src: src(e), animated: true, width: 96, height: 96 }" alt="" loading="eager" decoding="async" @error="(ev: any) => { ev.target.style.visibility = 'hidden' }" />
                    <span class="cell-name" :title="nameOf(e)">{{ nameOf(e) }}</span>
                  </button>
                  <div class="cell-actions">
                    <button class="cell-action danger" :aria-label="`删除收藏表情 ${nameOf(e)}`" title="从收藏删除" @click="removeFavorite(e)"><Icon name="trash" :size="13" /></button>
                    <button class="cell-action" :aria-label="`管理表情 ${nameOf(e)}`" aria-haspopup="menu" @click="openMenu('favorite-item', $event, e)">···</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div v-for="e in visiblePackItems" :key="e.id" class="cell" :class="{ located: isLocated(e) }" @contextmenu.prevent="openMenu('pack-item', $event, e, curPack)">
                  <button class="cell-send" :title="nameOf(e) + ' · 点击发送 · 右键更多'" @click="st.send(e)">
                    <img v-resource-media="{ src: src(e), animated: true, width: 96, height: 96 }" alt="" loading="eager" decoding="async" @error="(ev: any) => { ev.target.style.visibility = 'hidden' }" />
                    <span class="cell-name" :title="nameOf(e)">{{ nameOf(e) }}</span>
                  </button>
                  <div class="cell-actions">
                    <button v-if="isOwnPack(curPack)" class="cell-action danger" :aria-label="`删除合集表情 ${nameOf(e)}`" title="从合集中删除" @click="removeSticker(e, curPack)"><Icon name="trash" :size="13" /></button>
                    <button class="cell-action" :aria-label="`管理表情 ${nameOf(e)}`" aria-haspopup="menu" @click="openMenu('pack-item', $event, e, curPack)">···</button>
                  </div>
                </div>
              </template>
            </div>
            <p v-if="!visibleCount" class="dim center">
              {{ s.keyword.trim() ? '没有匹配的表情，试试名称或 ID。' : (s.loading || s.packsLoading) ? '加载中…' : s.browsePack ? '这个合集是空的或已被删除' : '当前分类还没有表情，可上传图片或 Ctrl+V 粘贴加入。' }}
            </p>
          </div>
          <div class="sp-pagination">
            <label>每页 <select v-model.number="pageSize" aria-label="每页表情数量">
              <option v-for="size in [12, 24, 48, 96]" :key="size" :value="size">{{ size }} 张</option>
            </select></label>
            <button class="ghost tiny" :disabled="page <= 1" @click="page--">上一页</button>
            <span>{{ page }} / {{ pageCount }}</span>
            <button class="ghost tiny" :disabled="page >= pageCount" @click="page++">下一页</button>
          </div>
        </section>
      </div>

      <div v-if="qrEnabled" class="sp-qr">
        <span class="dim small">快捷回复</span>
        <button v-for="it in qrItems" :key="it.id" class="qr-chip" draggable="true"
                @click="qr?.fire?.(it.value)"
                @dragstart="qrDrag = it.id" @dragover.prevent @drop.prevent="qrDrop(it.id)">
          {{ it.label }}
          <span class="x" title="移除" @click.stop="qr?.remove?.(it.value)">×</span>
        </button>
        <template v-if="qrAdding">
          <input v-model="qrNew" class="qr-add-input" placeholder="新快捷回复" @keyup.enter="qrAdd" @keyup.esc="qrAdding = false" />
          <button class="ghost tiny" @click="qrAdd">保存</button>
        </template>
        <button v-else class="qr-chip qr-add" title="添加快捷回复" @click="qrAdding = true">+ 添加</button>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="s.panelOpen && menu" ref="menuEl" class="sp-context" role="menu"
         :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @contextmenu.prevent @keydown="navigateMenu">
      <div class="sp-context-title">{{ menu.kind === 'favorites' ? '收藏' : menu.kind === 'pack' ? menu.pack?.name : nameOf(menu.item) }}</div>
      <template v-if="menu.kind === 'favorites'">
        <div class="sp-context-note">收藏栏不可删除</div>
        <button role="menuitem" @click="menuAction('refresh')"><Icon name="refresh" :size="15" /> 刷新收藏</button>
      </template>
      <template v-else-if="menu.kind === 'pack'">
        <div class="sp-context-note">调整顺序 · 仅在本机生效</div>
        <button role="menuitem" :disabled="packPosition(menu.pack) <= 0" @click="menuAction('move-top')">移到顶部</button>
        <button role="menuitem" :disabled="packPosition(menu.pack) <= 0" @click="menuAction('move-up')">上移一位</button>
        <button role="menuitem" :disabled="packPosition(menu.pack) < 0 || packPosition(menu.pack) >= orderedPacks.length - 1" @click="menuAction('move-down')">下移一位</button>
        <button role="menuitem" :disabled="packPosition(menu.pack) < 0 || packPosition(menu.pack) >= orderedPacks.length - 1" @click="menuAction('move-bottom')">移到末尾</button>
        <button role="menuitem" :disabled="!packOrder.length" @click="menuAction('reset-order')">恢复默认顺序</button>
        <div class="sp-context-divider"></div>
        <button v-if="isOwnPack(menu.pack)" role="menuitem" @click="menuAction('rename-pack')"><Icon name="pencil" :size="15" /> 重命名合集</button>
        <button role="menuitem" @click="menuAction('remove-pack')"><Icon name="folder" :size="15" /> 从我的表情包移出</button>
        <button v-if="isOwnPack(menu.pack)" class="danger" role="menuitem" @click="menuAction('delete-pack')"><Icon name="trash" :size="15" /> 永久删除合集</button>
      </template>
      <template v-else-if="menu.kind === 'favorite-item'">
        <button role="menuitem" @click="menuAction('top-favorite')"><Icon name="pinUp" :size="15" /> 置顶表情</button>
        <button class="danger" role="menuitem" @click="menuAction('delete-favorite')"><Icon name="trash" :size="15" /> 删除这张收藏</button>
      </template>
      <template v-else>
        <button role="menuitem" @click="menuAction('favorite')"><Icon name="star" :size="15" /> 收藏这张表情</button>
        <template v-if="menu.kind === 'pack-item' && isOwnPack(menu.pack)">
          <button role="menuitem" @click="menuAction('rename-item')"><Icon name="pencil" :size="15" /> 重命名表情</button>
          <button class="danger" role="menuitem" @click="menuAction('delete-item')"><Icon name="trash" :size="15" /> 从合集中删除</button>
        </template>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.sp-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 76; display: flex; align-items: flex-end; justify-content: center; }
.sp { width: 960px; max-width: calc(100vw - 24px); height: min(680px, 82vh); height: min(680px, 82dvh); min-height: 0; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px 14px 0 0; box-shadow: var(--shadow); overflow: hidden; }
.sp > header { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.sp > header > b, .sp-x { flex: 0 0 auto; }
.sp-header-actions { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; overflow-x: auto; }
.sp-header-actions > * { flex: 0 0 auto; white-space: nowrap; }
.sp-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
/* 所有中间层允许收缩；列表和图片区分别消化自己的溢出。 */
.sp-workspace { flex: 1 1 0; min-height: 0; min-width: 0; display: grid; grid-template-columns: 208px minmax(0, 1fr); overflow: hidden; }
.sp-nav { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px 8px 8px; border-right: 1px solid var(--line); background: var(--card2); }
.sp-nav-title { display: flex; justify-content: space-between; padding: 0 6px; color: var(--fg2); font-size: 12px; }
.sp-pack-search { width: 100%; min-width: 0; padding: 7px 9px; font-size: 12px; }
.sp-nav-title, .sp-pack-search, .sp-fav { flex: 0 0 auto; }
.sp-pack-list { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; display: flex; flex-direction: column; gap: 4px; }
.sp-pack { flex: 0 0 auto; min-width: 0; width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--fg2); text-align: left; font-size: 12.5px; font-weight: 400; }
.sp-pack:hover { color: var(--fg); background: var(--card); }
.sp-pack.on { color: var(--acc); background: var(--acc-soft); border-color: var(--acc); font-weight: 600; }
.sp-pack-name { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; line-height: 1.5; }
.sp-pack em { flex: 0 0 auto; font-style: normal; font-size: 11px; font-variant-numeric: tabular-nums; }
.sp-nav-empty { padding: 8px; margin: 0; }
.sp-mobile-select { display: none; }
.sp-content { min-height: 0; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.sp-content-head { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.sp-current { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sp-current strong { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; line-height: 1.4; font-size: 13px; }
.sp-pack-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.sp-pack-actions button { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.sp-content-head input { flex: 0 1 190px; width: 36%; min-width: 100px; padding: 7px 9px; font-size: 12px; }
.sp-body { flex: 1 1 0; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 12px; }
.sp-addrow { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 6px 12px; }
.sp-addrow > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-addrow button { flex: 0 0 auto; }
.sp-addrow input { flex: 1; min-width: 0; background: var(--card2); border: 1px solid var(--line); border-radius: 8px; color: var(--fg); padding: 5px 9px; font-size: 12.5px; }
.sp button:focus-visible, .sp-body:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--sticker-cell-size, 116px)), 1fr)); gap: 8px; }
.sp-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--line); flex: 0 0 auto; font-size: 12px; }
.sp-pagination label { margin-right: auto; }
.sp-pagination select { padding: 3px; }
.cell { position: relative; min-width: 0; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 9px; background: var(--card2); overflow: hidden; }
.cell:hover { border-color: var(--acc); }
.cell-send { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; padding: 4px; border: 0; border-radius: 0; background: transparent; cursor: pointer; }
.cell-send img { flex: 1 1 0; min-height: 0; width: 100%; object-fit: contain; }
.cell-name { display: block; flex: 0 0 auto; width: 100%; font-size: 11px; color: var(--fg2); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 2px 0; }
.cell-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s ease; }
.cell:hover .cell-actions, .cell:focus-within .cell-actions { opacity: 1; }
.cell-action { width: 26px; height: 26px; padding: 0; border: 1px solid rgba(255,255,255,.2); border-radius: 7px; background: rgba(20,20,25,.85); color: white; display: grid; place-items: center; line-height: 1; cursor: pointer; }
.cell-action:hover { background: #41404b; }
.cell-action.danger:hover { background: #a82e37; }
/* 保留已有聊天表情定位的圈线高亮。 */
.cell.located { border-color: var(--acc); box-shadow: 0 0 0 2px var(--acc), 0 0 12px color-mix(in srgb, var(--acc) 60%, transparent); animation: cell-locate 1.6s ease-in-out infinite; }
@keyframes cell-locate { 0%, 100% { box-shadow: 0 0 0 2px var(--acc), 0 0 8px color-mix(in srgb, var(--acc) 45%, transparent); } 50% { box-shadow: 0 0 0 3px var(--acc), 0 0 16px color-mix(in srgb, var(--acc) 75%, transparent); } }
/* 快捷回复有自己的高度上限，不能再次挤占整个图片区。 */
.sp-qr { flex: 0 0 auto; max-height: min(96px, 16vh); max-height: min(96px, 16dvh); overflow-y: auto; overscroll-behavior: contain; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border-top: 1px solid var(--line); background: var(--card2); }
.qr-chip { max-width: 100%; overflow-wrap: anywhere; }
.sp-context { position: fixed; z-index: 90; width: max-content; min-width: 190px; max-width: min(280px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 11px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.sp-context-title { overflow: hidden; padding: 6px 9px 4px; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.sp-context-note { padding: 3px 9px 6px; font-size: 11px; color: var(--fg2); }
.sp-context-divider { height: 1px; margin: 3px 5px; background: var(--line); }
.sp-context button { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--fg); font-size: 12px; font-weight: 400; text-align: left; cursor: pointer; }
.sp-context button:hover, .sp-context button:focus-visible { background: var(--card2); outline: none; }
.sp-context button:disabled { opacity: .4; cursor: default; }
.sp-context button.danger { color: var(--err); }
.file { display: inline-flex; align-items: center; cursor: pointer; padding: 3px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); }
.file.disabled { opacity: .5; cursor: not-allowed; }
.center { text-align: center; padding: 22px 0; }
@media (max-width: 620px) {
  .sp { max-width: 100vw; height: calc(100vh - 16px); height: calc(100dvh - 16px); }
  .sp > header { gap: 6px; padding: 8px; }
  .sp-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .sp-nav { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--line); }
  .sp-nav-title, .sp-pack-list, .sp-fav { display: none; }
  .sp-mobile-select { display: block; grid-column: 1; grid-row: 1; width: 100%; min-width: 0; font-size: 12px; padding: 7px; }
  .sp-pack-search { grid-column: 2; grid-row: 1; }
  .sp-content-head { gap: 8px; padding: 8px; }
  .sp-content-head { flex-wrap: wrap; }
  .sp-content-head input { order: 3; flex: 1 1 100%; width: 100%; }
  .sp-body { padding: 10px; }
}
@media (hover: none) { .cell-actions { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cell.located { animation: none; } }
</style>
