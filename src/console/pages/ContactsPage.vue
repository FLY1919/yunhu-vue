<script setup lang="ts">
/**
 * 通讯录页（social 插件注册）
 * 三类聊天对象：用户 / 我加入的群聊 / 机器人（来自 /v1/friend/address-book-list）
 * 另外带：好友申请处理、添加好友/群/机器人、创建群聊
 */
import { inject, ref, computed, onMounted } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import Icon from '../components/Icon.vue'
import CreateGroupForm from '../../components/CreateGroupForm.vue'
import { resUrl } from '../../core/res'
import { fallbackAvatar } from '../../core/util'

const ctx = inject<any>('ctx')
const sc = ctx.social
const s = sc.state

const tab = ref<'users' | 'groups' | 'bots' | 'discover'>('users')
const kw = ref('')
const addOpen = ref(false)
const createOpen = ref(false)
const submitting = ref(false)
const tabs = [
  { id: 'users', title: '好友', icon: 'user' },
  { id: 'groups', title: '群聊', icon: 'contacts' },
  { id: 'bots', title: '机器人', icon: 'robot' },
  { id: 'discover', title: '发现', icon: 'star' },
] as const
const addForm = ref({ targetId: '', chatType: 1, message: '' })

/* ---- 「发现」：推荐分区 + 分区内推荐群（/v1/user/recommend-*） ---- */
const discLoading = ref(false)
const discCats = ref<any[]>([])
const discItems = ref<Record<string, any[]>>({})
const discError = ref('')
async function openDiscover(force = false) {
  tab.value = 'discover'
  if ((!force && discCats.value.length) || discLoading.value) return
  discLoading.value = true
  discError.value = ''; discItems.value = {}
  try {
    const cats = await ctx.api.recommendCategories()
    discCats.value = cats
    const results = await Promise.allSettled(cats.map(async c => { discItems.value[c.id] = await ctx.api.recommendList(c.id) }))
    if (results.some(r => r.status === 'rejected')) discError.value = '部分推荐加载失败，请刷新重试。'
  } catch (e: any) { discCats.value = []; discError.value = '推荐加载失败：' + e.message }
  finally { discLoading.value = false }
}
async function applyJoin(it: any) {
  try {
    await sc.apply(String(it.id), 2, '')
    ctx.ui?.toast?.('入群申请已发送', 'success')
  } catch { /* social 已提示 */ }
}

const current = computed(() => {
  if (tab.value === 'discover') return []
  const list = s.book?.[tab.value] || []
  const k = kw.value.normalize('NFKC').trim().toLocaleLowerCase()
  return k ? list.filter((x: any) => `${x.name || ''} ${x.remark || ''} ${x.id}`.normalize('NFKC').toLocaleLowerCase().includes(k)) : list
})

onMounted(() => { sc.loadBook(); sc.loadRequests?.() })

async function doApply() {
  if (submitting.value) return
  if (!addForm.value.targetId.trim()) return ctx.ui.toast('请填写对方 ID', 'warn')
  submitting.value = true
  try {
    await sc.apply(addForm.value.targetId.trim(), addForm.value.chatType, addForm.value.message)
    addOpen.value = false
    addForm.value = { targetId: '', chatType: 1, message: '' }
  } catch { /* social 已提示 */ }
  finally { submitting.value = false }
}

/**
 * 点某个对象 → 跳到对应会话；**本地没有就就地造一个**（仿 TG/QQ：点联系人直接进对话）
 * 造出来的会话只是本地壳，发消息时按 id/type 直接发到对方即可。
 */
function openChat(it: any) {
  const type = ctx.social?.chatTypeOf?.(tab.value) ?? (tab.value === 'groups' ? 2 : tab.value === 'bots' ? 3 : 1)
  let conv = ctx.chat.state.conversations.find((c: any) => String(c.id) === String(it.id) && c.type === type)
  if (!conv) {
    conv = {
      id: String(it.id), type,
      name: it.name, avatar: it.avatar, preview: '', ts: Date.now(), unread: 0,
    }
    ctx.chat.state.conversations.unshift(conv)
    ctx.ui.toast('已创建本地会话', 'success', 1500)
  }
  ctx.console.goto('/')
  ctx.chat.open(conv)
}
function showProfile(it: any) {
  if (tab.value === 'groups') { openChat(it); ctx.group?.open?.(); return }
  ctx.group?.openProfile?.({ id: String(it.id), name: it.name, avatar: it.avatar, isBot: tab.value === 'bots' })
}
</script>

<template>
  <KLayout ns="contacts" title="通讯录" desc="把熟悉的人和常去的群，放在一起。">
    <template #actions>
      <button class="ghost small contact-refresh" :disabled="s.loading || discLoading" @click="tab === 'discover' ? openDiscover(true) : sc.loadBook()"><Icon name="refresh" :size="15" :class="{ spinning: s.loading || discLoading }" /> 刷新</button>
      <button class="ghost small" :aria-expanded="createOpen" @click="createOpen = !createOpen; addOpen = false"><Icon name="contacts" :size="15" /> 创建群聊</button>
      <button class="small" :aria-expanded="addOpen" @click="addOpen = !addOpen; createOpen = false"><Icon name="plus" :size="16" /> 添加</button>
    </template>

    <details v-if="s.requests.length" class="contact-requests">
      <summary><Icon name="bellOn" :size="17" /> 新的好友与入群申请 <b>{{ s.requests.length }}</b></summary>
      <div class="req" v-for="r in s.requests" :key="r.id">
        <img :src="r.avatar ? resUrl(r.avatar) : fallbackAvatar(r.name)" alt="" />
        <div class="rmain"><b>{{ r.name }}</b><span class="dim small">{{ r.message || ('ID ' + r.targetId) }}</span></div>
        <button class="small" @click="sc.handleRequest('agree', r.id)">同意</button>
        <button class="ghost small" @click="sc.handleRequest('ignore', r.id)">忽略</button>
        <button class="ghost small" @click="sc.handleRequest('delete', r.id)" aria-label="删除申请"><Icon name="trash" :size="14" /></button>
      </div>
    </details>

    <Transition name="contact-panel">
      <KCard v-if="addOpen" title="添加好友 / 群聊 / 机器人" class="contact-form">
        <form class="row" @submit.prevent="doApply">
          <select v-model.number="addForm.chatType" aria-label="添加对象类型"><option :value="1">用户</option><option :value="2">群聊</option><option :value="3">机器人</option></select>
          <input v-model="addForm.targetId" aria-label="对方 ID" placeholder="输入对方 ID" />
          <input v-model="addForm.message" aria-label="验证消息" placeholder="验证消息（可选）" />
          <button class="small" :disabled="submitting" type="submit">{{ submitting ? '发送中…' : '发送申请' }}</button>
        </form>
      </KCard>
    </Transition>
    <Transition name="contact-panel">
      <KCard v-if="createOpen" title="创建群聊" class="contact-form">
        <CreateGroupForm @created="createOpen = false" @cancel="createOpen = false" />
      </KCard>
    </Transition>

    <div class="contacts-toolbar">
      <nav class="contact-tabs" aria-label="联系人分类">
        <button v-for="item in tabs" :key="item.id" :class="{ on: tab === item.id }" :aria-pressed="tab === item.id" @click="item.id === 'discover' ? openDiscover() : tab = item.id">
          <Icon :name="item.icon" :size="17" /><span>{{ item.title }}</span><small v-if="item.id !== 'discover'">{{ (s.book?.[item.id] || []).length }}</small>
        </button>
      </nav>
      <label class="contacts-search"><Icon name="search" :size="17" /><input v-model="kw" aria-label="搜索联系人" placeholder="搜索名称、备注或 ID" /><button v-if="kw" class="ghost" aria-label="清空联系人搜索" @click="kw = ''">×</button></label>
    </div>

    <Transition name="contact-list" mode="out-in">
      <div v-if="tab === 'discover'" key="discover" class="contact-discovery">
        <p v-if="discError" class="err" role="alert">{{ discError }} <button class="ghost small" @click="openDiscover(true)">重试</button></p>
        <div v-if="discLoading" class="contact-empty" role="status"><Icon name="refresh" :size="26" class="spinning" /><p>正在发现好玩的群聊…</p></div>
        <template v-else>
          <section v-for="cat in discCats" :key="cat.id" class="disc-category">
            <h3>{{ cat.name || cat.categoryName }}</h3>
            <div class="contact-grid">
              <article class="contact-card" v-for="it in (discItems[cat.id] || []).filter(x => !kw || `${x.name} ${x.id} ${x.introduction || ''}`.toLocaleLowerCase().includes(kw.toLocaleLowerCase()))" :key="it.id">
                <img :src="it.avatar ? resUrl(it.avatar) : fallbackAvatar(it.name)" alt="" />
                <div class="contact-info"><h3>{{ it.name }}</h3><p>{{ it.introduction || ('ID ' + it.id) }}</p></div>
                <button class="ghost small" @click="applyJoin(it)"><Icon name="plus" :size="15" /> 加入</button>
              </article>
            </div>
          </section>
          <div v-if="!discCats.length" class="contact-empty"><Icon name="star" :size="34" /><h3>暂时没有推荐内容</h3><p>稍后再来看看。</p></div>
        </template>
      </div>
      <section v-else :key="tab" class="contact-section">
        <div class="contact-section-title"><span>{{ tabs.find(t => t.id === tab)?.title }}</span><small>{{ current.length }} 位{{ kw ? '匹配结果' : '联系人' }}</small></div>
        <TransitionGroup name="contact-card" tag="div" class="contact-grid">
          <article class="contact-card" v-for="it in current" :key="tab + ':' + it.id">
            <button class="contact-avatar" :aria-label="'查看 ' + it.name + ' 的资料'" @click="showProfile(it)"><img :src="it.avatar ? resUrl(it.avatar) : fallbackAvatar(it.name)" @error="(e: any) => (e.target.src = fallbackAvatar(it.name))" alt="" /></button>
            <div class="contact-info">
              <h3 :title="it.name">{{ it.name }}<Icon v-if="it.noDisturb" name="bellOff" :size="13" title="免打扰" /></h3>
              <p>{{ it.remark || ('ID ' + it.id) }}</p>
              <div v-if="it.level >= 2" class="contact-label">{{ it.level >= 100 ? '群主' : '管理员' }}</div>
            </div>
            <div class="contact-actions">
              <button class="ghost small profile-action" :aria-label="'查看 ' + it.name + ' 的资料'" @click="showProfile(it)"><Icon name="userCircle" :size="16" /></button>
              <button class="small contact-message" :aria-label="'给 ' + it.name + ' 发消息'" @click="openChat(it)"><Icon name="chat" :size="16" /><span>发消息</span></button>
            </div>
          </article>
        </TransitionGroup>
        <div v-if="!current.length" class="contact-empty" role="status"><Icon :name="s.loading ? 'refresh' : kw ? 'search' : tabs.find(t => t.id === tab)?.icon" :size="36" :class="{ spinning: s.loading }" /><h3>{{ s.loading ? '正在加载通讯录…' : kw ? '没有找到相关联系人' : '这里还没有联系人' }}</h3><p>{{ kw ? '换一个名称、备注或 ID 试试。' : '点击右上角的“添加”，开始新的对话。' }}</p></div>
      </section>
    </Transition>
  </KLayout>
</template>

<style scoped>
:deep(.k-header) { padding: 24px 28px; }
:deep(.k-body) { padding: 4px 28px 28px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 160px; }
.contact-form, .contact-requests { margin-bottom: 20px; }
.contacts-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 14px; margin: 8px 0 26px; }
.contact-tabs { display: flex; padding: 5px; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.contact-tabs button { display: flex; gap: 7px; align-items: center; background: none; color: var(--fg2); border: 0; border-radius: 10px; padding: 9px 13px; font-size: 13px; transition: background .18s, color .18s; }
.contact-tabs button.on { color: var(--fg); background: var(--acc-soft); font-weight: 600; }
.contact-tabs small { color: var(--fg2); font-size: 11px; font-weight: 400; }
.contacts-search { display: flex; align-items: center; gap: 9px; border: 1px solid var(--line); background: var(--card); color: var(--fg2); padding: 0 12px; border-radius: 12px; max-width: 300px; flex: 1; min-width: 180px; }
.contacts-search:focus-within { border-color: var(--acc); }
.contacts-search input { width: 100%; min-width: 0; border: 0; background: transparent; padding: 11px 0; box-shadow: none; font-size: 13px; }
.contacts-search button { border: 0; padding: 1px 4px; }
.contact-section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
.contact-section-title > span { font-size: 15px; font-weight: 600; }
.contact-section-title small { color: var(--fg2); font-size: 12px; }
.contact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 12px; position: relative; }
.contact-card { display: flex; align-items: center; gap: 13px; padding: 18px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); min-width: 0; transition: background .2s, border-color .2s, transform .2s, box-shadow .2s; }
.contact-card:hover { background: var(--card2); border-color: color-mix(in srgb, var(--acc) 40%, var(--line)); transform: translateY(-2px); box-shadow: 0 6px 18px rgb(0 0 0 / .06); }
.contact-avatar { border: 0; padding: 0; background: none; border-radius: 50%; flex-shrink: 0; }
.contact-avatar img, .contact-card > img { display: block; width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.contact-info { flex: 1; min-width: 0; }
.contact-info h3 { margin: 0 0 5px; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-info h3 svg { margin-left: 5px; color: var(--fg2); vertical-align: middle; }
.contact-info p { margin: 0; color: var(--fg2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-label { display: inline-block; color: var(--acc); background: var(--acc-soft); padding: 2px 6px; border-radius: 5px; font-size: 10px; margin-top: 6px; }
.contact-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.contact-message { display: flex; align-items: center; gap: 5px; border-radius: 10px; }
.profile-action { border: 0; padding: 6px; background: none; color: var(--fg2); }
.contact-empty { display: grid; justify-items: center; text-align: center; padding: 70px 18px; color: var(--fg2); }
.contact-empty > svg { color: var(--acc); opacity: .7; margin-bottom: 12px; }
.contact-empty h3 { color: var(--fg); font-weight: 500; font-size: 16px; margin: 0 0 8px; }
.contact-empty p { margin: 0; font-size: 13px; }
.contact-requests { border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 14px 18px; }
.contact-requests summary { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; }
.contact-requests summary b { background: var(--acc-soft); color: var(--acc); border-radius: 10px; padding: 2px 7px; }
.req { display: flex; gap: 10px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.req img { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; }
.rmain { flex: 1; min-width: 130px; display: grid; gap: 3px; }
.disc-category h3 { font-size: 14px; margin: 24px 0 12px; }
.contact-panel-enter-active, .contact-panel-leave-active, .contact-list-enter-active, .contact-list-leave-active { transition: opacity .16s ease, transform .16s ease; }
.contact-panel-enter-from, .contact-panel-leave-to, .contact-list-enter-from, .contact-list-leave-to { opacity: 0; transform: translateY(6px); }
.contact-card-move, .contact-card-enter-active, .contact-card-leave-active { transition: opacity .2s, transform .2s; }
.contact-card-enter-from, .contact-card-leave-to { opacity: 0; transform: scale(.98); }
.contact-card-leave-active { position: absolute; }
.spinning { animation: contact-spin 1s linear infinite; }
@keyframes contact-spin { to { transform: rotate(360deg); } }
@media(max-width: 700px) {
  :deep(.k-header) { padding: 18px 16px; flex-wrap: wrap; gap: 14px; }
  :deep(.k-body) { padding: 0 16px 20px; }
  .contact-tabs { overflow-x: auto; width: 100%; }
  .contact-tabs button { flex: 1; justify-content: center; padding: 9px; }
  .contacts-search { max-width: none; }
  .contact-card { padding: 14px; }
  .contact-message span { display: none; }
}
@media(prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
