<script setup lang="ts">
/**
 * 单条消息：头像 + 元信息 + 元素树
 * 交互：右键/长按/「⋯」呼出上下文菜单；多选态下显示勾选框并支持点击选中
 */
import { vResourceMedia } from '../core/resource-media'
import { inject, computed, ref, watch } from 'vue'
import { fmtTime, fmtFullTime, fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
import { groupTagStyle, messageGroupTags } from '../core/group-tag'
import { showRetainedRecall } from '../core/recall-display'
import { hasRecallBody } from '../core/recall-cache'
import { parse } from '../satori/element'
import type { Element } from '../satori/element'
import MessageElements from './MessageElements.vue'

const props = defineProps<{ msg: any }>()
const emit = defineEmits<{
  (e: 'menu', payload: { msg: any; x: number; y: number; anchor?: any }): void
  (e: 'quote-jump', id: string): void
}>()

const ctx = inject<any>('ctx')
const chat = ctx.chat

const elements = computed<Element[]>(() => {
  // Older snapshots can contain an empty parsed element alongside valid original content.
  // Reparse the saved content in that case so the retained label never masks a blank body.
  if (props.msg.elements?.length && (!props.msg.recalled || hasRecallBody({ elements: props.msg.elements }))) return props.msg.elements
  return parse(props.msg.content || {}, props.msg.type)
})

/** 引用块：优先在本地消息里找到被引用的那条，否则退回 quote_msg_text。
 *  ⚠️ 无论走哪条分支都必须带上 id —— 之前 quote_msg_text 分支丢了 id，
 *     导致被引用消息不在本地窗口时（如较早的图片引用）点击无法跳转定位。
 *  ⚠️ 延迟优化（用户报「看别人引用有延迟」）：本地没有且无回退文本时，
 *     异步拉被引消息单条补 preview，不再长期显示「不在本地记录中」。 */
const remoteQuote = ref<any>(null)
const quote = computed(() => {
  const qid = props.msg.quoteId || props.msg.content?.quote_msg_id
  if (!qid) return null
  const hit = (chat.state.messages || []).find((m: any) => m.id === qid)
  if (hit) return chat.quoteOf(hit)
  if (remoteQuote.value?.id === qid) return remoteQuote.value
  const t = props.msg.content?.quote_msg_text
  if (t) {
    const i = String(t).indexOf(':')
    // 保留 id：点击时走 jumpTo → messagesAround 拉上下文定位（即便本地没有这条）
    return i > 0
      ? { id: qid, sender: String(t).slice(0, i).trim(), preview: String(t).slice(i + 1).trim() }
      : { id: qid, sender: '', preview: String(t) }
  }
  return { id: qid, sender: '', preview: '引用的消息不在本地记录中' }
})
// 引用目标变更或组件重用时重新取摘要；同一引用的远端请求由服务缓存合并。
watch([() => props.msg.quoteId || props.msg.content?.quote_msg_id, () => chat.state.current], async ([qid], _old, onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  remoteQuote.value = null
  if (!qid) return
  const summary = await chat.getQuote(qid)
  if (!stale) remoteQuote.value = summary
}, { immediate: true })

const showRetained = computed(() => showRetainedRecall(props.msg, chat.preferences.antiRecall))
const isTip = computed(() => props.msg.type === 9 && !props.msg.recalled)
/** 定位高亮：点击目标以外、按 Escape、回最新或切会话时清除。 */
const isLocated = computed(() => ctx.chat?.state?.locateId === props.msg.id)
/**
 * 消息头顶的头衔。
 * ① 首选**消息自带的** Sender.tag（云湖把管理员设的头衔塞在发送者结构里，
 *    自己的消息也有，所以「自己的头衔」也能显示）；
 * ② 没有才退回到按用户 id 查的群标签。
 */
const senderTags = computed<any[]>(() => {
  const current = chat.state.current
  if (current?.type !== 2) return []
  const own = messageGroupTags(props.msg.tags, current)
  if (Array.isArray(own) && own.length) {
    return own.map((t: any) => ({ id: t.id || t.text, tag: t.text || t.tag, color: t.color }))
  }
  const uid = props.msg.senderId
  if (!uid) return []
  try { return ctx.group?.tagsOf?.(uid) || [] } catch { return [] }
})
/** 点头像/昵称看主页 */
function openProfile() {
  if (props.msg.senderId) {
    ctx.group?.openProfile?.({
      id: props.msg.senderId, name: props.msg.sender, avatar: props.msg.avatar,
      isBot: props.msg.senderType === 3,
    })
  }
}
const selected = computed(() => chat.state.selected.includes(props.msg.id))
const selecting = computed(() => chat.state.selecting)

/** 时间显示：左键点击在「简短(时分)」与「完整日期+秒」间切换（用户要求） */
const timeExpanded = ref(false)
const timeText = computed(() => timeExpanded.value ? fmtFullTime(props.msg.ts) : fmtTime(props.msg.ts))
function toggleTime() { timeExpanded.value = !timeExpanded.value }

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (selecting.value) return
  emit('menu', { msg: props.msg, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 220) })
}

function onMore(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // 交给菜单自己定位：传锚点矩形，它会优先弹在消息上方并夹回视口
  emit('menu', { msg: props.msg, x: r.left, y: r.bottom + 4,
                 anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
}

function onClick() {
  if (selecting.value) chat.toggleSelect(props.msg.id)
}

function onA2uiAction(a: any) {
  ctx.api?.a2uiFormReport?.({
    chatId: props.msg.chatId || chat.state.current?.id,
    actionName: a.name,
    sourceComponentId: a.sourceComponentId,
    interactionJson: JSON.stringify({ version: 'v0.9', action: { name: a.name, sourceComponentId: a.sourceComponentId, context: a.context || {} } }),
  }).then(() => ctx.ui?.toast(`已提交动作 ${a.name || ''}`, 'success'))
    .catch((e: any) => ctx.ui?.toast('提交失败：' + e.message, 'error'))
}
</script>

<template>
  <div v-if="isTip" class="sys">{{ msg.content?.text || msg.content?.tip }}</div>

  <div v-else class="row message-row" :data-mid="msg.id"
       :class="{ right: msg.right, picked: selected, selecting, recalled: msg.recalled && !showRetained, locate: isLocated }"
       @contextmenu="onContextMenu" @click="onClick">
    <span v-if="selecting" class="pick" :class="{ on: selected }">{{ selected ? '✓' : '' }}</span>

    <!-- 头像：点一下看 TA 的主页 -->
    <img class="av" v-resource-media="{ src: msg.avatar ? resUrl(msg.avatar) : fallbackAvatar(msg.sender), animated: true, width: 34, height: 34 }" alt=""
         title="查看 TA 的主页" @click.stop="openProfile"
         @error="(e: any) => (e.target.src = fallbackAvatar(msg.sender))" />

    <div class="msg-wrap">
      <!-- 发送者在本群的标签（显示在消息头顶，多了可以横向滑动） -->
      <div class="mtags" v-if="senderTags.length">
        <span v-for="t in senderTags" :key="t.id" class="mtag"
              :style="groupTagStyle(t.color)">{{ t.tag }}</span>
      </div>
      <div class="meta">
        <span class="who" title="查看 TA 的主页" @click.stop="openProfile">{{ msg.sender }}</span>
        <span class="t" :title="timeExpanded ? '点击显示简短时间' : '点击显示完整日期与秒'" @click.stop="toggleTime">{{ timeText }}</span>
        <span v-if="msg.edited" class="flag">已编辑</span>
      </div>
      <!-- 撤回：QQ 式居中灰色胶囊，不占气泡 -->
      <div v-if="msg.recalled && !showRetained" class="recall-capsule">
        {{ msg.right ? '你' : (msg.sender || '对方') }}撤回了一条消息
      </div>
      <div v-else class="bubble" :class="'t' + msg.type">
        <span v-if="showRetained" class="retained-label">已撤回 · 本地保留</span>
        <MessageElements :elements="elements" :quote="quote" :msg="msg"
                         @a2ui-action="onA2uiAction" @quote-jump="id => emit('quote-jump', id)" />
      </div>
    </div>

    <!-- 「⋯」按钮按用户要求移除：消息操作一律走右键/长按菜单 -->
  </div>
</template>

<style scoped>
.message-row { flex-wrap: nowrap !important; align-items: flex-start; width: fit-content; min-width: 0; }
.message-row .msg-wrap { min-width: 0; max-width: calc(100% - 42px); flex: 0 1 auto; }
.message-row .bubble { min-width: 0; max-width: 100%; box-sizing: border-box; }
.message-row .meta { align-items: baseline; flex-wrap: nowrap; max-width: 100%; line-height: 1.4; }
.message-row .meta .who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message-row .meta .t { flex: 0 0 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.retained-label { text-align: center; overflow-wrap: anywhere; white-space: normal; display: block; font-size: 11px; color: var(--warn); margin-bottom: 4px; }
.meta { font-size: 11px; color: var(--fg2); margin-bottom: 3px; display: flex; gap: 6px; }
.meta .t { cursor: pointer; user-select: none; }
.meta .t:hover { color: var(--acc); }
.row.right .meta { justify-content: flex-end; }
.meta .flag { opacity: .7; }
.row img.av { cursor: pointer; }
.meta .who { cursor: pointer; }
.meta .who:hover { color: var(--acc); text-decoration: underline; }
/* 标签多的时候不换行，直接横向滑动（手机上也好用） */
.mtags {
  display: flex; flex-wrap: nowrap; gap: 4px; margin-bottom: 3px;
  overflow-x: auto; overflow-y: hidden; max-width: 100%;
  scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
.mtags::-webkit-scrollbar { display: none; }
.row.right .mtags { flex-direction: row-reverse; }
.mtag { font-size: 10.5px; border-radius: 5px; padding: 1px 6px; white-space: nowrap; flex: 0 0 auto; }
.meta .who { cursor: pointer; }
.meta .who:hover { color: var(--acc); text-decoration: underline; }
.row img.av { cursor: pointer; }
/* 撤回：整行居中灰色胶囊（QQ 式），隐藏头像/昵称/时间 */
.message-row.recalled { width: 100%; max-width: 100%; box-sizing: border-box; justify-content: center; align-self: stretch; margin-inline: 0; }
.row.recalled .av, .row.recalled .pick { display: none; }
.row.recalled .msg-wrap { display: contents; }
.row.recalled .meta, .row.recalled .mtags { display: none; }
.recall-capsule {
  font-size: 12px; color: var(--fg2); background: var(--card2);
  border-radius: 999px; padding: 3px 12px; margin: 2px 0;
  min-width: 0; max-width: 100%; box-sizing: border-box; text-align: center; white-space: normal; overflow-wrap: anywhere;
}

.row.selecting { cursor: pointer; }
.row.picked .bubble { outline: 2px solid var(--acc); outline-offset: 1px; }
.pick {
  align-self: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 6px;
  border: 1.5px solid var(--line2); display: grid; place-items: center;
  font-size: 13px; color: #fff; background: var(--card);
}
.pick.on { background: var(--acc); border-color: var(--acc); }
.row.right .pick { order: -1; }

.more {
  align-self: center; background: transparent; color: var(--fg2); padding: 2px 6px;
  border-radius: 6px; opacity: 0; font-size: 16px; line-height: 1;
}
.row:hover .more { opacity: 1; }
.more:hover { background: var(--card2); color: var(--fg); }
</style>
