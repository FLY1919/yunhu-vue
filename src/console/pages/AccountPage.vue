<script setup lang="ts">
/** 账号页（含原「设置」板块内容：账号信息/个人资料，设置板块已并入此处） */
import { inject, computed, ref, onMounted } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import SettingsFrag from './SettingsPage.vue'
import DownloadSettings from '../../components/DownloadSettings.vue'
import NotificationSettings from '../../components/NotificationSettings.vue'
import Icon from '../components/Icon.vue'
import SavedAccounts from '../../components/SavedAccounts.vue'
import AutoLockSettings from '../../components/AutoLockSettings.vue'
import Login from '../../components/Login.vue'
import { resourceMode, setResourceMode } from '../../core/resource-mode'
import { resUrl } from '../../core/res.js'
import { fallbackAvatar } from '../../core/util.js'

const ctx = inject<any>('ctx')
const props = withDefaults(defineProps<{ section?: string }>(), { section: 'account' })
const adding = ref(false)
const loginEmail = ref('')
const auth = ctx.auth
const api = ctx.api
const ws = ctx.ws
const ui = ctx.ui
const chat = ctx.chat

const user = computed(() => auth.state.user || {})
const wsText = computed(() => ({
  online: '实时在线', connecting: '连接中', retry: '重连中', closed: '已断开', idle: '未连接',
}[ws?.state.status] || '—'))

/* 在线设备与金币明细（审计补齐的两个云端接口） */
const devices = ref<any[] | null>(null)
const coins = ref<any[]>([])
async function loadDevices() {
  try { devices.value = (await api.userClients?.()) || [] } catch { devices.value = [] }
}
async function loadCoins() {
  try { coins.value = (await api.coinRecords?.()) || [] } catch { coins.value = [] }
}
onMounted(() => {
  if (props.section === 'account') { loadDevices(); loadCoins() }
})
</script>

<template>
  <KLayout ns="account" :title="({ security: '安全', general: '常规', account: '账号与登录', profile: '个人资料', notifications: '通知', chats: '聊天与消息', connection: '连接', appearance: '外观', about: '关于' } as any)[section] || '设置'">
    <KCard v-if="section === 'account' || section === 'general'" data-setting-id="current-account">
      <div class="account">
        <img :src="user.avatar ? resUrl(user.avatar) : fallbackAvatar(user.name)"
             @error="(e: any) => (e.target.src = fallbackAvatar(user.name))" alt="" />
        <div class="acc-main">
          <div class="acc-name">{{ user.name }} <em v-if="user.vip">VIP</em></div>
          <div class="dim small">ID {{ user.id }} · <Icon name="coin" :size="14" class="inline-icon" role="img" aria-label="金币" /> {{ Math.round(user.coin || 0) }}</div>
          <div class="dim small">{{ user.email }}</div>
        </div>
        <button class="ghost" @click="auth.logout()">退出登录</button>
      </div>
    </KCard>

    <KCard v-if="section === 'account'" title="本地已保存账号" class="mt" data-setting-id="saved-accounts">
      <SavedAccounts @reauth="loginEmail = $event; adding = true" />
      <button class="ghost small mt-sm" @click="loginEmail = ''; adding = !adding"><Icon name="plus" :size="15" /> 添加账号</button>
      <Transition name="settings-fade"><Login v-if="adding" :key="loginEmail" embedded :initial-email="loginEmail" class="mt" @cancel="adding = false" @done="adding = false" /></Transition>
    </KCard>

    <KCard v-if="section === 'general'" title="常用设置" class="mt" data-setting-id="general">
      <label class="kv" data-setting-id="resource-mode"><span>节省资源（推荐）</span><input type="checkbox" :checked="resourceMode.economy" @change="setResourceMode(($event.target as HTMLInputElement).checked)" /></label><p class="dim small">图片按可见范围加载，动图悬停播放；后台释放媒体、减少缓存、背景模糊和重复渲染。优先降低内存与 CPU / GPU 占用。</p>
      <p class="dim">从左侧选择分类，或搜索功能名称直接定位设置。</p>
      <div class="kv"><span class="k">客户端版本</span><span>YH LaoDa {{ ctx.app?.version }}</span></div>
      <div class="kv"><span class="k">外观模式</span><button class="ghost small" @click="ui.toggleTheme()">{{ ui.effectiveTheme === 'dark' ? '深色' : '浅色' }} · 切换</button></div>
      <p class="dim small">免打扰会话仍显示未读角标；阅读会话后清除。</p>
    </KCard>

    <KCard v-if="ctx.lock && section === 'security'" title="安全与锁定" class="mt" data-setting-id="auto-lock"><AutoLockSettings /></KCard>
    <KCard v-if="section === 'connection'" title="连接状态" data-setting-id="connection">
      <div class="kv"><span class="k">API 基址</span><code>{{ api.base }}</code></div>
      <div class="kv">
        <span class="k">WebSocket</span>
        <span>
          <span class="dot" :class="ws?.state.status === 'online' ? 'on' : 'wait'"></span>
          {{ wsText }}
          <code class="dim">{{ ws?.state.url || '—' }}</code>
        </span>
      </div>
      <div class="kv" v-if="ws?.state.error"><span class="k">最近错误</span><span class="err">{{ ws.state.error }}</span></div>
      <button class="ghost small mt-sm" @click="ws?.reconnect()">重新连接</button>
    </KCard>

    <!-- 在线设备（/v1/user/clients，审计补齐） -->
    <KCard v-if="section === 'account'" title="在线设备" class="mt" data-setting-id="devices">
      <div v-if="devices === null" class="dim small">加载中…</div>
      <div v-else-if="!devices.length" class="dim small">暂无设备信息</div>
      <div v-for="d in devices" :key="d.deviceId" class="kv">
        <span class="k">{{ d.platform || '设备' }}</span>
        <span>
          <span class="dot" :class="d.online ? 'on' : 'wait'"></span>
          {{ d.deviceId }}
        </span>
      </div>
      <button class="ghost small mt-sm" @click="loadDevices">刷新</button>
    </KCard>

    <!-- 金币明细（/v1/user/gold-coin-increase-decrease-record） -->
    <KCard v-if="section === 'account'" title="金币明细" class="mt" data-setting-id="coins">
      <div v-if="!coins.length" class="dim small">暂无收支记录</div>
      <div v-for="(c, i) in coins" :key="i" class="kv">
        <span class="k">{{ c.remark || c.type || '变动' }}</span>
        <span :class="(c.num ?? c.amount ?? 0) >= 0 ? 'ok' : 'err'">
          {{ (c.num ?? c.amount ?? 0) >= 0 ? '+' : '' }}{{ c.num ?? c.amount ?? 0 }}
        </span>
      </div>
    </KCard>

    <KCard v-if="section === 'general'" title="下载目录" data-setting-id="downloads">
      <DownloadSettings />
    </KCard>

    <KCard v-if="section === 'notifications'" title="消息通知" data-setting-id="notifications">
      <NotificationSettings />
    </KCard>

    <KCard v-if="section === 'chats'" title="会话列表" data-setting-id="conversation-list">
      <div class="kv">
        <label class="k" for="conversation-pin-mode">置顶会话方式</label>
        <select id="conversation-pin-mode" :value="chat.groups.pinMode"
                @change="chat.setPinMode(($event.target as HTMLSelectElement).value)">
          <option value="tabs">双 Tab：未置顶对话 / 置顶对话</option>
          <option value="top">置顶对话在前</option>
        </select>
      </div>
      <p class="dim small">即时生效并自动保存。搜索会显示两个列表中的全部匹配会话。</p>
    </KCard>

    <KCard v-if="section === 'chats'" title="消息保留" class="mt" data-setting-id="anti-recall">
      <div class="kv">
        <label for="anti-recall">反撤回（测试）</label>
        <input id="anti-recall" type="checkbox" :checked="chat.preferences.antiRecall"
          @change="chat.setAntiRecall(($event.target as HTMLInputElement).checked)" />
        <button class="ghost small" @click="chat.clearRecallCache(); ui.toast('反撤回缓存已清空', 'success')">清空缓存</button>
      </div>
      <p class="dim small">开启后保留本机收到的消息，撤回时显示已保存的正文和“已撤回 · 本地保留”；没有匹配缓存的撤回消息不显示。仅保存开启期间收到的内容，最多 2000 条、7 天，退出账号时清除缓存。</p>
    </KCard>

    <KCard v-if="section === 'chats'" title="图片与表情" class="mt" data-setting-id="image-editor">
      <p class="dim small">Ctrl + 左键点击表情消息可打开图片查看器；普通点击仍打开所属表情包。</p>
      <p class="dim small">查看图片时点击“编辑图片”可裁剪、旋转、调色并保存副本。</p>
    </KCard>

    <KCard v-if="section === 'appearance'" title="外观" data-setting-id="theme">
      <div class="kv">
        <span class="k">主题</span>
        <button class="ghost small" @click="ui.toggleTheme()">
          {{ ui.state.theme === 'dark' ? '深色 → 浅色' : '浅色 → 深色' }}
        </button>
      </div>
    </KCard>

    <KCard v-if="section === 'about'" title="关于 YH LaoDa" data-setting-id="about">
      <p class="dim small">
        云湖牢大版 · {{ ctx.app?.version }}<br />
        云湖第三方客户端，仅供学习交流。<br />
        图片编辑使用 @jodit/image-editor（MIT）的图像处理内核，界面与文件操作由 YH LaoDa 提供。
      </p>
    </KCard>

    <!-- 原「设置」板块并入账号页（账号信息 / 个人资料可改） -->
    <SettingsFrag v-if="section === 'profile' || section === 'account'" :section="section" class="mt" />
  </KLayout>
</template>

<style scoped>
.account { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.account img { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; }
.acc-main { flex: 1; min-width: 150px; }
.acc-name { font-size: 17px; font-weight: 600; }
.acc-name em { font-size: 11px; margin-left: 6px; }
.kv { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 0; }
.kv .k { min-width: 84px; color: var(--fg2); }
.kv code { overflow-wrap: anywhere; }
</style>
