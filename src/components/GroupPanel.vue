<script setup lang="ts">
/**
 * 会话设置抽屉（聊天右上角 ⋮ → 群设置 / 会话设置）。
 *
 * 两种形态：
 *   · 群聊：我在本群的昵称、群内消息类型限制
 *   · 私聊：对方资料、免打扰开关、加好友 / 删好友（**不能**再显示群功能）
 * 判断依据是 chat.state.current.type === 2（群聊）。
 *
 * ⚠️ 这个文件曾经因为模板里用了 resUrl/fallbackAvatar 但没 import，
 *    整个抽屉渲染成空注释、控制台还不报错 —— 靠 scripts/preflight.mjs 才查出来。
 */
import { inject, ref, computed, onMounted, watch } from 'vue'
import { resUrl } from '../core/res'
import { fallbackAvatar } from '../core/util'

const ctx = inject<any>('ctx')
const g = ctx.group
const chat = ctx.chat
const ui = ctx.ui
const api = ctx.api

/** 群内可限制的消息类型（对齐 /v1/group/msg-type-limit） */
const MSG_TYPES = [
  { v: 1, n: '文本' }, { v: 2, n: '图片' }, { v: 3, n: 'Markdown' }, { v: 4, n: '文件' },
  { v: 6, n: '帖子' }, { v: 7, n: '表情' }, { v: 8, n: 'HTML' }, { v: 10, n: '视频' },
  { v: 11, n: '语音' }, { v: 13, n: '语音通话' },
]

const nick = ref('')
const limit = ref<number[]>([])
const busy = ref(false)
const info = computed(() => g.state.info)

const isOpen = computed(() => g.state.panelOpen)
const cur = computed(() => chat.state.current)

function toggleLimit(v: number) {
  const i = limit.value.indexOf(v)
  if (i >= 0) limit.value.splice(i, 1)
  else limit.value.push(v)
}

async function loadAll() {
  const gid = cur.value?.id
  if (!gid || cur.value?.type !== 2) return
  try { g.state.info = await api.groupInfo(gid) } catch { /* 忽略 */ }
}

async function saveNick() {
  const gid = cur.value?.id
  if (!gid) return
  busy.value = true
  try {
    await api.setMyGroupNickname(gid, nick.value.trim())
    ui.toast('群昵称已更新', 'success')
  } catch (e: any) { ui.toast('失败：' + e.message, 'error') }
  finally { busy.value = false }
}

async function saveLimit() {
  const gid = cur.value?.id
  if (!gid) return
  busy.value = true
  try {
    await api.setMsgTypeLimit(gid, limit.value.join(','))
    ui.toast('消息类型限制已保存', 'success')
  } catch (e: any) { ui.toast('失败：' + e.message, 'error') }
  finally { busy.value = false }
}

/* ---------------- 私聊分支用的状态 ---------------- */
const isGroup = computed(() => cur.value?.type === 2)
const isFriend = computed(() => {
  const id = cur.value?.id
  if (!id) return false
  try { return (ctx.group?.isFriend?.(id) ?? false) } catch { return false }
})
const noDisturb = computed(() => {
  const id = cur.value?.id
  if (!id) return false
  try { return (ctx.social?.state?.book?.users || []).some((u) => u.id === id && u.noDisturb) } catch { return false }
})

/** 免打扰开关（/v1/friend/no-notify） */
async function toggleNoDisturb() {
  const id = cur.value?.id
  if (!id) return
  try {
    await ctx.api.noNotify(id, cur.value.type || 1, !noDisturb.value)
    ctx.ui.toast(noDisturb.value ? '已关闭免打扰' : '已开启免打扰', 'success')
    await ctx.social?.loadBook?.()
  } catch (e) { ctx.ui.toast('设置失败：' + e.message, 'error') }
}

function openProfile() {
  const c = cur.value
  if (c) ctx.group?.openProfile?.({ id: c.id, name: c.name, avatar: c.avatar, isBot: c.type === 3 })
}

async function addFriend() {
  const c = cur.value
  if (!c) return
  const remark = window.prompt('验证消息（可留空）：', '') ?? ''
  try {
    await ctx.api.applyFriend(c.id, c.type === 3 ? 3 : 1, remark)
    ctx.ui.toast('好友申请已发送', 'success')
  } catch (e) { ctx.ui.toast('发送失败：' + e.message, 'error') }
}

async function kickFriend() {
  const c = cur.value
  if (!c || !window.confirm(`确定删除好友「${c.name}」？`)) return
  try {
    await ctx.api.deleteFriend(c.id, c.type === 3 ? 3 : 1)
    ctx.ui.toast('已删除好友', 'success')
    await ctx.social?.loadBook?.()
  } catch (e) { ctx.ui.toast('删除失败：' + e.message, 'error') }
}

onMounted(loadAll)
watch(isOpen, (v) => { if (v) loadAll() })
ctx.on('chat/open', loadAll)
</script>

<template>
  <div v-if="isOpen" class="gp-mask" @click.self="g.close()">
    <aside class="gp">
      <header>
        <b>{{ isGroup ? '群设置' : '会话设置' }}</b>
        <span class="dim small">{{ cur?.name }}</span>
        <span class="grow"></span>
        <button class="gp-x" @click="g.close()">×</button>
      </header>

      <div class="gp-body">
        <!-- ============ 私聊：只显示会话相关的设置，不显示群功能 ============ -->
        <template v-if="!isGroup">
          <div class="gp-info">
            <img :src="cur?.avatar ? resUrl(cur.avatar) : fallbackAvatar(cur?.name)" @error="(e: any) => (e.target.src = fallbackAvatar(cur?.name))" alt="" />
            <div>
              <b>{{ cur?.name }}</b>
              <div class="dim small">
                {{ cur?.type === 3 ? '机器人' : '用户' }} · {{ cur?.id }}
              </div>
              <div class="dim small" v-if="!isFriend" style="opacity:.8">你们还不是好友</div>
            </div>
          </div>

          <label class="lab">免打扰</label>
          <div class="row-inline">
            <button class="ghost small" :class="{ on: noDisturb }" @click="toggleNoDisturb">
              {{ noDisturb ? '已开启' : '已关闭' }}
            </button>
            <span class="dim small">开启后这个会话不再提示</span>
          </div>

          <label class="lab mt">操作</label>
          <div class="row-inline">
            <button class="ghost small" @click="openProfile">查看资料</button>
            <button v-if="!isFriend && cur?.type !== 3" class="ghost small" @click="addFriend">添加好友</button>
            <button v-if="isFriend" class="ghost small danger" @click="kickFriend">删除好友</button>
          </div>
          <p class="dim small mt-sm">
            群聊相关的功能（成员 / 群标签 / 群文件 / 群设置）只在群聊里显示。
          </p>
        </template>

        <!-- ============ 群聊 ============ -->
        <template v-else>
        <div v-if="info" class="gp-info">
          <img :src="info.avatar" alt="" />
          <div>
            <b>{{ info.name }}</b>
            <div class="dim small">{{ info.headcount }} 人 · {{ info.id }}</div>
            <div class="dim small" v-if="info.introduction">{{ info.introduction }}</div>
          </div>
        </div>

        <label class="lab">我在本群的昵称</label>
        <div class="row-inline">
          <input v-model="nick" placeholder="留空则用账号昵称" />
          <button :disabled="busy" @click="saveNick">保存</button>
        </div>

        <label class="lab mt">群内消息类型限制</label>
        <div class="chips">
          <button v-for="t in MSG_TYPES" :key="t.v" class="ghost small"
                  :class="{ on: limit.includes(t.v) }" @click="toggleLimit(t.v)">{{ t.n }}</button>
        </div>
        <div class="row-inline mt-sm">
          <span class="dim small">已选：{{ limit.length ? limit.join(',') : '不限制' }}</span>
          <span class="grow"></span>
          <button class="ghost small" @click="limit = []">清空</button>
          <button :disabled="busy" @click="saveLimit">保存限制</button>
        </div>
        </template>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.gp-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 110; display: flex; justify-content: flex-end; }
.gp {
  width: 420px; max-width: 94vw; background: var(--card); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; box-shadow: var(--shadow);
}
.gp > header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.gp > header .grow { flex: 1; }
.gp-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.gp-x:hover { color: var(--err); background: transparent; }
.gp-body { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; }
.gp-info { display: flex; gap: 10px; align-items: center; padding: 10px; background: var(--card2); border-radius: 10px; margin-bottom: 14px; }
.gp-info img { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: var(--card2); }
.lab { font-size: 12.5px; color: var(--fg2); margin-bottom: 6px; }
.lab.mt { margin-top: 18px; }
.row-inline { display: flex; gap: 8px; align-items: center; }
.row-inline input { flex: 1; }
.row-inline .grow { flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .on { background: var(--acc); color: #fff; border-color: transparent; }
</style>
