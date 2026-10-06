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
import { resUrl } from '../../core/res'
import { fallbackAvatar } from '../../core/util'

const ctx = inject<any>('ctx')
const sc = ctx.social
const s = sc.state

const tab = ref<'users' | 'groups' | 'bots'>('users')
const kw = ref('')
const addOpen = ref(false)
const addForm = ref({ targetId: '', chatType: 1, message: '' })
const newGroup = ref({ name: '', introduction: '' })

const current = computed(() => {
  const list = s.book?.[tab.value] || []
  const k = kw.value.trim()
  return k ? list.filter((x: any) => (x.name || '').includes(k) || (x.remark || '').includes(k) || x.id.includes(k)) : list
})

onMounted(() => sc.loadBook())

async function doApply() {
  try {
    await sc.apply(addForm.value.targetId.trim(), addForm.value.chatType, addForm.value.message)
    addOpen.value = false
    addForm.value = { targetId: '', chatType: 1, message: '' }
  } catch { /* social 已提示 */ }
}

async function doCreateGroup() {
  if (!newGroup.value.name.trim()) return ctx.ui.toast('群名不能为空', 'warn')
  await sc.createGroup(newGroup.value.name.trim(), newGroup.value.introduction)
  newGroup.value = { name: '', introduction: '' }
}

/**
 * 点某个对象 → 跳到对应会话；**本地没有就就地造一个**（仿 TG/QQ：点联系人直接进对话）
 * 造出来的会话只是本地壳，发消息时按 id/type 直接发到对方即可。
 */
function openChat(it: any) {
  let conv = ctx.chat.state.conversations.find((c: any) => c.id === it.id)
  if (!conv) {
    conv = {
      id: it.id, type: ctx.social?.chatTypeOf?.(tab.value) ?? (tab.value === 'groups' ? 2 : tab.value === 'bots' ? 3 : 1),
      name: it.name, avatar: it.avatar, preview: '', ts: Date.now(), unread: 0,
    }
    ctx.chat.state.conversations.unshift(conv)
    ctx.ui.toast('已创建本地会话', 'success', 1500)
  }
  ctx.chat.open(conv)
}
function showProfile(it: any) {
  ctx.group?.openProfile?.({ id: it.id, name: it.name, avatar: it.avatar, isBot: tab.value === 'bots' })
}
</script>

<template>
  <KLayout ns="contacts" title="通讯录" desc="我加的用户 / 群聊 / 机器人 · 添加与创建">
    <template #actions>
      <span class="pill">{{ (s.book?.users || []).length }} 用户</span>
      <span class="pill">{{ (s.book?.groups || []).length }} 群聊</span>
      <span class="pill">{{ (s.book?.bots || []).length }} 机器人</span>
      <button class="ghost small" @click="sc.loadBook()">刷新</button>
      <button class="small" @click="addOpen = !addOpen">＋ 添加</button>
    </template>

    <!-- 申请处理 -->
    <KCard v-if="s.requests.length" :title="`待处理申请（${s.requests.length}）`">
      <div class="req" v-for="r in s.requests" :key="r.id">
        <img :src="r.avatar ? resUrl(r.avatar) : fallbackAvatar(r.name)" @error="(e: any) => (e.target.src = fallbackAvatar(r.name))" alt="" />
        <div class="rmain">
          <b>{{ r.name }}</b>
          <span class="dim small">{{ r.chatType === 2 ? '群聊' : r.chatType === 3 ? '机器人' : '用户' }} {{ r.targetId }}</span>
          <div v-if="r.message" class="dim small">「{{ r.message }}」</div>
        </div>
        <button class="small" @click="sc.handleRequest('agree', r.id)">同意</button>
        <button class="ghost small" @click="sc.handleRequest('ignore', r.id)">忽略</button>
        <button class="ghost small danger" @click="sc.handleRequest('delete', r.id)">删除</button>
      </div>
    </KCard>

    <!-- 添加 -->
    <KCard v-if="addOpen" title="添加好友 / 群聊 / 机器人">
      <div class="row">
        <select v-model.number="addForm.chatType">
          <option :value="1">用户</option>
          <option :value="2">群聊</option>
          <option :value="3">机器人</option>
        </select>
        <input v-model="addForm.targetId" placeholder="对方 ID" />
        <input v-model="addForm.message" placeholder="验证消息（可选）" />
        <button class="small" @click="doApply">发送申请</button>
      </div>
    </KCard>

    <KCard title="创建群聊" class="mt">
      <div class="row">
        <input v-model="newGroup.name" placeholder="群名称" />
        <input v-model="newGroup.introduction" placeholder="群简介（可选）" />
        <button class="small" @click="doCreateGroup">创建</button>
      </div>
      <p class="dim small">创建成功后新群会出现在左侧会话列表（如果没出现，刷新一下）。</p>
    </KCard>

    <KCard class="mt" :pad="false">
      <div class="tabs">
        <button class="ghost small" :class="{ on: tab === 'users' }" @click="tab = 'users'">用户</button>
        <button class="ghost small" :class="{ on: tab === 'groups' }" @click="tab = 'groups'">群聊</button>
        <button class="ghost small" :class="{ on: tab === 'bots' }" @click="tab = 'bots'">机器人</button>
        <input v-model="kw" placeholder="搜索…" style="max-width: 180px" />
        <span class="dim small">共 {{ current.length }} 个</span>
      </div>
      <div class="list">
        <div class="item" v-for="it in current" :key="it.id">
          <img :src="it.avatar ? resUrl(it.avatar) : fallbackAvatar(it.name)" @error="(e: any) => (e.target.src = fallbackAvatar(it.name))" alt="" />
          <div class="imain">
            <div class="iname">
              {{ it.name }}
              <em v-if="it.level >= 100">群主</em>
              <em v-else-if="it.level >= 2">管理员</em>
              <em v-if="it.noDisturb" class="mute">免打扰</em>
            </div>
            <div class="dim small">ID {{ it.id }}<span v-if="it.remark"> · 备注 {{ it.remark }}</span></div>
          </div>
          <div class="acts">
            <button class="ghost small" @click="showProfile(it)">资料</button>
            <button class="small" @click="openChat(it)">发消息</button>
          </div>
        </div>
        <p v-if="!current.length" class="dim center">{{ s.loading ? '加载中…' : '这里还是空的' }}</p>
      </div>
    </KCard>
  </KLayout>
</template>

<style scoped>
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row input, .row select { flex: 1; min-width: 130px; }
.tabs { display: flex; gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.tabs .on { background: var(--acc); color: #fff; border-color: transparent; }
.list { max-height: 52vh; overflow: auto; }
.item { display: flex; gap: 10px; align-items: center; padding: 7px 12px; border-bottom: 1px dashed var(--line); flex-wrap: wrap; }
.acts { display: flex; gap: 6px; flex: 1 0 100%; margin-top: 4px; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.acts::-webkit-scrollbar { display: none; }
.acts > * { flex: 0 0 auto; }
.item img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.imain { flex: 1; min-width: 0; }
.iname { font-size: 13.5px; display: flex; gap: 6px; align-items: center; }
.iname em { font-style: normal; font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--acc-soft); color: var(--acc); }
.iname em.mute { background: var(--card2); color: var(--fg2); }
.req { display: flex; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.req img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.rmain { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.center { text-align: center; padding: 16px 0; }
.mt { margin-top: 12px; }
</style>
