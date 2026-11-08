<script setup lang="ts">
/**
 * 会话/群设置面板（QQ 式右侧固定面板，非弹窗、不遮聊天区）。
 * 群聊：群卡片 + 成员宫格(邀请/查看全部) + 群公告 + 我的本群昵称 + 群聊备注(本地)
 *       + 设为置顶/消息免打扰开关 + 退出群聊。
 * 私聊：对方资料 + 免打扰 + 加好友/删好友。
 * 成员右键菜单（QQ 式，只保留有后端的项）：发消息 / @ TA / 查看资料 / 添加好友 / 禁言TA。
 * （戳一戳/举报云湖无接口，按「无后端即砍」不做。）
 */
import { inject, ref, computed, onMounted, onUnmounted, watch } from 'vue'
import QRCode from 'qrcode'
import { resUrl } from '../core/res'
import { fallbackAvatar } from '../core/util'
import { renderRich } from '../core/render'
import Icon from '../console/components/Icon.vue'
import GroupPolicySettings from './GroupPolicySettings.vue'
import './group-panel.css'
import { useGroupPanelFocus } from '../core/group-panel-focus'

const ctx = inject<any>('ctx')
const g = ctx.group
const chat = ctx.chat
const auth = ctx.auth

const isOpen = computed(() => g.state.panelOpen)
const settingsDialog = ref<HTMLElement | null>(null)
useGroupPanelFocus(settingsDialog, () => isOpen.value, () => g.close(), false)
const cur = computed(() => chat.state.current)
const isGroup = computed(() => cur.value?.type === 2)
const info = computed(() => g.state.info)
const members = computed(() => (g.state.members || []).slice(0, 14))
const settingsTab = ref('personal')
const settingsTabs = computed(() => [
  { id:'personal',name:'个人偏好' }, { id:'notifications',name:'消息通知' },
  ...(isGroup.value && g.roleOf(String(auth.state.user?.id || '')) ? [{ id:'management',name:'群管理' }] : []),
  { id:'more',name:'更多' },
])
watch(() => cur.value?.id, () => { settingsTab.value = 'personal'; qrView.value = null; invOpen.value = false; cardOpen.value = false; closeMM() })

/* 我的本群昵称 / 群聊备注 */
const nick = ref('')
const remark = ref('')
const busy = ref(false)
let nickVersion = 0
watch(() => cur.value?.id, () => { nickVersion++; busy.value = false }, { flush:'sync' })
let nickSource = ''
watch(() => info.value?.myGroupNickname, value => {
  if (nick.value === nickSource) nick.value = value || ''
  nickSource = value || ''
})

watch([isOpen, cur], async () => {
  if (!isOpen.value || !cur.value) return
  nick.value = info.value?.myGroupNickname || ''
  remark.value = localStorage.getItem('yh.remark.' + cur.value.id) || ''
  if (isGroup.value && !g.state.members.length) g.loadMembers()
}, { immediate: true })

async function saveNick() {
  if (busy.value || !cur.value) return
  const gid = cur.value.id, value = nick.value
  const version = ++nickVersion
  busy.value = true
  try {
    await ctx.api.setMyGroupNickname(gid, value)
    if (cur.value?.id !== gid || version !== nickVersion) return
    nickSource = value
    if (info.value) info.value.myGroupNickname = value
    ctx.ui?.toast?.('昵称已保存', 'success')
  } catch (e: any) { ctx.ui?.toast?.('保存失败：' + e.message, 'error') }
  finally { if (version === nickVersion) busy.value = false }
}
function saveRemark() {
  if (!cur.value) return
  // 本地先存（即时生效），再云同步（多端可见；失败不阻塞）
  localStorage.setItem('yh.remark.' + cur.value.id, remark.value)
  if (!isGroup.value) ctx.api?.saveUserRemarks?.(cur.value.id, remark.value).catch(() => {})
  ctx.ui?.toast?.('备注已保存', 'success')
}

/* 置顶 / 免打扰开关（本地，与右键菜单联动） */
const pinned = computed(() => !!cur.value && chat.isPinned(cur.value.id))
const muted = computed(() => !!cur.value && chat.isMuted(cur.value.id))
function togglePin() { if (cur.value) chat.togglePin(cur.value.id) }
async function toggleMute() {
  if (!cur.value) return
  await chat.toggleMute(cur.value.id)
}

/* 群看板（/v1/bot/board 内容）：默认 3 行，超长给展开提示 */
const boardOpen = ref(false)
const boardHtml = computed(() => {
  const c = g.state.board?.content
  return c ? renderRich(c) : ''
})
const boardLong = computed(() => (g.state.board?.content || '').length > 90)

/* 群主判定（管理区可见性） */
const isOwner = computed(() => {
  const me = ctx.auth?.state?.user?.id
  const info = g.state.info
  return !!me && String(info?.owner || info?.createBy || '') === String(me)
})

/* 群消息设置下拉：0 提醒 / 1 不提醒 / 2 屏蔽（映射到免打扰 + 本地隐藏） */
const notifyMode = computed(() => {
  if (!cur.value) return 0
  if (chat.isHidden?.(cur.value.id)) return 2
  return muted.value ? 1 : 0
})
async function setNotifyMode(v: number) {
  const c = cur.value
  if (!c) return
  if (v === 2) { chat.hideConv(c.id); g.close(); return }
  const wantMute = v === 1
  if (muted.value !== wantMute) await toggleMute()
}

/** 分享群：官方式分享链接 + 二维码。
 *  · 链接：/v1/share/create 返回 shareUrl 就用它；只回 key 时按官方格式
 *    https://yhfx.jwznb.com/share?key=…&ts=<秒级时间戳> 自行拼装（对照官方分享链接实测格式）；
 *  · 二维码：优先本地用开源库 qrcode（MIT）由链接生成——不依赖云端 imageKey，
 *    云端回了官方群二维码图则一并保留作兜底展示。 */
const qrView = ref<{ url: string; qr: string; link: string; shareUrl: string } | null>(null)
const qrBusy = ref(false)
async function shareGroup() {
  const c = cur.value
  if (!c || qrBusy.value) return
  qrBusy.value = true
  try {
    const d = await ctx.api.shareCreate(c.id, c.type || 2, c.name || '')
    // ⚠️ 实测（/v1/share/create dump）：云端 shareUrl 只回**裸域名** https://yhfx.jwznb.com/，
    //    完整分享链接要客户端拼：/share?key=<key>&ts=<云端ts>（对照官方分享链接格式）。
    //    仅当云端回的 shareUrl 自带 key 参数时才直接用它。
    const link = (d.shareUrl && /key=/.test(d.shareUrl))
      ? d.shareUrl
      : (d.key ? `https://yhfx.jwznb.com/share?key=${encodeURIComponent(d.key)}&ts=${d.ts || Math.floor(Date.now() / 1000)}` : '')
    let qr = ''
    if (link) {
      try { qr = await QRCode.toDataURL(link, { width: 240, margin: 1, color: { dark: '#000000', light: '#ffffff' } }) }
      catch { qr = '' }
    }
    const u = d.imageKey ? (/^https?:/.test(d.imageKey) ? d.imageKey : resUrl(`https://chat-img.jwznb.com/${d.imageKey.replace(/^\/+/, '')}`)) : ''
    if (!qr && !u) { ctx.ui?.toast?.('云端未返回二维码，链接仍可复制分享', 'warn') }
    qrView.value = { url: u, qr, link, shareUrl: d.shareUrl || '' }
  } catch (e: any) { ctx.ui?.toast?.('生成分享失败：' + e.message, 'error') }
  finally { qrBusy.value = false }
}
async function copyShareLink() {
  const l = qrView.value?.link
  if (!l) return
  try { await navigator.clipboard.writeText(l); ctx.ui?.toast?.('分享链接已复制', 'success') }
  catch { ctx.ui?.toast?.('复制失败，请手动选择链接复制', 'error') }
}

/** 分享群卡片：官方云湖的「群卡片」本质是 HTML 消息（content_type 8），
 *  无专门端点——把群头像/群名/群号/简介拼成卡片 HTML 发给选中的会话。
 *  页面形态按用户要求=转发消息同款大页面（全会话列表含本会话+页签+多选+确认），
 *  不再用小弹窗。 */
const cardOpen = ref(false)
const cardBusy = ref(false)
const cardSel = ref<Set<string>>(new Set())
const cardTab = ref<'all' | 'friends' | 'groups'>('all')
const cardKw = ref('')
function openCardPick() {
  cardSel.value = new Set()
  cardKw.value = ''
  cardTab.value = 'all'
  cardOpen.value = true
  ctx.social?.loadBook?.()
}
function toggleCard(id: string) {
  const s = new Set(cardSel.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  cardSel.value = s
}
/** 大页面列表：全会话（含本群——用户要求本会话也能分享本群卡片）+ 页签/关键词过滤 */
const cardList = computed(() => {
  let list = (ctx.chat?.state?.conversations || []).map((c: any) => ({ id: c.id, type: c.type, name: c.name, avatar: c.avatar }))
  // 好友补充（会话列表里没有的好友也能私发卡片）
  const seen = new Set(list.map((x: any) => x.id))
  for (const u of (ctx.social?.state?.book?.users || [])) {
    if (!seen.has(u.id)) list.push({ id: u.id, type: 1, name: u.name, avatar: u.avatar })
  }
  if (cardTab.value === 'friends') list = list.filter((x: any) => x.type === 1 || x.type === 3)
  if (cardTab.value === 'groups') list = list.filter((x: any) => x.type === 2)
  const k = cardKw.value.trim()
  if (k) list = list.filter((x: any) => String(x.name || '').includes(k) || String(x.id).includes(k))
  return list
})
function cardHtml(): string {
  const c = cur.value
  if (!c) return ''
  const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
  // 头像可能是相对 key：官方客户端直接读完整 URL，补图片桶域名
  const av = info.value?.avatar
    ? (/^https?:/.test(info.value.avatar) ? info.value.avatar : `https://chat-img.jwznb.com/${String(info.value.avatar).replace(/^\/+/, '')}`)
    : ''
  // 保留官方客户端可识别的群聊深链，头像和文案与板块分享对齐。
  return '<a href="yunhu://chat-add?id=' + encodeURIComponent(c.id) + '&type=group" data-yh-id="' + esc(c.id) + '" data-yh-type="group" style="display:block;text-decoration:none;color:inherit;-webkit-tap-highlight-color:transparent;border:none;outline:none;">'
    + '<table cellpadding="0" cellspacing="0" border="0" style="max-width:280px;border-collapse:collapse;border:none;"><tr>'
    + (av
      ? '<td style="width:36px;padding:0;vertical-align:middle;border:none;">'
        + '<img src="' + esc(av) + '" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:5px;object-fit:cover;border:0;" alt=""></td>'
      : '')
    + '<td style="padding:0 0 0 10px;vertical-align:middle;border:none;">'
    + '<div style="font-size:15px;font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.name) + '</div>'
    + '<div style="font-size:12px;line-height:16px;margin-top:2px;opacity:0.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">邀请加入该群聊</div>'
    + '</td></tr></table></a>'
}
async function sendCard() {
  const ids = [...cardSel.value]
  const c = cur.value
  if (!c || !ids.length || cardBusy.value) return
  cardBusy.value = true
  const html = cardHtml()
  let ok = 0
  try {
    for (const id of ids) {
      // 目标类型从大页面列表项取（含本会话；type 2=群 1=用户 3=机器人）
      const t = cardList.value.find((x: any) => x.id === id)?.type || 1
      await ctx.api.send(id, t, 8, { text: html })
      ok++
    }
    ctx.ui?.toast?.(`群卡片已发送给 ${ok} 个会话`, 'success')
    cardOpen.value = false
  } catch (e: any) { ctx.ui?.toast?.('发送群卡片失败：' + e.message, 'error') }
  finally { cardBusy.value = false }
}

/** 删除聊天记录（本地缓存）：清当前会话消息与本地快照；云端记录不受影响（云湖无删记录端点） */
async function clearLocalHistory() {
  const c = cur.value
  if (!c) return
  if (!(await ctx.ui?.confirm?.('删除聊天记录', `清除「${c.name}」在本机的消息缓存？\n（云端记录不受影响）`, { danger: true }))) return
  chat.clearLocal?.(c.id)
  ctx.ui?.toast?.('本地聊天记录已清除', 'success')
}

/** 退出群聊：官方端点 /v1/friend/delete-friend（注释「删除好友/群聊/机器人」）带 chatType=2。
 *  群主不能退群（要先转让/解散），服务端会拒绝。 */
async function leaveGroup() {
  const c = cur.value
  if (!c) return
  if (isOwner.value) { ctx.ui?.toast?.('群主不能直接退群（需先转让或解散）', 'warn'); return }
  if (!(await ctx.ui?.confirm?.('退出群聊', `确定退出「${c.name}」？退出后不再接收该群消息。`, { danger: true }))) return
  try {
    await ctx.api.deleteFriend(c.id, 2)
    ctx.ui?.toast?.('已退出群聊', 'success')
    g.close()
    if (ctx.chat?.state?.current?.id === c.id) ctx.chat.state.current = null   // 离开已退的会话
    ctx.chat?.loadConversations?.()
  } catch (e: any) { ctx.ui?.toast?.('退群失败：' + e.message, 'error') }
}


async function copyGroupId() {
  const c = cur.value
  if (!c) return
  try { await navigator.clipboard.writeText(String(c.id)); ctx.ui?.toast?.('已复制群号 ' + c.id, 'success') }
  catch { ctx.ui?.toast?.('复制失败', 'error') }
}

/* ---- 邀请好友/群聊：多选 + 筛选页签 + 确认框（/v1/group/invite 或发群号卡片文本） ---- */
const invOpen = ref(false)
const invBusy = ref(false)
const invTab = ref<'friends' | 'groups'>('friends')
const invSel = ref<Set<string>>(new Set())
const friends = computed(() => (ctx.social?.state?.book?.users || []).filter((u: any) => u.id !== ctx.auth?.state?.user?.id))
const groups = computed(() => (ctx.social?.state?.book?.groups || []).filter((g: any) => g.id !== cur.value?.id))
const invList = computed(() => (invTab.value === 'friends' ? friends.value : groups.value))
function openInvite() {
  invSel.value = new Set()
  invTab.value = 'friends'
  invOpen.value = true
  ctx.social?.loadBook?.()
}
function toggleInv(id: string) {
  const s = new Set(invSel.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  invSel.value = s
}
async function sendInvite() {
  const c = cur.value
  const ids = [...invSel.value]
  if (!c || !ids.length || invBusy.value) return
  const isGroups = invTab.value === 'groups'
  const label = isGroups ? '群聊' : '好友'
  if (!(await ctx.ui?.confirm?.('发送群卡片', `向 ${ids.length} 个${label}发送「${c.name}」的群卡片（对方点开可加群）？`))) return
  invBusy.value = true
  try {
    // ⚠️ 官方移动端无「邀请普通用户进群」功能（Murexide 只有邀机器人入口），
    //    上游 web 的 pb /v1/group/invite 实测报参数错误=死路。
    //    邀请的统一形态 = 发群卡片（content_type 8 HTML，用户指定的官方形态）：
    //    好友=私聊发卡片(type 1)，群聊=群里发卡片(type 2)，对方点卡片一键加群。
    const html = cardHtml()
    for (const gid of ids) {
      await ctx.api.send(gid, isGroups ? 2 : 1, 8, { text: html })
    }
    ctx.ui?.toast?.('群卡片已发送', 'success')
    invOpen.value = false
  } catch (e: any) { ctx.ui?.toast?.('发送失败：' + e.message, 'error') }
  finally { invBusy.value = false }
}

/* 成员右键菜单（QQ 式） */
const mm = ref<{ open: boolean; x: number; y: number; m: any }>({ open: false, x: 0, y: 0, m: null })
function openMemberMenu(m: any, e: MouseEvent) {
  mm.value = { open: true, x: Math.min(e.clientX, window.innerWidth - 170), y: Math.min(e.clientY, window.innerHeight - 240), m }
}
function closeMM() { mm.value.open = false }
const dismissMemberMenu = () => closeMM()
let memberMenuTimer: ReturnType<typeof setTimeout>
watch(() => mm.value.open, (v) => {
  clearTimeout(memberMenuTimer)
  if (v) memberMenuTimer = setTimeout(() => document.addEventListener('click', dismissMemberMenu), 0)
  else document.removeEventListener('click', dismissMemberMenu)
})
onUnmounted(() => { clearTimeout(memberMenuTimer); document.removeEventListener('click', dismissMemberMenu) })
function mmSend() { const m = mm.value.m; closeMM(); if (m) chat.open({ id: m.id, type: 1, name: m.name, avatar: m.avatar }) }
function mmAt() { const m = mm.value.m; closeMM(); if (m) ctx.emit('composer/mention', { id: m.id, name: m.name }) }
function mmProfile() { const m = mm.value.m; closeMM(); if (m) g.openProfile(m) }
/** 宫格成员点击 = 查看资料（与右键菜单同义，QQ 式） */
function mmProfile2(m: any) { g.openProfile(m) }

/* 私聊：是否好友 + 删除好友（/v1/friend/delete-friend，审计补齐 UI） */
const isFriend = computed(() => {
  const id = cur.value?.id
  if (!id) return false
  try { return (ctx.social?.state?.book?.users || []).some((u: any) => u.id === id) } catch { return false }
})
async function delFriend() {
  const c = cur.value
  if (!c) return
  if (!(await ctx.ui?.confirm?.('删除好友', `确定删除好友「${c.name}」？`, { danger: true }))) return
  try {
    await ctx.api.deleteFriend(c.id, c.type === 3 ? 3 : 1)
    ctx.ui?.toast?.('已删除好友', 'success')
    ctx.social?.loadBook?.()
  } catch (e: any) { ctx.ui?.toast?.('删除失败：' + e.message, 'error') }
}
async function mmFriend() {
  const m = mm.value.m; closeMM()
  if (!m) return
  if (!(await ctx.ui?.confirm?.('添加好友', `向「${m.name}」发送好友申请？`))) return
  try { await ctx.social?.apply?.(m.id, 1, ''); ctx.ui?.toast?.('好友申请已发送', 'success') }
  catch (e: any) { ctx.ui?.toast?.('申请失败：' + e.message, 'error') }
}
async function mmGag() {
  const m = mm.value.m; closeMM()
  if (!m) return
  await g.gag?.(m, m.isGag ? 0 : 3600)
}

onMounted(() => { if (isOpen.value && isGroup.value) g.loadMembers() })
</script>

<template>
  <!-- QQ 式右侧固定面板：不遮罩、不弹窗，直接贴右展开 -->
  <Transition name="group-settings-slide">
  <aside v-if="isOpen" ref="settingsDialog" tabindex="-1" class="gp" aria-label="会话设置面板" @keydown.esc="g.close()">
    <header>
      <b>{{ isGroup ? '群聊设置' : '会话设置' }}</b>
      <span class="grow"></span>
      <button class="gp-x" title="收起" @click="g.close()">×</button>
    </header>

    <nav class="settings-tabs" role="tablist" aria-label="群设置分类">
      <button v-for="tab in settingsTabs" :key="tab.id" role="tab" :aria-selected="settingsTab === tab.id" :aria-controls="'settings-'+tab.id" @click="settingsTab = tab.id">{{ tab.name }}</button>
    </nav>
    <div class="gp-body group-ui">
      <div class="settings-identity"><img :src="(info?.avatar || cur?.avatar) ? resUrl(info?.avatar || cur?.avatar) : fallbackAvatar(cur?.name)" alt="" @error="(e:any) => e.target.src = fallbackAvatar(cur?.name)" /><div><b>{{ info?.name || cur?.name }}</b><span class="group-caption">{{ isGroup ? '群聊' : cur?.type === 3 ? '机器人' : '用户' }} · {{ cur?.id }}</span></div><button v-if="isGroup" class="ghost small" title="分享群聊" @click="shareGroup"><Icon name="forward" :size="15" /></button></div>
      <div v-if="isGroup" class="settings-shortcuts"><button @click="g.setDockTab('members')"><Icon name="user" :size="16" /> 成员</button><button @click="g.setDockTab('info')"><Icon name="page" :size="16" /> 群资料</button><button @click="openInvite"><Icon name="plus" :size="16" /> 邀请</button></div>
      <Transition name="group-content" mode="out-in">
      <section :key="settingsTab" :id="'settings-'+settingsTab" role="tabpanel" class="settings-content">
        <template v-if="settingsTab === 'personal'">
          <section v-if="isGroup" class="group-card"><div class="group-section-head"><h3>我在本群的资料</h3></div><form @submit.prevent="saveNick"><label class="group-field">我的本群昵称<input v-model="nick" aria-label="我的本群昵称" placeholder="留空则使用账号昵称" :disabled="busy" /></label><div class="group-actions"><button class="group-primary" :disabled="busy">{{ busy ? '保存中…' : '保存昵称' }}</button></div></form></section>
          <section v-if="isGroup" class="group-card"><h3>群聊备注</h3><p class="group-caption setting-note">只在本机显示，便于辨认群聊。</p><form @submit.prevent="saveRemark"><label class="group-field"><input v-model="remark" aria-label="群聊备注" placeholder="填写本地备注" /></label><div class="group-actions"><button class="ghost small">保存备注</button></div></form></section>
          <section class="group-card"><div class="group-setting-row"><div><b id="setting-pin">设为置顶</b><p class="group-caption">将会话保留在列表的置顶区域。</p></div><button class="group-switch" role="switch" :aria-checked="pinned" aria-labelledby="setting-pin" @click="togglePin"><i /></button></div></section>
          <div v-if="!isGroup" class="group-card"><div class="group-actions"><button class="ghost small" @click="g.openProfile(cur)">查看资料</button><button class="ghost small" @click="ctx.social?.apply?.(cur.id, 1, '')">添加好友</button><button v-if="isFriend" class="ghost small danger" @click="delFriend">删除好友</button></div></div>
        </template>
        <template v-else-if="settingsTab === 'notifications'">
          <section class="group-card"><div class="group-section-head"><h3>消息通知</h3></div><div class="group-setting-row"><div><b id="setting-mute">消息免打扰</b><p class="group-caption">继续接收消息，不弹出通知提醒。</p></div><button class="group-switch" role="switch" :aria-checked="muted" aria-labelledby="setting-mute" @click="toggleMute"><i /></button></div><label v-if="isGroup" class="group-field setting-note">消息接收方式<select class="gp-select" :value="notifyMode" @change="setNotifyMode(Number(($event.target as HTMLSelectElement).value))"><option :value="0">接收消息并提醒</option><option :value="1">接收消息但不提醒</option><option :value="2">屏蔽群消息（本地隐藏会话）</option></select></label></section>
        </template>
        <GroupPolicySettings v-else-if="settingsTab === 'management'" />
        <template v-else>
          <section v-if="isGroup" class="group-card"><div class="group-section-head"><h3>群聊成员</h3><button class="gp-link" @click="g.setDockTab('members')">查看全部 {{ info?.headcount || '' }} 人</button></div><div class="gp-grid"><button v-for="m in members" :key="m.id" class="gp-cell" :title="m.name" @click="mmProfile2(m)" @contextmenu.prevent="openMemberMenu(m,$event)"><span class="gp-cell-wrap"><img :src="m.avatar ? resUrl(m.avatar) : fallbackAvatar(m.name)" alt="" @error="(e:any) => e.target.src = fallbackAvatar(m.name)" /><em v-if="m.level >= 100" class="gp-role owner">群主</em><em v-else-if="m.level >= 2" class="gp-role admin">管理</em></span><span>{{ m.name }}</span></button><button class="gp-cell add" @click="openInvite"><Icon name="plus" :size="18" /><span>邀请</span></button></div></section>
          <section v-if="isGroup" class="group-card"><div class="group-section-head"><h3>群看板</h3><div><button v-if="boardLong" class="gp-link" @click="boardOpen = !boardOpen">{{ boardOpen ? '收起' : '展开' }}</button><button v-if="boardHtml" class="gp-link" @click="g.setDockTab('board')">完整查看</button></div></div><div ref="boardBox" class="gp-notice rich" :class="{ open: boardOpen }" v-html="boardHtml || '<span class=dim>暂无看板</span>'" /></section>
          <section class="group-card settings-danger"><h3>会话操作</h3><button class="settings-danger-action" @click="clearLocalHistory">清除本地聊天缓存 <Icon name="chevronRight" :size="14" /></button><p class="group-caption">仅清除本机缓存，云端聊天记录仍保留。</p><button v-if="isGroup" class="settings-danger-action" :disabled="isOwner" @click="leaveGroup">{{ isOwner ? '群主需先转让或解散群聊' : '退出群聊' }}<Icon name="chevronRight" :size="14" /></button></section>
        </template>
      </section>
      </Transition>
    </div>

    <!-- 成员右键菜单（QQ 式，只含有后端的项） -->
    <Teleport to="body">
      <!-- 邀请好友入群：多选好友 + 确认框（/v1/group/invite） -->
      <div v-if="invOpen" class="qr-mask" @click.self="invOpen = false">
        <div class="qr-box wide">
          <div class="qr-head">
            <b>邀请入群（已选 {{ invSel.size }}）</b>
            <button class="gp-x" title="关闭" @click="invOpen = false">×</button>
          </div>
          <div class="inv-tabs">
            <button class="sp-tab" :class="{ on: invTab === 'friends' }" @click="invTab = 'friends'; invSel = new Set()">好友</button>
            <button class="sp-tab" :class="{ on: invTab === 'groups' }" @click="invTab = 'groups'; invSel = new Set()">群聊（发群号）</button>
          </div>
          <div class="inv-list">
            <label v-for="u in invList" :key="u.id" class="inv-row">
              <input type="checkbox" :checked="invSel.has(u.id)" @change="toggleInv(u.id)" />
              <img :src="u.avatar ? resUrl(u.avatar) : fallbackAvatar(u.name)" alt="" />
              <span>{{ u.name }}</span>
            </label>
            <p v-if="!invList.length" class="dim small">{{ invTab === 'friends' ? '通讯录里没有其他好友' : '没有其他群聊' }}</p>
          </div>
          <div class="gp-row">
            <button class="ghost small" @click="invOpen = false">取消</button>
            <button class="ghost small" :disabled="!invSel.size || invBusy" @click="sendInvite">发送邀请</button>
          </div>
        </div>
      </div>
      <!-- 群分享弹窗：二维码（本地 qrcode 库生成，官方链接为内容）+ 可复制链接 -->
      <div v-if="qrView" class="qr-mask" @click.self="qrView = null">
        <div class="qr-box">
          <div class="qr-head">
            <b>群分享 · {{ cur?.name }}</b>
            <button class="gp-x" title="关闭" @click="qrView = null">×</button>
          </div>
          <img v-if="qrView.qr" :src="qrView.qr" alt="群分享二维码" class="qr-img" />
          <img v-else-if="qrView.url" :src="qrView.url" alt="群二维码" class="qr-img" />
          <p v-else class="dim small">二维码生成失败，链接仍可复制分享</p>
          <p v-if="qrView.link" class="qr-link" :title="qrView.link">{{ qrView.link }}</p>
          <p v-else class="dim small">云端未返回分享链接</p>
          <p class="dim small">扫码或打开链接加入本群（群号 {{ cur?.id }}）</p>
          <div class="gp-row">
            <button class="ghost small" :disabled="!qrView.link" @click="copyShareLink">复制分享链接</button>
            <button class="ghost small" @click="copyGroupId">复制群号</button>
            <button class="ghost small" @click="openCardPick">分享群卡片</button>
            <a v-if="qrView.shareUrl" class="ghost small" :href="qrView.shareUrl" target="_blank" rel="noreferrer">打开分享页</a>
          </div>
        </div>
      </div>
      <!-- 分享群卡片：转发消息同款大页面（全会话含本群 + 页签 + 搜索 + 多选 + 确认） -->
      <div v-if="cardOpen" class="fd-mask" @click.self="cardOpen = false">
        <div class="fd">
          <div class="fd-head">
            <b>分享「{{ cur?.name }}」群卡片</b>
            <span class="grow"></span>
            <input v-model="cardKw" placeholder="搜索会话…" class="fd-kw" />
            <button class="ghost small" @click="cardOpen = false">关闭</button>
          </div>
          <div class="fd-tabs">
            <button v-for="t in (['all', 'friends', 'groups'] as const)" :key="t"
                    class="fd-tab" :class="{ on: cardTab === t }" @click="cardTab = t">
              {{ t === 'all' ? '全部' : t === 'friends' ? '好友/机器人' : '群聊' }}
            </button>
          </div>
          <ul class="fd-list">
            <li v-for="c2 in cardList" :key="c2.id" :class="{ on: cardSel.has(c2.id) }" @click="toggleCard(c2.id)">
              <img :src="c2.avatar ? resUrl(c2.avatar) : fallbackAvatar(c2.name)" alt="" />
              <span class="nm">{{ c2.name }}</span>
              <span class="ty">{{ c2.id === cur?.id ? '本群' : (c2.type === 2 ? '群聊' : c2.type === 3 ? '机器人' : '好友') }}</span>
              <span class="ck">{{ cardSel.has(c2.id) ? '✓' : '' }}</span>
            </li>
            <li v-if="!cardList.length" class="empty">没有匹配的会话</li>
          </ul>
          <div class="fd-foot">
            <span class="dim small">已选 {{ cardSel.size }} 个目标</span>
            <span class="grow"></span>
            <button :disabled="!cardSel.size || cardBusy" @click="sendCard">发送群卡片</button>
          </div>
        </div>
      </div>
      <div v-if="mm.open" class="mm" :style="{ left: mm.x + 'px', top: mm.y + 'px' }" @click.stop>
        <button class="mm-item" @click="mmSend"><Icon name="send" :size="14" /> 发送消息</button>
        <button class="mm-item" @click="mmAt"><Icon name="quote" :size="14" /> @ TA</button>
        <button class="mm-item" @click="mmProfile"><Icon name="user" :size="14" /> 查看资料</button>
        <button class="mm-item" @click="mmFriend"><Icon name="contacts" :size="14" /> 添加好友</button>
        <button v-if="isGroup && g.roleOf(String(auth.state.user?.id || ''))" class="mm-item" @click="mmGag"><Icon name="bellOff" :size="14" /> {{ mm.m?.isGag ? '解除禁言' : '禁言 1 小时' }}</button>
      </div>
    </Teleport>
  </aside>
  </Transition>
</template>

<style scoped>
.gp.group-settings-slide-enter-active, .gp.group-settings-slide-leave-active { transition: transform 220ms cubic-bezier(.23,1,.32,1), opacity 180ms ease-out; }
.gp.group-settings-slide-enter-from, .gp.group-settings-slide-leave-to { transform: translateX(24px); opacity: 0; }
.gp.group-settings-slide-leave-active { pointer-events: none; interactivity: inert; }
/* 右侧固定面板：贴右、全高、不遮罩（QQ 式）。宽度用固定 px，避免 vw 在异常视口退化 */
.gp {
  position: fixed; right: 0; top: 0; bottom: 28px; width: min(420px, 100vw);
  z-index: 66; background: var(--card); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0, 0, 0, .25);
}
@media (max-width: 900px) { .gp { width: 86vw; } }
.gp > header { display: flex; align-items: center; gap: 8px; padding: 20px; border-bottom: 1px solid var(--line); }
.gp > header .grow { flex: 1; }
.gp-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.gp-body { flex: 1; min-height: 0; overflow: auto; padding: 20px; display: flex; flex-direction: column; gap: 0; background:var(--bg); overscroll-behavior:contain; }
.settings-tabs { display:flex; padding:8px 12px; gap:4px; border-bottom:1px solid var(--line); }
.settings-tabs button { flex:1; min-width:0; background:transparent; color:var(--fg2); border-radius:8px; font-size:12px; padding:8px 4px; }
.settings-tabs button[aria-selected=true] { color:var(--fg); background:var(--card2); }
.settings-identity { display:flex; align-items:center; gap:12px; margin:2px 0 18px; }.settings-identity>img { width:48px; height:48px; border-radius:14px; object-fit:cover; background:var(--card2); }.settings-identity>div { flex:1; min-width:0; }.settings-identity b { display:block; font-size:15px; font-weight:600; overflow-wrap:anywhere; }.settings-identity span { display:block; }.settings-identity button { display:grid; place-items:center; padding:7px; }
.settings-shortcuts { display:flex; gap:8px; margin-bottom:20px; }.settings-shortcuts button { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; background:var(--card); color:var(--fg); border:1px solid var(--line); font-size:12px; padding:9px 5px; border-radius:10px; }
.setting-note { margin:7px 0 16px !important; }.settings-content { min-width:0; }.settings-danger-action { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; padding:13px 0; background:transparent; color:var(--err); font-size:13px; margin-top:6px; }.settings-danger h3 { margin-bottom:3px; }.settings-danger-action:disabled { color:var(--fg2); opacity:1; }
@media(max-width:600px) { .gp { width:min(420px,100vw) !important; }.gp-body { padding:16px; }.gp>header { padding:16px; } }
@media(prefers-reduced-motion:reduce) { .gp.group-settings-slide-enter-active,.gp.group-settings-slide-leave-active { transition:opacity 80ms linear; }.gp.group-settings-slide-enter-from,.gp.group-settings-slide-leave-to { transform:none; } }
.gp-card { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.gp-card img { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: var(--card2); }
.gp-card-main { min-width: 0; }
.gp-card-main b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-sec { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--fg2); margin: 10px 0 6px; }
.gp-link { background: none; border: none; color: var(--acc); font-size: 12px; cursor: pointer; padding: 0; }
.gp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.gp-cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px;
  border: none; border-radius: 8px; background: none; color: var(--fg2); font-size: 10.5px; cursor: pointer;
}
.gp-cell:hover { background: var(--card2); color: var(--fg); }
.gp-cell img { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; background: var(--card2); }
/* 成员宫格身份角标（群主金/管理紫，叠头像右下） */
.gp-cell-wrap { position: relative; display: inline-block; }
.gp-role {
  position: absolute; right: -6px; bottom: -3px; font-style: normal;
  font-size: 9px; line-height: 1; padding: 1.5px 3px; border-radius: 4px;
  border: 1px solid var(--card); white-space: nowrap;
}
.gp-role.owner { background: #d4a017; color: #fff; }
.gp-role.admin { background: var(--acc); color: #fff; }
.gp-cell.add { border: 1px dashed var(--line); }
.gp-notice {
  font-size: 12.5px; color: var(--fg2); background: var(--card2); border-radius: 8px;
  padding: 8px 10px; cursor: pointer; white-space: pre-wrap; word-break: break-word;
  min-height: 60px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.gp-notice.open { display: block; -webkit-line-clamp: unset; overflow: visible; }
.gp-link-group { display: inline-flex; gap: 10px; align-items: center; }
.gp-board-note { font-size: 11px; margin: 5px 0 2px; opacity: .8; }
.gp-more { font-style: normal; color: var(--acc); }
.gp-row { display: flex; gap: 8px; align-items: center; }
.gp-row input {
  flex: 1; min-width: 0; background: var(--card2); border: 1px solid var(--line);
  border-radius: 8px; color: var(--fg); padding: 7px 10px; font-size: 13px; outline: none;
}
.gp-row input:focus { border-color: var(--acc); }
.gp-switch {
  display: flex; justify-content: space-between; align-items: center; padding: 9px 2px;
  font-size: 13px; color: var(--fg); cursor: pointer; border-bottom: 1px solid var(--line);
}
.sw {
  width: 38px; height: 21px; border-radius: 999px; border: none; background: var(--line);
  position: relative; cursor: pointer; transition: background .15s;
}
.sw i {
  position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%;
  background: #fff; transition: left .15s;
}
.sw.on { background: var(--acc); }
.sw.on i { left: 19px; }
.gp-danger {
  margin-top: 14px; padding: 9px 0; border-radius: 9px; border: none;
  background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); font-size: 13.5px; cursor: pointer;
}
.gp-danger:hover { background: color-mix(in srgb, var(--err) 24%, transparent); }
.gp-select {
  width: 100%; background: var(--card2); border: 1px solid var(--line); border-radius: 10px;
  color: var(--fg); padding: 9px 10px; font-size: 13px; outline: none;
}
.gp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.gp-clear {
  margin-top: 8px; padding: 9px 0; border-radius: 9px; border: none;
  background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err);
  font-size: 13px; cursor: pointer;
}
.gp-clear:hover { background: color-mix(in srgb, var(--err) 22%, transparent); }
.gp-clear:disabled { opacity: .5; cursor: not-allowed; }
/* 群二维码弹窗 */
.qr-mask { position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, .5); display: grid; place-items: center; backdrop-filter: blur(3px); }
.qr-box {
  width: min(320px, 90vw); background: var(--card); border: 1px solid var(--line);
  border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; align-items: center;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .5);
}
.qr-head { width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.qr-img { width: 200px; height: 200px; object-fit: contain; background: #fff; border-radius: 10px; padding: 8px; }
.qr-link {
  font-size: 11px; color: var(--acc); word-break: break-all; text-align: center;
  max-width: 100%; user-select: all; cursor: text; line-height: 1.5;
}
.qr-box.wide { width: min(380px, 92vw); align-items: stretch; }
.inv-list { max-height: 46vh; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.inv-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  font-size: 13px; cursor: pointer; color: var(--fg);
}
.inv-row:hover { background: var(--card2); }
.inv-row img { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.inv-row input { width: auto; accent-color: var(--acc); }
.inv-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
.inv-tabs .sp-tab {
  padding: 5px 12px 6px; border: none; background: none; color: var(--fg2);
  font-size: 12.5px; cursor: pointer; border-bottom: 2px solid transparent;
}
.inv-tabs .sp-tab.on { color: var(--acc); border-bottom-color: var(--acc); font-weight: 600; }
.mt { margin-top: 10px; }
/* 分享群卡片大页面（与转发消息 ForwardDialog 同款视觉） */
.fd-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center; z-index: 120;
}
.fd {
  width: 420px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  overflow: hidden;
}
.fd-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.fd-head .grow { flex: 1; }
.fd-kw { max-width: 140px; }
.fd-tabs { display: flex; gap: 4px; padding: 8px 16px; }
.fd-tab {
  padding: 4px 12px 5px; border: none; background: none; color: var(--fg2);
  font-size: 12.5px; cursor: pointer; border-bottom: 2px solid transparent;
}
.fd-tab:hover { color: var(--fg); }
.fd-tab.on { color: var(--acc); border-bottom-color: var(--acc); font-weight: 600; }
.fd-list { list-style: none; margin: 0; padding: 0 8px; overflow: auto; flex: 1; }
.fd-list li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer; }
.fd-list li:hover { background: var(--card2); }
.fd-list li.on { background: var(--acc-soft); }
.fd-list img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; background: var(--card2); }
.fd-list .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-list .ty { font-size: 11px; color: var(--fg2); }
.fd-list .ck { width: 18px; text-align: center; color: var(--acc); font-weight: 700; }
.fd-list .empty { justify-content: center; color: var(--fg2); cursor: default; }
.fd-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--line); }
.fd-foot .grow { flex: 1; }
.fd-foot button { padding: 7px 16px; border-radius: 9px; border: none; background: var(--acc); color: #fff; font-size: 13px; cursor: pointer; }
.fd-foot button:disabled { opacity: .5; cursor: not-allowed; }
.gp-msglimit { display: flex; flex-direction: column; gap: 8px; }
.gp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* 成员右键菜单 */
.mm {
  position: fixed; z-index: 90; min-width: 150px; background: var(--card);
  border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); padding: 5px;
}
.mm-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 7px 10px; border: none; border-radius: 7px; background: none;
  color: var(--fg); font-size: 13px; cursor: pointer;
}
.mm-item:hover { background: var(--card2); }
</style>
