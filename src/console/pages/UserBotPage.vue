<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import { ACTION_TYPES } from '../../userbot/actions'
import { PERSONA_PRESETS } from '../../userbot/persona-presets'
import { composePrompt, managesGroup, usesAI, keyOf, memoryKey, newBot, newPersona, newService } from '../../plugins/userbot'

const ctx = inject<any>('ctx'), ub = ctx.userbot, s = ub.state
const selected = ref(s.openSection || 'bots'), query = ref(''), content = ref<HTMLElement | null>(null)
const selectedBot = ref(''), selectedService = ref(''), selectedPersona = ref(''), selectedChannel = ref(s.selectedChannel || '')
const keyInput = ref(''), keyStatus = ref(''), operation = ref(''), modelChoices = ref<string[]>([]), preview = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const categories = [
  { id: 'bots', title: 'Bot 管理', icon: 'robot', keywords: '创建 启停 权限 访问 读取 发送 会话' },
  { id: 'services', title: 'AI 服务', icon: 'settings', keywords: 'API Key 密钥 地址 Base URL 格式 认证 OpenAI Anthropic 模型 连接 测试 超时 温度' },
  { id: 'personas', title: '人设卡', icon: 'user', keywords: '角色 背景 性格 风格 导入 导出 复制 删除 示例' },
  { id: 'conversations', title: '会话设置', icon: 'chat', keywords: '私聊 群聊 触发 提及 关键词 指令 自动回复 草稿 手动 上下文 Token 冷却 合并 备用服务 记忆 提示词' },
  { id: 'global', title: '全局提示词', icon: 'page', keywords: '系统 提示词 全局 预览 原则' },
  { id: 'logs', title: '运行记录', icon: 'activity', keywords: '日志 触发 生成 发送 失败 token 日 周 月 用量 估算' },
]
const features = [
  { category: 'bots', title: '创建 Bot 与 AI 开关', anchor: 'bot-name', words: '管理 名称 启用 暂停 AI 自动化 规则 对话模式 管理模式' },
  { category: 'bots', title: 'Bot 读取和发送权限', anchor: 'bot-access', words: '授权 范围 会话 限制 自动发送' },
  { category: 'bots', title: 'AI 群管理与操作审核', anchor: 'bot-management', words: '管理员 群主 权限 禁言 踢人 撤回 添加 更改 群标签 群资料 群名称 简介 邀请 确认 弹窗 审核 自动 执行' },
  { category: 'bots', title: 'Bot 默认服务与人设', anchor: 'bot-default', words: '模型 人设 服务' },
  { category: 'services', title: '接口格式', anchor: 'service-format', words: 'OpenAI Anthropic Chat Completions Responses Messages 格式' },
  { category: 'services', title: 'Base URL 和 API Key', anchor: 'service-url', words: '服务 地址 密钥 key 认证 安全存储' },
  { category: 'services', title: '模型列表和连接测试', anchor: 'service-model', words: '模型 model 检查 请求 测试 默认服务' },
  { category: 'services', title: '生成参数和超时', anchor: 'service-parameters', words: '温度 temperature 最大输出 max tokens 超时 timeout' },
  { category: 'personas', title: '预设人设卡', anchor: 'persona-presets', words: '预设 模板 温柔搭子 元气朋友 嘴硬心软 理性学长 学习教练 代码助手 一键 添加' },
  { category: 'personas', title: '创建、复制、导入和导出人设卡', anchor: 'persona-detail', words: '角色 性格 背景 风格 关系 边界 示例 头像' },
  { category: 'conversations', title: '会话 Bot 和访问授权', anchor: 'conversation-bot', words: '私聊 群聊 允许 访问 权限 AI 开关 自动化 规则 固定回复 禁言 撤回 对话模式 管理模式' },
  { category: 'conversations', title: '回复模式与消息格式', anchor: 'conversation-mode', words: '手动 草稿 自动回复 暂停 发送 文字 Markdown 自动 判断 格式' },
  { category: 'conversations', title: '会话人设、服务、模型与提示词', anchor: 'conversation-persona', words: '人设 服务 模型 覆盖 补充 提示词 全局 预览' },
  { category: 'conversations', title: '触发方式', anchor: 'conversation-trigger', words: '收到消息 提及 @ 关键词 指令' },
  { category: 'conversations', title: '上下文、Token、冷却和合并', anchor: 'conversation-context', words: '上下文 长度 条数 token 压缩 最近 冷却 时间 合并' },
  { category: 'conversations', title: '备用服务', anchor: 'conversation-fallback', words: '切换 隐私 故障 回退 服务商' },
  { category: 'conversations', title: 'AI 自动总结记忆', anchor: 'conversation-memory', words: '查看 编辑 清空 会话 人设 长期 记忆 自动 总结 压缩 阈值 百分比 占用 Token' },
  { category: 'global', title: '全局系统提示词', anchor: 'global-prompt', words: '全局 系统 提示 原则' },
  { category: 'logs', title: '运行记录与 Token 用量', anchor: 'usage', words: '日志 失败 状态 日 周 月 总计 估算 消耗' },
]
const results = computed(() => {
  const terms = query.value.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return terms.length ? features.filter(x => {
    const text = `${x.title} ${x.words} ${categories.find(c => c.id === x.category)?.title}`.normalize('NFKC').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  }) : []
})
async function choose(id: string, anchor = '') {
  selected.value = id; s.openSection = id; query.value = ''; await nextTick(); content.value?.scrollTo({ top: 0 })
  if (anchor) {
    const el = content.value?.querySelector<HTMLElement>(`[data-setting-id="${anchor}"]`)
    if (el) { for (let parent = el.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 2200) }
  }
}
watch(() => s.openSection, (v: string) => { if (v) selected.value = v })
watch(() => s.selectedChannel, (v: string) => { if (v) selectedChannel.value = v })
const bot = computed(() => s.config.bots.find((x: any) => x.id === selectedBot.value))
const service = computed(() => s.config.services.find((x: any) => x.id === selectedService.value))
const persona = computed(() => s.config.personas.find((x: any) => x.id === selectedPersona.value))
const conversations = computed(() => ctx.chat.state.conversations || [])
const channel = computed(() => conversations.value.find((x: any) => keyOf(x) === selectedChannel.value))
const setting = computed(() => selectedChannel.value && s.config.conversations[selectedChannel.value])
const chosenBot = computed(() => s.config.bots.find((x: any) => x.id === setting.value?.botId))
const chosenPersona = computed(() => s.config.personas.find((x: any) => x.id === (setting.value?.personaId || chosenBot.value?.personaId)))
const memoryId = computed(() => memoryKey(selectedChannel.value, chosenPersona.value?.id || ''))
const useAI = computed(() => chosenBot.value && setting.value && usesAI(chosenBot.value, setting.value))
const prompt = computed(() => setting.value ? composePrompt(s.config, { ...setting.value, workMode: chosenBot.value && managesGroup(chosenBot.value, setting.value) ? 'management' : 'conversation' }, chosenPersona.value, selectedChannel.value) : '')
watch(conversations, (items: any[]) => { if (!selectedChannel.value && items.length) selectedChannel.value = keyOf(items[0]) }, { immediate: true })
watch([selectedChannel, () => s.ready], () => { if (s.ready && channel.value) ub.settings(channel.value) }, { immediate: true })
watch(() => s.config.bots.length, () => { if (!bot.value) selectedBot.value = s.config.bots[0]?.id || '' }, { immediate: true })
watch(() => s.config.services.length, () => { if (!service.value) selectedService.value = s.config.services[0]?.id || '' }, { immediate: true })
watch(() => s.config.personas.length, () => { if (!persona.value) selectedPersona.value = s.config.personas[0]?.id || '' }, { immediate: true })
watch(selectedService, async (id) => {
  keyInput.value = ''; modelChoices.value = []; keyStatus.value = ''
  if (!id) return
  try { const present = !!(await ub.getKey(id)); if (selectedService.value === id) keyStatus.value = present ? '已安全保存' : '尚未设置（可留空用于无需密钥的本地服务）' }
  catch (e: any) { if (selectedService.value === id) keyStatus.value = e.message }
}, { immediate: true })
function quickSetup() {
  if (!channel.value || !setting.value) return
  let b = chosenBot.value || s.config.bots[0]
  if (!b) { b = newBot(); b.name = '我的 Bot'; s.config.bots.push(b) }
  b.enabled = true; b.canRead = true
  b.allowed = [...new Set([...b.allowed, selectedChannel.value])]
  setting.value.botId = b.id; setting.value.mode = 'draft'
  ctx.ui.toast('已启用当前会话的自动草稿；选择自动发送后，记得开启发送权限', 'success')
}
function addBot() { const x = newBot(); s.config.bots.push(x); selectedBot.value = x.id }
function addService() { const x = newService(); s.config.services.push(x); selectedService.value = x.id; if (!s.config.defaultServiceId) s.config.defaultServiceId = x.id }
function addPreset(preset: typeof PERSONA_PRESETS[number]) {
  const x = { ...newPersona(), ...preset }
  s.config.personas.push(x); selectedPersona.value = x.id
  ctx.ui.toast(`已添加“${x.name}”，可继续编辑或分配给会话`, 'success')
}
function addPersona() { const x = newPersona(); s.config.personas.push(x); selectedPersona.value = x.id }
async function remove(type: 'bots' | 'services' | 'personas', id: string) {
  const ok = await ctx.ui.confirm('确认删除', '删除后相关会话需要重新选择，是否继续？', { okText: '删除', cancelText: '取消' })
  if (!ok) return
  if (type === 'services') { try { await ub.setKey(id, '') } catch (e: any) { ctx.ui.toast('无法删除密钥：' + e.message, 'error'); return } }
  s.config[type] = s.config[type].filter((x: any) => x.id !== id)
}
function copyPersona() { if (!persona.value) return; const x = { ...JSON.parse(JSON.stringify(persona.value)), id: crypto.randomUUID(), name: persona.value.name + '（副本）' }; s.config.personas.push(x); selectedPersona.value = x.id }
function exportPersona() {
  if (!persona.value) return
  const { name, avatar, description, background, personality, style, relationship, boundaries, examples, extra } = persona.value
  const blob = new Blob([JSON.stringify({ format: 'yh-persona', version: 1, persona: { name, avatar, description, background, personality, style, relationship, boundaries, examples, extra } }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = (name.replace(/[\\/:*?"<>|]/g, '_') || 'persona') + '.json'; a.click(); URL.revokeObjectURL(url)
}
async function importPersona(e: Event) {
  const el = e.target as HTMLInputElement, file = el.files?.[0]; el.value = ''
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('文件不能超过 1 MB')
    const data = JSON.parse(await file.text()); if (data.format !== 'yh-persona' || data.version !== 1 || !data.persona || typeof data.persona !== 'object') throw new Error('目前支持本软件导出的人设卡格式')
    const next = newPersona()
    for (const k of ['name', 'avatar', 'description', 'background', 'personality', 'style', 'relationship', 'boundaries', 'examples', 'extra'] as const) if (typeof data.persona[k] === 'string') next[k] = data.persona[k].slice(0, 20000)
    s.config.personas.push(next); selectedPersona.value = next.id; ctx.ui.toast('人设卡已导入', 'success')
  } catch (err: any) { ctx.ui.toast('导入失败：' + err.message, 'error') }
}
async function saveKey(clear = false) {
  if (!clear && !keyInput.value) { ctx.ui.toast('请先输入密钥，或选择清除密钥', 'warn'); return }
  try { await ub.setKey(service.value.id, clear ? '' : keyInput.value); keyInput.value = ''; keyStatus.value = clear ? '已清除' : '已安全保存'; ctx.ui.toast(clear ? '已清除密钥' : '密钥已保存', 'success') }
  catch (e: any) { ctx.ui.toast('保存失败：' + e.message, 'error') }
}
async function runService(kind: 'models' | 'test') {
  if (!service.value || operation.value) return
  operation.value = kind
  try {
    if (kind === 'models') { modelChoices.value = await ub.fetchModels(service.value); ctx.ui.toast(modelChoices.value.length ? `找到 ${modelChoices.value.length} 个模型` : '未返回模型，可手动输入', 'info') }
    else { const result = await ub.testService(service.value); ctx.ui.toast('连接成功：' + result.text.slice(0, 80), 'success') }
  } catch (e: any) { ctx.ui.toast((kind === 'models' ? '获取模型失败：' : '连接测试失败：') + e.message, 'error', 7000) }
  finally { operation.value = '' }
}
function allowCurrent(checked: boolean) {
  if (!chosenBot.value) return
  const list: string[] = chosenBot.value.allowed || (chosenBot.value.allowed = []), k = selectedChannel.value
  chosenBot.value.allowed = checked ? [...new Set([...list, k])] : list.filter(x => x !== k)
}
function clearPersonaMemory() {
  const id = chosenPersona.value?.id || 'default'
  for (const k of new Set([...Object.keys(s.config.memories), ...Object.keys(s.config.memoryCursors)])) { try { if (JSON.parse(k)[1] === id) { delete s.config.memories[k]; delete s.config.memoryCursors[k] } } catch {} }
}
const usage = computed(() => {
  const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const week = day - ((now.getDay() + 6) % 7) * 86400000, month = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return [{ name: '今日', since: day }, { name: '本周', since: week }, { name: '本月', since: month }, { name: '总计', since: 0 }].map(x => {
    const rows = Object.entries(s.usageDays).filter(([date]) => new Date(date + 'T00:00:00').getTime() >= x.since).map(([, value]) => value as any)
    return { ...x, total: rows.reduce((n: number, r: any) => n + r.total, 0), estimated: rows.some((r: any) => r.estimated) }
  })
})
</script>

<template>
  <div class="bot-shell">
    <aside class="bot-sidebar">
      <div class="title"><h1>用户 Bot</h1><small>设置与管理</small></div>
      <label class="search"><Icon name="search" :size="17" /><input v-model="query" placeholder="搜索设置与功能" aria-label="搜索用户 Bot 设置" /><button v-if="query" class="plain" @click="query = ''">×</button></label>
      <nav aria-label="用户 Bot 设置分类"><button v-for="c in categories" :key="c.id" :class="{ active: selected === c.id && !query }" @click="choose(c.id)"><Icon :name="c.icon" :size="18" />{{ c.title }}</button></nav>
    </aside>
    <main ref="content" class="bot-main">
      <div v-if="!s.ready" class="notice"><template v-if="s.loadError">设置加载失败：{{ s.loadError }} <button @click="ub.reload()">重试</button></template><template v-else>请先登录账号，正在加载设置。</template></div>
      <template v-else-if="query.trim()">
        <h2>搜索结果 <small>{{ results.length }}</small></h2><p class="muted">选择结果前往对应设置。</p>
        <button v-for="r in results" :key="r.anchor" class="result" @click="choose(r.category, r.anchor)"><Icon :name="categories.find(c => c.id === r.category)?.icon" :size="20" /><span><strong>{{ r.title }}</strong><small>{{ categories.find(c => c.id === r.category)?.title }} · {{ r.words }}</small></span><Icon name="forward" :size="16" /></button>
        <p v-if="!results.length" class="muted">没有找到相关设置，试试“模型”“人设”或“自动回复”。</p>
      </template>
      <template v-else-if="selected === 'bots'">
        <div class="heading"><div><h2>Bot 管理</h2><p>一个 Bot 可以管理多个授权会话，并为每个会话使用不同人设。</p></div><button class="primary" @click="addBot">创建 Bot</button></div>
        <div class="split"><div class="list"><button v-for="b in s.config.bots" :key="b.id" :class="{ active: selectedBot === b.id }" @click="selectedBot = b.id"><strong>{{ b.name }}</strong><small>{{ b.enabled ? '已启用' : '已暂停' }} · {{ b.allowed.length }} 个会话</small></button><p v-if="!s.config.bots.length" class="muted">还没有 Bot。</p></div>
          <div v-if="bot" class="card fields"><label data-setting-id="bot-name">Bot 名称<input v-model="bot.name" maxlength="80" /></label>
            <label class="check"><input type="checkbox" v-model="bot.enabled" />启用此 Bot</label>
            <label class="check"><input type="checkbox" v-model="bot.useAI" />此 Bot 使用 AI</label>
            <p class="muted">关闭后不需要模型或 API Key，直接使用会话中的自动化规则；会话也可单独关闭 AI。</p>
            <label>默认工作模式<select v-model="bot.workMode" @change="bot.workMode === 'management' && (bot.management.enabled = true)"><option value="conversation">对话模式（仅回复）</option><option value="management">管理模式（可执行已授权操作）</option></select></label>
            <label class="check" data-setting-id="bot-access"><input type="checkbox" v-model="bot.canRead" />允许读取授权会话的消息</label>
            <label class="check"><input type="checkbox" v-model="bot.canSend" />允许自动发送文字 / Markdown 消息</label>
            <p class="muted">实际触发还需要在会话设置中选择模式并明确授权；默认不会自动发送。</p>
            <div class="management-section" data-setting-id="bot-management">
              <h3>群管理权限</h3>
              <label class="check"><input type="checkbox" v-model="bot.management.enabled" />允许此 Bot 提出并执行群管理操作</label>
              <p class="muted">仅对已授权群聊生效，当前账号必须是该群管理员或群主。群消息类型权限仅群主可改；执行前会重新校验。</p>
              <template v-if="bot.management.enabled">
                <label class="check"><input type="checkbox" v-model="bot.management.requireConfirmation" />操作执行前弹窗确认（默认开启）</label>
                <p class="muted">{{ bot.management.requireConfirmation ? 'AI 提出操作后，核对群聊、目标、修改内容与理由；确认后才执行。取消或超时均不执行。' : '已关闭操作审核：AI 可直接执行下方勾选的操作，仍受账号权限和会话授权限制。' }}</p>
                <div class="management-options"><label v-for="a in ACTION_TYPES" :key="a.id" class="check"><input type="checkbox" v-model="bot.management.allowed" :value="a.id" />{{ a.label }}</label></div>
              </template>
            </div>
            <label v-if="bot.useAI" data-setting-id="bot-default">默认 AI 服务<select v-model="bot.serviceId"><option value="">使用全局默认服务</option><option v-for="x in s.config.services" :key="x.id" :value="x.id">{{ x.name }}</option></select></label>
            <label v-if="bot.useAI">默认人设卡<select v-model="bot.personaId"><option value="">不使用人设卡</option><option v-for="x in s.config.personas" :key="x.id" :value="x.id">{{ x.name }}</option></select></label>
            <p>已授权会话：{{ bot.allowed.length }} 个。前往“会话设置”添加或移除。</p><button class="danger" @click="remove('bots', bot.id)">删除 Bot</button></div>
          <div v-else class="empty">创建一个 Bot 开始配置。</div></div>
      </template>
      <template v-else-if="selected === 'services'">
        <div class="heading"><div><h2>AI 服务</h2><p>配置自己的服务；API Key 使用 Windows 当前用户的安全存储。</p></div><button class="primary" @click="addService">添加服务</button></div>
        <div class="split"><div class="list"><button v-for="x in s.config.services" :key="x.id" :class="{ active: selectedService === x.id }" @click="selectedService = x.id"><strong>{{ x.name }}</strong><small>{{ x.format }}{{ s.config.defaultServiceId === x.id ? ' · 默认' : '' }}</small></button></div>
          <div v-if="service" class="card fields">
            <label>服务名称<input v-model="service.name" /></label>
            <label data-setting-id="service-format">接口格式<select v-model="service.format"><option value="chat">OpenAI · Chat Completions</option><option value="responses">OpenAI · Responses</option><option value="anthropic">Anthropic · Messages</option></select></label>
            <label data-setting-id="service-url">Base URL<input v-model.trim="service.baseUrl" placeholder="https://api.openai.com/v1" spellcheck="false" /></label><p class="muted">填写接口根地址，例如 https://api.anthropic.com/v1。使用 HTTP 时内容和密钥可能被网络读取。</p>
            <label>API Key<input v-model="keyInput" type="password" autocomplete="new-password" placeholder="输入新密钥后点击保存" /></label><div class="actions"><button @click="saveKey()">保存密钥</button><button @click="saveKey(true)">清除密钥</button><small>{{ keyStatus }}</small></div>
            <label>认证方式<select v-model="service.authMode"><option value="default">按接口格式自动选择</option><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option><option value="api-key">api-key</option><option value="none">不发送密钥</option></select></label>
            <label data-setting-id="service-model">模型<input v-model.trim="service.model" list="userbot-models" placeholder="手动输入模型名" /><datalist id="userbot-models"><option v-for="m in modelChoices" :key="m" :value="m" /></datalist></label>
            <div class="actions"><button :disabled="!!operation" @click="runService('models')">{{ operation === 'models' ? '获取中…' : '获取模型列表' }}</button><button :disabled="!!operation" @click="runService('test')">{{ operation === 'test' ? '测试中…' : '测试连接与模型' }}</button><button @click="s.config.defaultServiceId = service.id">{{ s.config.defaultServiceId === service.id ? '当前默认服务' : '设为默认服务' }}</button></div>
            <label v-if="service.format === 'anthropic'">Anthropic 版本<input v-model="service.anthropicVersion" placeholder="2023-06-01" /></label>
            <div class="cols" data-setting-id="service-parameters"><label>最大输出 Token<input v-model.number="service.maxTokens" type="number" min="1" max="128000" /></label><label>温度<input v-model.number="service.temperature" type="number" min="0" :max="service.format === 'anthropic' ? 1 : 2" step="0.1" /></label><label>请求超时（秒）<input v-model.number="service.timeoutSeconds" type="number" min="1" max="300" /></label></div>
            <label class="check"><input v-model="service.useMaxTokens" type="checkbox" :disabled="service.format === 'anthropic'" />发送最大输出参数（Anthropic 必需）</label><label class="check"><input v-model="service.useTemperature" type="checkbox" />发送温度参数</label>
            <button class="danger" @click="remove('services', service.id)">删除服务与密钥</button>
          </div><div v-else class="empty">添加服务后配置地址和模型。</div></div>
      </template>
      <template v-else-if="selected === 'personas'">
        <div class="heading"><div><h2>人设卡</h2><p>设定角色背景、语气与行为边界。</p></div><div class="actions"><button @click="importInput?.click()">导入</button><button class="primary" @click="addPersona">创建人设</button><input ref="importInput" type="file" accept="application/json,.json" hidden @change="importPersona" /></div></div>
        <details class="preset-gallery" data-setting-id="persona-presets" open>
          <summary>从预设开始 <small>添加后可以自由修改</small></summary>
          <div class="preset-grid"><button v-for="preset in PERSONA_PRESETS" :key="preset.name" :aria-label="'添加预设人设：' + preset.name" @click="addPreset(preset)"><strong>{{ preset.name }}</strong><small>{{ preset.description }}</small><span>添加人设 <Icon name="forward" :size="13" /></span></button></div>
        </details>
        <div class="split"><div class="list"><button v-for="x in s.config.personas" :key="x.id" :class="{ active: selectedPersona === x.id }" @click="selectedPersona = x.id"><strong>{{ x.name }}</strong><small>{{ x.description || '暂无简介' }}</small></button></div>
          <div v-if="persona" class="card fields" data-setting-id="persona-detail"><label>人设名称<input v-model="persona.name" /></label><label>头像 URL（仅管理界面）<input v-model="persona.avatar" /></label><img v-if="persona.avatar" class="persona-avatar" :src="persona.avatar" alt="人设头像预览" /><label>简介<input v-model="persona.description" /></label>
            <label>角色背景<textarea v-model="persona.background" rows="3" /></label><label>性格<textarea v-model="persona.personality" rows="2" /></label><label>说话风格<textarea v-model="persona.style" rows="2" /></label><label>与对方的关系<textarea v-model="persona.relationship" rows="2" /></label><label>行为边界<textarea v-model="persona.boundaries" rows="2" /></label><label>示例对话<textarea v-model="persona.examples" rows="3" /></label><label>附加提示词<textarea v-model="persona.extra" rows="3" /></label>
            <div class="actions"><button @click="copyPersona">复制</button><button @click="exportPersona">导出</button><button class="danger" @click="remove('personas', persona.id)">删除</button></div><p class="muted">导出只包含人设字段，不包含密钥或聊天记录。当前仅支持本软件的人设卡格式。</p></div><div v-else class="empty">创建或导入人设卡。</div></div>
      </template>
      <template v-else-if="selected === 'conversations'">
        <div class="heading"><div><h2>会话设置</h2><p>先选会话和 Bot，再选择 AI 或规则自动化。高级选项可按需展开。</p></div><button v-if="channel" @click="quickSetup">一键启用草稿</button></div>
        <div class="card fields"><label>选择会话<select v-model="selectedChannel"><option value="">请选择</option><option v-for="c in conversations" :key="keyOf(c)" :value="keyOf(c)">{{ c.name || c.id }} · {{ c.type === 2 ? '群聊' : '私聊' }} · {{ c.id }}</option></select></label>
          <template v-if="setting && channel">
            <label data-setting-id="conversation-bot">使用 Bot<select v-model="setting.botId"><option value="">请选择 Bot</option><option v-for="b in s.config.bots" :key="b.id" :value="b.id">{{ b.name }}</option></select></label>
            <label v-if="chosenBot" class="check"><input type="checkbox" :checked="chosenBot.allowed.includes(selectedChannel)" @change="allowCurrent(($event.target as HTMLInputElement).checked)" />授权此 Bot 访问当前会话</label>
            <div v-if="channel.type === 2 && chosenBot?.management?.enabled" class="management-status"><span>本群管理权限：{{ s.managementStatus[selectedChannel] || '尚未检查，运行时会自动核对' }}</span><button @click="ub.checkManagement(channel)">检查本群管理权限</button></div>
            <label v-if="chosenBot" class="check"><input type="checkbox" :checked="useAI" @change="setting.useAI = ($event.target as HTMLInputElement).checked" :disabled="chosenBot.useAI === false" />此会话使用 AI</label>
            <p v-if="chosenBot?.useAI === false" class="muted">Bot 全局 AI 已关闭，当前使用规则自动化。</p>
            <label v-if="channel.type === 2">工作模式<select v-model="setting.workMode"><option value="inherit">跟随 Bot 默认模式</option><option value="conversation">对话模式（仅回复）</option><option value="management" :disabled="!chosenBot?.management?.enabled">管理模式（已授权操作）</option></select></label>
            <label data-setting-id="conversation-mode">运行方式<select aria-label="回复模式" v-model="setting.mode"><option value="off">暂停（默认）</option><option value="manual">手动生成</option><option value="draft">自动生成草稿，人工确认</option><option value="auto">自动回复并发送</option></select></label>
            <label v-if="useAI">回复消息格式<select v-model="setting.replyFormat"><option value="auto">AI 自动判断（文字 / Markdown）</option><option value="text">始终使用文字</option><option value="markdown">始终使用 Markdown</option></select></label>
            <label v-if="chosenBot" class="check"><input type="checkbox" v-model="chosenBot.canSend" />允许自动发送（文字 / Markdown）</label>
            <p class="muted">{{ ub.statusFor(channel) }}。自动发送要求 Bot 已启用、授权当前会话并有发送权限；客户端退出后停止运行。</p>
            <div class="cols" data-setting-id="conversation-trigger"><label>触发方式<select v-model="setting.trigger"><option value="always">收到消息时</option><option value="mention">提及我（私聊直接触发）</option><option value="keyword">关键词</option><option value="command">指定指令</option></select></label><label v-if="setting.trigger === 'keyword'">关键词（逗号分隔）<input v-model="setting.keyword" /></label><label v-if="setting.trigger === 'command'">指令<input v-model="setting.command" /></label></div>
            <div v-if="!useAI" class="fields" data-setting-id="conversation-automation">
              <label>规则动作<select v-model="setting.automationAction"><option value="reply">固定回复</option><option value="recall" :disabled="channel.type !== 2">撤回触发消息（管理模式）</option><option value="mute" :disabled="channel.type !== 2">禁言触发者（管理模式）</option></select></label>
              <label v-if="setting.automationAction === 'reply'">自动回复内容<textarea v-model="setting.automationText" rows="3" placeholder="可使用 {name} 和 {text}" /></label>
              <label v-if="setting.automationAction === 'mute'">禁言时长<select v-model.number="setting.automationSeconds"><option :value="600">10 分钟</option><option :value="3600">1 小时</option><option :value="21600">6 小时</option><option :value="43200">12 小时</option><option :value="-1">永久</option></select></label>
              <p class="muted">回复可使用 {name}（发送者）和 {text}（消息内容）。规则按上方触发方式运行，不请求 AI；群操作沿用 Bot 的审核与权限设置。</p>
            </div>
            <details class="advanced-options"><summary>高级选项（按需设置）</summary><div class="fields">
<template v-if="useAI">            <div class="cols" data-setting-id="conversation-persona"><label>人设卡<select v-model="setting.personaId"><option value="">使用 Bot 默认</option><option v-for="x in s.config.personas" :key="x.id" :value="x.id">{{ x.name }}</option></select></label><label>AI 服务<select v-model="setting.serviceId"><option value="">使用 Bot / 全局默认</option><option v-for="x in s.config.services" :key="x.id" :value="x.id">{{ x.name }}</option></select></label></div>
            <label>模型覆盖（可选）<input v-model="setting.model" placeholder="留空使用服务默认模型" /></label><label class="check"><input type="checkbox" v-model="setting.useGlobal" />使用全局系统提示词</label><label>会话补充提示词<textarea v-model="setting.prompt" rows="3" /></label>
            <div class="cols" data-setting-id="conversation-context"><label>上下文条数<input type="number" min="1" max="100" v-model.number="setting.contextCount" /></label><label>上下文 Token 上限<input type="number" min="128" max="100000" v-model.number="setting.tokenLimit" /></label><label>冷却时间（秒）<input type="number" min="0" v-model.number="setting.cooldown" /></label><label>合并等待（秒，0 为关闭）<input type="number" min="0" max="30" v-model.number="setting.mergeSeconds" /></label></div><p class="muted">开启自动记忆后，在截断前先压缩较早消息；未开启或压缩失败时保留最近消息。占用比例以此处设置的 Token 上限为基准，使用本地估算。</p>
            <label class="check" data-setting-id="conversation-fallback"><input type="checkbox" v-model="setting.fallbackEnabled" />允许失败时将上下文发送给备用服务</label><label v-if="setting.fallbackEnabled">备用服务<select v-model="setting.fallbackServiceId"><option value="">请选择备用服务</option><option v-for="x in s.config.services" :key="x.id" :value="x.id">{{ x.name }}</option></select></label>
            <div class="memory-section" data-setting-id="conversation-memory">
              <label class="check"><input type="checkbox" v-model="setting.memoryEnabled" />启用此会话的人设记忆</label>
              <template v-if="setting.memoryEnabled">
                <label class="check"><input type="checkbox" v-model="setting.autoMemory" />AI 自动总结与压缩记忆</label>
                <div v-if="setting.autoMemory" class="cols">
                  <label>上下文达到多少 % 时压缩<input type="number" min="10" max="95" v-model.number="setting.memoryThreshold" /></label>
                  <label>记忆最大 Token<input type="number" min="64" max="4000" v-model.number="setting.memoryMaxTokens" /></label>
                  <label>保留最近消息条数<input type="number" min="1" max="20" v-model.number="setting.memoryKeepRecent" /></label>
                </div>
                <p class="muted">每次 AI 回复前检查占用，达到阈值时使用当前 AI 服务合并旧记忆和较早消息，保留最近原文。记忆最多占上下文上限的 25%；总结请求会消耗 Token。客户端退出后停止运行。</p>
                <p v-if="s.context[selectedChannel]" class="muted" role="status">{{ s.context[selectedChannel].stage }} · 上次请求上下文约 {{ s.context[selectedChannel].percent }}%（{{ s.context[selectedChannel].used }} / {{ s.context[selectedChannel].limit }} Token）</p>
                <p v-if="s.config.memoryCursors[memoryId]?.updatedAt" class="muted">上次自动总结：{{ new Date(s.config.memoryCursors[memoryId].updatedAt).toLocaleString() }}</p>
                <label>当前会话 · {{ chosenPersona?.name || '默认人设' }} 的记忆<textarea v-model="s.config.memories[memoryId]" rows="4" placeholder="可手动编辑；开启自动总结后会自动更新" /></label>
                <div class="actions"><button @click="delete s.config.memories[memoryId]; delete s.config.memoryCursors[memoryId]">清空当前记忆</button><button @click="clearPersonaMemory">清空此人设的全部会话记忆</button></div>
              </template>
            </div>
            <div class="actions"><button @click="preview = !preview">{{ preview ? '收起' : '预览实际提示词' }}</button></div><pre v-if="preview">{{ prompt }}</pre>
</template>
<label v-if="!useAI">冷却时间（秒）<input type="number" min="0" v-model.number="setting.cooldown" /></label>
</div></details>
          </template><div v-else class="empty">先从会话列表选择一个私聊或群聊。</div></div>
      </template>
      <template v-else-if="selected === 'global'"><div class="heading"><div><h2>全局系统提示词</h2><p>各会话可选择是否使用；权限始终由程序中的规则控制。</p></div></div><div class="card fields"><label data-setting-id="global-prompt">全局提示词<textarea v-model="s.config.globalPrompt" rows="10" /></label></div></template>
      <template v-else-if="selected === 'logs'"><div class="heading"><div><h2>运行记录</h2><p>记录状态与用量，不保存消息正文或密钥。最多保留最近 500 条；用量按日累计。</p></div><button @click="ub.clearLogs(); ctx.ui.toast('记录已清空', 'info')">清空记录</button></div>
        <div class="usage" data-setting-id="usage"><div v-for="u in usage" :key="u.name" class="card"><small>{{ u.name }}</small><strong>{{ u.estimated ? '≈ ' : '' }}{{ u.total }}</strong><small>Token{{ u.estimated ? ' · 含估算' : '' }}</small></div></div>
        <div class="card log"><div v-for="r in s.logs" :key="r.id"><time>{{ new Date(r.time).toLocaleString() }}</time><strong>{{ r.status }}</strong><span>{{ r.bot }} · {{ r.channel }}</span><span v-if="r.usage">{{ r.usage.total }} Token{{ r.usage.estimated ? '（估算）' : '' }}</span><small v-if="r.detail">{{ r.detail }}</small></div><p v-if="!s.logs.length" class="muted">暂无运行记录。</p></div></template>
    </main>
  </div>
</template>

<style scoped>
.advanced-options { border-top:1px solid var(--line); padding-top:14px; }.advanced-options>summary { cursor:pointer; font-size:13px; font-weight:600; padding:5px 0 14px; }
.management-section{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:17px 0}.management-section h3{margin:0;font-size:15px}.management-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.management-status{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px}.preset-gallery{margin-bottom:22px}.preset-gallery summary{cursor:pointer;font-weight:600;font-size:14px;margin-bottom:12px}.preset-gallery summary small{font-weight:400;margin-left:8px}.preset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px}.preset-grid button{display:flex;flex-direction:column;gap:8px;text-align:left;padding:14px;background:var(--card);transition:transform 180ms,border-color 180ms}.preset-grid button:hover{transform:translateY(-2px)}.preset-grid small{line-height:1.5}.preset-grid span{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--acc);margin-top:auto}.memory-section{display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line);padding-top:18px}.memory-section>label:not(.check){display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}.bot-shell{height:100%;min-height:0;display:grid;grid-template-columns:228px minmax(0,1fr);background:var(--bg)}.bot-sidebar{padding:26px 14px;border-right:1px solid var(--line);background:var(--card);overflow:auto}.title{display:flex;align-items:center;justify-content:space-between;padding:0 9px 20px}.title h1{font-size:21px;margin:0}.title small,.muted,.heading p,small{color:var(--fg2)}.search{display:flex;gap:7px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:0 10px;background:var(--card2)}.search input{width:100%;min-width:0;padding:10px 0;background:none;border:0}.plain{background:none;border:0}.bot-sidebar nav{margin-top:20px}.bot-sidebar nav button{display:flex;gap:11px;align-items:center;width:100%;border:0;border-radius:9px;background:transparent;color:var(--fg);padding:11px 12px;text-align:left;margin:2px 0}.bot-sidebar nav button:hover,.list button:hover{background:var(--card2)}.bot-sidebar nav button.active,.list button.active{background:var(--acc-soft);color:var(--acc);font-weight:600}.bot-main{overflow:auto;min-width:0;padding:28px 30px 50px}.heading{display:flex;align-items:start;justify-content:space-between;gap:18px;margin-bottom:22px}.heading h2,.bot-main h2{font-size:21px;margin:0 0 8px}.heading p{margin:0;line-height:1.6}.bot-main button{cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:8px 12px;background:var(--card2);color:var(--fg)}.bot-main button:hover{border-color:var(--acc)}.bot-main button.primary{background:var(--acc);color:#fff;border-color:var(--acc);white-space:nowrap}.bot-main button.danger{color:#d15c62}.split{display:grid;grid-template-columns:185px minmax(0,1fr);gap:16px}.list{display:flex;flex-direction:column;gap:5px}.list button{display:flex;flex-direction:column;gap:5px;text-align:left;background:transparent;overflow:hidden}.list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:20px}.fields{display:flex;flex-direction:column;gap:15px}.fields>label,.cols>label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}.fields input:not([type=checkbox]),.fields textarea,.fields select{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--fg);font:inherit;font-weight:400}.fields textarea{resize:vertical;line-height:1.55}.fields .check{display:flex;flex-direction:row;align-items:center;gap:9px;font-weight:400}.check input{accent-color:var(--acc)}.persona-avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--card2)}.fields p{margin:0;line-height:1.55;font-size:12px}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.highlight{outline:2px solid var(--acc);outline-offset:5px;border-radius:8px}.empty{color:var(--fg2);text-align:center;padding:45px 10px}.result{display:flex;gap:14px;align-items:center;width:100%;text-align:left;margin:12px 0;padding:18px!important}.result span{display:grid;gap:6px;flex:1}.result small{line-height:1.5}.notice{padding:16px;border-radius:10px;background:var(--card2)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6;background:var(--card2);padding:14px;border-radius:9px}.usage{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.usage .card{display:grid;gap:7px}.usage strong{font-size:21px}.log>div{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:12px 0;font-size:12px}.log small{width:100%;overflow-wrap:anywhere}.log time{color:var(--fg2)}@media(max-width:760px){.bot-shell{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.bot-sidebar{padding:12px;border-right:0;border-bottom:1px solid var(--line)}.title{padding:0 4px 10px}.title h1{font-size:17px}.bot-sidebar nav{display:flex;overflow-x:auto;margin-top:8px}.bot-sidebar nav button{width:auto;white-space:nowrap}.bot-main{padding:18px 16px}.split{grid-template-columns:1fr}.list{flex-direction:row;overflow-x:auto}.list button{min-width:130px}.usage{grid-template-columns:repeat(2,1fr)}}
</style>
