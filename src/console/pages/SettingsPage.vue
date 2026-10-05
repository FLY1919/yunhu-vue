<script setup lang="ts">
/**
 * 设置页
 * ------------------------------------------------------------------
 * 三个区块：
 *   ① 账号信息 —— token / 金币 / VIP / 邀请码 / 注册时间 / 在线天数 / 勋章 / IP 归属地
 *   ② 个人资料 —— 昵称、头像、简介、性别、生日、省市区、邮编（全部可改）
 *   ③ 群设置   —— 我的群昵称、消息类型限制、群标签
 *
 * 接口备忘（踩过的坑，别改回去）：
 *   · EditNicknameRequest{ name = 3 }        ← 字段是 3，不是 1
 *   · EditAvatarRequest{ url = 2 }           ← 字段 2，且必须传完整 URL
 *   · /v1/user/get-user-data 返回 data.data  ← 双层嵌套
 *   · /v1/user/save-user-data 是扁平字段
 */
import { inject, ref, computed, onMounted } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res'
import { fallbackAvatar, fmtTime } from '../../core/util'

const ctx = inject<any>('ctx')
const api = ctx.api
const chat = ctx.chat
const auth = ctx.auth
const ui = ctx.ui

const busy = ref(false)

/* ============ 账号信息 ============ */
const stats = ref<any>({})          // /v1/user/get-user 的结果
const meInfo = ref<any>({})         // /v1/user/info 的结果
const showToken = ref(false)

/* ============ 个人资料 ============ */
const profile = ref<any>({
  introduction: '', gender: 3, birthday: 0,
  province: '', city: '', district: '', locationCode: '',
})
const newName = ref('')
/** 时间戳 <-> yyyy-MM-dd */
const birthdayStr = computed({
  get: () => (profile.value.birthday ? new Date(profile.value.birthday * 1000).toISOString().slice(0, 10) : ''),
  set: (v: string) => {
    profile.value.birthday = v ? Math.floor(new Date(v + 'T00:00:00').getTime() / 1000) : 0
  },
})

async function loadAll() {
  // 自身信息（金币 / VIP / 邀请码）
  try { meInfo.value = await api.self() } catch { /* 忽略 */ }
  // 扩展信息（注册时间 / 在线天数 / 勋章 / IP 归属地）
  try { stats.value = await api.getUser(auth.state.user?.id || meInfo.value.id) } catch { /* 忽略 */ }
  // 个人资料
  try {
    const p = await api.getMyProfile()
    profile.value = {
      introduction: p.introduction ?? '',
      gender: p.gender ?? 3,
      birthday: p.birthday ?? 0,
      province: p.province ?? '',
      city: p.city ?? '',
      district: p.district ?? '',
      locationCode: p.locationCode ?? '',
    }
  } catch { /* 忽略 */ }
  newName.value = auth.state.user?.name || ''
}

/* ============ 个人资料操作（每个都单独可测） ============ */

/** 改昵称 */
async function saveName() {
  const v = newName.value.trim()
  if (!v) return ui.toast('昵称不能为空', 'warn')
  busy.value = true
  try {
    await api.editNickname(v)
    auth.state.user.name = v
    ui.toast('昵称已更新为 ' + v, 'success')
  } catch (e: any) { ui.toast('改昵称失败：' + e.message, 'error') }
  finally { busy.value = false }
}

/** 上传头像并应用（必须传完整 URL） */
const avatarInput = ref<HTMLInputElement | null>(null)
async function onAvatar(e: any) {
  const f: File | undefined = e.target?.files?.[0]
  if (e.target) e.target.value = ''
  if (!f) return
  busy.value = true
  try {
    const { url } = await api.uploadAndUrl(f, 'image')
    await api.editAvatar(url)
    auth.state.user.avatar = url
    ui.toast('头像已更新', 'success')
  } catch (err: any) { ui.toast('改头像失败：' + err.message, 'error') }
  finally { busy.value = false }
}

/** 保存资料（简介/性别/生日/所在地） */
async function saveProfile() {
  busy.value = true
  try {
    await api.saveMyProfile(profile.value)
    ui.toast('个人资料已保存', 'success')
  } catch (e: any) { ui.toast('保存资料失败：' + e.message, 'error') }
  finally { busy.value = false }
}

/** 复制文本（非安全上下文没有 clipboard，退化到 prompt） */
async function copy(text: string, label = '') {
  try { await navigator.clipboard.writeText(text); ui.toast(`已复制${label}`, 'success') }
  catch { window.prompt(`复制${label}：`, text) }
}

onMounted(loadAll)
ctx.on('chat/open', loadAll)
</script>

<template>
  <KLayout title="设置" desc="账号信息 · 个人资料 · 群设置">
    <template #actions>
      <span class="pill">{{ cur?.name || '未选择会话' }}</span>
      <button class="ghost small" @click="loadAll">刷新</button>
    </template>

    <!-- ============ ① 账号信息 ============ -->
    <KCard title="账号信息">
      <div class="account">
        <img :src="auth.state.user?.avatar ? resUrl(auth.state.user.avatar) : fallbackAvatar(auth.state.user?.name)"
             @error="(e: any) => (e.target.src = fallbackAvatar(auth.state.user?.name))" alt="" />
        <div class="acc-main">
          <div class="acc-name">
            {{ auth.state.user?.name }}
            <em v-if="meInfo.vip || stats.isVip" class="vip">VIP</em>
            <em v-if="stats.banId" class="ban">封禁中</em>
          </div>
          <div class="dim small">ID {{ auth.state.user?.id }} · {{ auth.state.user?.email }}</div>
        </div>
        <button class="ghost small" @click="copy(String(auth.state.user?.id), '用户 ID')">复制 ID</button>
      </div>

      <div class="grid mt-sm">
        <div class="kv"><span class="k">金币</span><b>🪙 {{ meInfo.coin ?? 0 }}</b></div>
        <div class="kv"><span class="k">邀请码</span><span>{{ meInfo.invitationCode || '—' }}</span></div>
        <div class="kv"><span class="k">注册时间</span><span>{{ stats.registerTime || '—' }}</span></div>
        <div class="kv"><span class="k">在线天数</span><span>{{ stats.onlineDay ?? '—' }} 天（连续 {{ stats.continuousOnlineDay ?? '—' }}）</span></div>
        <div class="kv"><span class="k">勋章</span><span>{{ stats.medalCount ?? 0 }} 枚</span></div>
        <div class="kv"><span class="k">IP 归属地</span><span>{{ stats.ipGeo || '—' }}</span></div>
        <div class="kv"><span class="k">VIP 到期</span><span>{{ stats.vipExpired ? fmtTime(stats.vipExpired) : '—' }}</span></div>
        <div class="kv"><span class="k">名称/头像 ID</span><span>{{ stats.nameId ?? '—' }} / {{ stats.avatarId ?? '—' }}</span></div>
      </div>

      <div class="kv mt-sm token-row">
        <span class="k">Token</span>
        <code class="token">{{ showToken ? api.token : (api.token ? api.token.slice(0, 8) + '••••••••••••••••••••••••••' : '—') }}</code>
        <button class="ghost small" @click="showToken = !showToken">{{ showToken ? '隐藏' : '显示' }}</button>
        <button class="ghost small" @click="copy(api.token, ' Token')">复制</button>
      </div>
      <p class="dim small mt-sm">Token 等同账号凭证，别外发；这里只存在浏览器 localStorage。</p>
    </KCard>

    <!-- ============ ② 个人资料 ============ -->
    <KCard title="个人资料" class="mt">
      <div class="account">
        <img :src="auth.state.user?.avatar ? resUrl(auth.state.user.avatar) : fallbackAvatar(auth.state.user?.name)"
             @error="(e: any) => (e.target.src = fallbackAvatar(auth.state.user?.name))" alt="" />
        <div class="acc-main dim small">头像会先上传到云湖数据床，再用完整 URL 调 /v1/user/edit-avatar</div>
        <button class="ghost small" :disabled="busy" @click="avatarInput?.click()">更换头像</button>
        <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatar" />
      </div>

      <div class="row-inline mt-sm">
        <span class="lab">昵称</span>
        <input v-model="newName" placeholder="修改昵称" />
        <button :disabled="busy" @click="saveName">保存昵称</button>
      </div>

      <div class="row-inline mt-sm">
        <span class="lab">性别</span>
        <div class="chips">
          <button v-for="g in GENDERS" :key="g.v" class="ghost small"
                  :class="{ on: profile.gender === g.v }" @click="profile.gender = g.v">{{ g.n }}</button>
        </div>
      </div>

      <div class="row-inline mt-sm">
        <span class="lab">生日</span>
        <input type="date" v-model="birthdayStr" />
        <span class="dim small">{{ profile.birthday ? '时间戳 ' + profile.birthday : '未设置' }}</span>
      </div>

      <div class="row-inline mt-sm">
        <span class="lab">所在地</span>
        <input v-model="profile.province" placeholder="省 如 湖北省" />
        <input v-model="profile.city" placeholder="市" />
        <input v-model="profile.district" placeholder="区/县" />
      </div>
      <div class="row-inline mt-sm">
        <span class="lab">邮编</span>
        <input v-model="profile.locationCode" placeholder="如 421171" />
      </div>

      <div class="mt-sm">
        <span class="lab">简介</span>
        <textarea v-model="profile.introduction" rows="3" placeholder="介绍一下自己…"></textarea>
      </div>

      <div class="row-inline mt-sm">
        <span class="grow"></span>
        <button :disabled="busy" @click="saveProfile">保存个人资料</button>
      </div>
    </KCard>

    <p class="dim small mt">群相关设置已移到「聊天 → 右上角 ⋮ → 群设置 / 成员 / 群标签」里。</p>

  </KLayout>
</template>

<style scoped>
.row-inline { display: flex; gap: 8px; align-items: center; }
.row-inline input { flex: 1; min-width: 0; }
.row-inline .grow { flex: 1; }
.lab { flex: 0 0 52px; font-size: 12.5px; color: var(--fg2); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 2px 18px; }
.kv { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; align-items: baseline; }
.kv .k { flex: 0 0 78px; color: var(--fg2); font-size: 12.5px; }
.token-row { flex-wrap: wrap; }
.token {
  flex: 1; min-width: 200px; background: var(--card2); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 8px; font-size: 12px; word-break: break-all;
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .on { background: var(--acc); color: #fff; border-color: transparent; }
.color { width: 40px; height: 34px; padding: 2px; flex: 0 0 auto; }
.dotc { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.account { display: flex; align-items: center; gap: 12px; }
.account img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.acc-main { flex: 1; min-width: 0; }
.acc-name { font-weight: 600; font-size: 15px; }
.acc-name em { font-style: normal; font-size: 11px; border-radius: 5px; padding: 1px 6px; margin-left: 6px; }
.acc-name em.vip { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
.acc-name em.ban { color: var(--err); background: color-mix(in srgb, var(--err) 18%, transparent); }
textarea { width: 100%; margin-top: 4px; resize: vertical; }
</style>
