<script setup lang="ts">
/**
 * 单条消息：头像 + 元信息 + 元素树
 * 交互：右键/长按/「⋯」呼出上下文菜单；多选态下显示勾选框并支持点击选中
 */
import { inject, computed } from 'vue'
import { fmtTime, fallbackAvatar } from '../core/util'
import { resUrl } from '../core/res'
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
  if (props.msg.elements?.length) return props.msg.elements
  return parse(props.msg.content || {}, props.msg.type)
})

/** 引用块：优先在本地消息里找到被引用的那条，否则退回 quote_msg_text */
const quote = computed(() => {
  const qid = props.msg.quoteId || props.msg.content?.quote_msg_id
  if (!qid) return null
  const hit = (chat.state.messages || []).find((m: any) => m.id === qid)
  if (hit) return { id: qid, sender: hit.sender, preview: chat.previewOf(hit) }
  const t = props.msg.content?.quote_msg_text
  if (t) {
    const i = String(t).indexOf(':')
    return i > 0
      ? { sender: String(t).slice(0, i).trim(), preview: String(t).slice(i + 1).trim() }
      : { sender: '', preview: String(t) }
  }
  return { id: qid, sender: '', preview: '引用的消息不在本地记录中' }
})

const isTip = computed(() => props.msg.type === 9 && !props.msg.recalled)
/**
 * 消息头顶的头衔。
 * ① 首选**消息自带的** Sender.tag（云湖把管理员设的头衔塞在发送者结构里，
 *    自己的消息也有，所以「自己的头衔」也能显示）；
 * ② 没有才退回到按用户 id 查的群标签。
 */
const senderTags = computed<any[]>(() => {
  const own = (props.msg as any).tags
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

  <div v-else class="row" :data-mid="msg.id" :class="{ right: msg.right, picked: selected, selecting }"
       @contextmenu="onContextMenu" @click="onClick">
    <span v-if="selecting" class="pick" :class="{ on: selected }">{{ selected ? '✓' : '' }}</span>

    <!-- 头像：点一下看 TA 的主页 -->
    <img class="av" :src="msg.avatar ? resUrl(msg.avatar) : fallbackAvatar(msg.sender)" alt=""
         title="查看 TA 的主页" @click.stop="openProfile"
         @error="(e: any) => (e.target.src = fallbackAvatar(msg.sender))" />

    <div class="msg-wrap">
      <!-- 发送者在本群的标签（显示在消息头顶，多了可以横向滑动） -->
      <div class="mtags" v-if="senderTags.length">
        <span v-for="t in senderTags" :key="t.id" class="mtag"
              :style="{ background: (t.color || '#888') + '22', color: t.color || '#888' }">{{ t.tag }}</span>
      </div>
      <div class="meta">
        <span class="who" title="查看 TA 的主页" @click.stop="openProfile">{{ msg.sender }}</span>
        <span class="t">{{ fmtTime(msg.ts) }}</span>
        <span v-if="msg.edited" class="flag">已编辑</span>
      </div>
      <div class="bubble" :class="'t' + msg.type">
        <span v-if="msg.recalled" class="recalled">消息已撤回</span>
        <MessageElements v-else :elements="elements" :quote="quote" :msg="msg"
                         @a2ui-action="onA2uiAction" @quote-jump="id => emit('quote-jump', id)" />
      </div>
    </div>

    <button v-if="!selecting" class="more" title="更多操作" @click.stop="onMore">⋯</button>
  </div>
</template>

<style scoped>
.msg-wrap { min-width: 0; }
.meta { font-size: 11px; color: var(--fg2); margin-bottom: 3px; display: flex; gap: 6px; }
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
.recalled { font-style: italic; opacity: .6; }

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
