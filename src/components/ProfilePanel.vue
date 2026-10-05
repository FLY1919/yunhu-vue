<script setup lang="ts">
/**
 * 用户主页抽屉（点消息头像 / 昵称 / 侧栏自己头像打开）。
 *
 * 三种数据来源：
 *   · 普通用户 → /v1/user/get-user（字段号按 full.proto#GetUserResponse.Data）
 *   · 机器人   → /v1/bot/bot-info（get-user 对机器人返回「该用户不存在」）
 *   · 板块     → /v1/community/ba/list-by-create（**看谁的资料就显示谁的板块**）
 *
 * 好友判断：通讯录里有就是好友 → 显示「发消息」；否则显示「添加好友」；
 * 看自己资料时显示「这是你自己」。点板块 chip 会跳到控制台板块页并进入该板块。
 */
import { inject, ref, computed, watch } from 'vue'
import { resUrl } from '../core/res'
import { fallbackAvatar, fmtTime } from '../core/util'

const ctx = inject<any>('ctx')
const g = ctx.group
const chat = ctx.chat
const api = ctx.api
const ui = ctx.ui
const cm = ctx.community
/** 该用户创建的板块（点谁的头像就看谁的，不再固定显示「我的」） */
const userBas = ref<any[]>([])
const basLoading = ref(false)

async function loadBas(id: string) {
  if (!id) { userBas.value = []; return }
  basLoading.value = true
  try {
    userBas.value = await ctx.api.baListByCreate(id)
  } catch {
    // 接口失败时，如果是自己就退回本地缓存的「我的板块」
    userBas.value = String(id) === String(ctx.auth?.state?.user?.id || '') ? (cm?.state?.mine || []) : []
  } finally { basLoading.value = false }
}

/** 点板块 → 跳到控制台「板块」页并定位到这个板块 */
function gotoBoard(b: any) {
  ctx.community?.focus?.(b)          // 让板块页选中它（并尽量进入）
  ctx.console?.goto?.('/community')  // 真正的跳页
}

const data = ref<any>(null)
const loading = ref(false)
const tags = computed(() => (g?.state?.profileUser ? g.tagsOf(g.state.profileUser.id) : []))

const GENDER = { 1: '男', 2: '女', 3: '其他' }

const isMe = computed(() => {
  const id = data.value?.id || g.state.profileUser?.id
  return !!id && String(id) === String(ctx.auth?.state?.user?.id || '')
})

const isFriend = computed(() => {
  const id = data.value?.id || g.state.profileUser?.id
  if (!id || data.value?.isBot) return true     // 机器人不判断好友
  return g.isFriend(id)
})

/** 非好友 → 添加好友 */
async function addFriend() {
  const id = data.value?.id || g.state.profileUser?.id
  if (!id) return
  try {
    await api.applyFriend(id, 1, '')
    ui.toast('已发送好友申请', 'success')
  } catch (e: any) { ui.toast('申请失败：' + e.message, 'error') }
}

async function load() {
  const u = g.state.profileUser
  if (!u) { data.value = null; return }
  loading.value = true
  try {
    data.value = await api.getUser(u.id)
  } catch (e: any) {
    // 机器人不是「用户」（get-user 返回「该用户不存在」），改走 /v1/bot/bot-info
    if (u.isBot || /不存在/.test(e.message)) {
      try {
        data.value = await api.botInfo(u.id)
        loading.value = false
        return
      } catch (e2: any) {
        data.value = { id: u.id, name: u.name || u.id, avatar: u.avatar, isBot: true, _note: '机器人资料加载失败：' + e2.message }
        loading.value = false
        return
      }
    }
    ui.toast('资料加载失败：' + e.message, 'error')
    data.value = null
  } finally { loading.value = false }
}

watch(() => g.state.profileUser, (u) => {
  load()
  // 看谁的资料就拉谁的板块
  if (u?.id) loadBas(String(u.id))
  if (u && !(cm?.state?.mine || []).length) cm?.mine?.()
})

/** 和 TA 聊天：切到该用户的私聊会话 */
function chatWith() {
  const u = data.value || g.state.profileUser
  const conv = chat.state.conversations.find((c: any) => c.id === u.id)
  if (conv) { chat.open(conv); g.closeProfile() }
  else ui.toast('还没有和 TA 的会话', 'warn')
}

function copyId() {
  const id = data.value?.id || g.state.profileUser?.id
  navigator.clipboard?.writeText(id).then(
    () => ui.toast('已复制 ID', 'success'),
    () => window.prompt('复制 ID：', id),
  )
}
</script>

<template>
  <div v-if="g.state.profileUser" class="pf-mask" @click.self="g.closeProfile()">
    <aside class="pf">
      <header>
        <b>用户主页</b>
        <span class="grow"></span>
        <button class="pf-x" @click="g.closeProfile()">×</button>
      </header>

      <div class="pf-body" v-if="loading">加载中…</div>

      <div class="pf-body" v-else-if="data">
        <div class="pf-top">
          <img :src="data.avatar ? resUrl(data.avatar) : fallbackAvatar(data.name)"
               @error="(e: any) => (e.target.src = fallbackAvatar(data.name))" alt="" />
          <div>
            <div class="pf-name">
              {{ data.name }}
              <em v-if="data.isBot" class="bot">机器人</em>
              <em v-if="data.isVip" class="vip">VIP</em>
              <em v-if="data.banId" class="ban">封禁中</em>
            </div>
            <div class="dim small">ID {{ data.id }}</div>
            <div class="pf-tags" v-if="tags.length">
              <span v-for="t in tags" :key="t.id" class="pf-tag" :style="{ background: (t.color || '#888') + '22', color: t.color || '#888' }">{{ t.tag }}</span>
            </div>
          </div>
        </div>

        <p class="dim small" v-if="data._note">{{ data._note }}</p>

        <!-- 机器人资料（/v1/bot/bot-info） -->
        <div class="pf-grid" v-if="data.isBot">
          <div class="kv" v-if="data.id"><span class="k">机器人 ID</span><span>{{ data.id }}</span></div>
          <div class="kv" v-if="data.headcount"><span class="k">使用人数</span><span>{{ data.headcount }}</span></div>
          <div class="kv" v-if="data.createTime"><span class="k">创建时间</span><span>{{ fmtTime(data.createTime) }}</span></div>
          <div class="kv"><span class="k">可见性</span><span>{{ data.isPrivate ? '私有' : '公开' }}</span></div>
          <div class="kv"><span class="k">状态</span><span>{{ data.isStopped ? '已停用' : '运行中' }}</span></div>
          <div class="kv" v-if="data.autoAgree"><span class="k">进群方式</span><span>自动同意</span></div>
          <div class="kv" v-if="data.groupLimit"><span class="k">进群限制</span><span>限制进群</span></div>
          <div class="kv" v-if="data.isDeleted"><span class="k">标记</span><span>已删除</span></div>
        </div>

        <div class="pf-intro" v-if="data.isBot && data.introduction">
          <div class="lab">机器人介绍</div>
          <p>{{ data.introduction }}</p>
        </div>

        <div class="pf-grid" v-if="!data.isBot">
          <div class="kv"><span class="k">注册时间</span><span>{{ data.registerTime || '—' }}</span></div>
          <div class="kv"><span class="k">在线天数</span><span>{{ data.onlineDay ?? '—' }} 天（连续 {{ data.continuousOnlineDay ?? '—' }}）</span></div>
          <div class="kv"><span class="k">勋章</span><span>{{ data.medalCount ?? 0 }} 枚</span></div>
          <div class="kv"><span class="k">IP 归属地</span><span>{{ data.ipGeo || '—' }}</span></div>
          <div class="kv" v-if="data.profile?.gender"><span class="k">性别</span><span>{{ GENDER[data.profile.gender] || '—' }}</span></div>
          <div class="kv" v-if="data.profile?.birthday"><span class="k">生日</span><span>{{ new Date(data.profile.birthday * 1000).toLocaleDateString() }}</span></div>
          <div class="kv" v-if="data.profile?.city"><span class="k">所在地</span><span>{{ data.profile.city }}{{ data.profile.district }}</span></div>
          <div class="kv" v-if="data.doNotDisturb"><span class="k">免打扰</span><span>已开启</span></div>
          <div class="kv" v-if="data.isBlocked"><span class="k">黑名单</span><span>已拉黑</span></div>
        </div>

        <div class="pf-intro" v-if="data.profile?.introduction">
          <div class="lab">简介</div>
          <p>{{ data.profile.introduction }}</p>
        </div>

        <!-- 我的板块（云湖的「文章分区」） -->
        <div class="pf-ba" v-if="userBas.length">
          <div class="lab">
            {{ isMe ? '我的板块' : 'TA 的板块' }}
            <span class="dim small">（{{ userBas.length }} 个）</span>
          </div>
          <div class="ba-list">
            <button v-for="b in userBas" :key="b.id" class="ba-chip" @click="gotoBoard(b)">
              <img v-if="b.avatar" :src="resUrl(b.avatar)" alt="" />
              <span v-else class="ba-ic">{{ (b.name || '?').slice(0, 1) }}</span>
              {{ b.name }}
            </button>
          </div>
        </div>

        <div class="pf-actions">
          <!-- 好友才能直接发消息；非好友只能加好友 -->
          <template v-if="isMe">
            <button class="small" @click="chatWith">发消息</button>
            <span class="dim small" style="align-self:center">这是你自己</span>
          </template>
          <template v-else-if="!data.isBot && !isFriend">
            <button class="small" @click="addFriend">添加好友</button>
            <span class="dim small" style="align-self:center">你们还不是好友</span>
          </template>
          <button v-else-if="!isMe" class="small" @click="chatWith">发消息</button>
          <button class="ghost small" @click="copyId">复制 ID</button>
          <button class="ghost small" @click="load">刷新</button>
        </div>
      </div>

      <div class="pf-body" v-else>没有拿到资料</div>
    </aside>
  </div>
</template>

<style scoped>
.pf-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 115; display: flex; justify-content: flex-end; }
.pf { width: 400px; max-width: 94vw; background: var(--card); border-left: 1px solid var(--line); display: flex; flex-direction: column; box-shadow: var(--shadow); }
.pf > header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.pf > header .grow { flex: 1; }
.pf-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.pf-x:hover { color: var(--err); background: transparent; }
.pf-body { flex: 1; overflow: auto; padding: 16px; }
.pf-top { display: flex; gap: 12px; align-items: center; }
.pf-top img { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.pf-name { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.pf-name em { font-style: normal; font-size: 11px; border-radius: 5px; padding: 1px 6px; }
.pf-name em.vip { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
.pf-name em.ban { color: var(--err); background: color-mix(in srgb, var(--err) 18%, transparent); }
.pf-name em.bot { color: var(--acc); background: var(--acc-soft); }
.pf-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.pf-tag { font-size: 11px; border-radius: 5px; padding: 1px 6px; }
.pf-grid { display: grid; grid-template-columns: 1fr; gap: 2px; margin-top: 14px; }
.kv { display: flex; gap: 10px; font-size: 13px; padding: 3px 0; }
.kv .k { flex: 0 0 80px; color: var(--fg2); font-size: 12.5px; }
.pf-intro { margin-top: 14px; }
.pf-intro .lab { font-size: 12.5px; color: var(--fg2); margin-bottom: 4px; }
.pf-intro p { margin: 0; font-size: 13px; white-space: pre-wrap; background: var(--card2); padding: 10px; border-radius: 8px; }
.pf-actions { display: flex; gap: 8px; margin-top: 18px; }
.pf-ba { margin-top: 16px; }
.pf-ba .lab { font-size: 12.5px; color: var(--fg2); margin-bottom: 6px; }
.ba-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ba-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.ba-chip:hover { border-color: var(--acc); color: var(--acc); }
.ba-chip img, .ba-ic { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; display: inline-flex; align-items: center; justify-content: center; background: var(--card2); font-size: 11px; }
</style>
