<script setup lang="ts">
/**
 * 输入区上方的「正在引用」提示条。
 * 引用态存在 chat.state.reply，发送时作为 quoteId 带上；点 × 清掉。
 */
import { inject } from 'vue'
import Icon from '../console/components/Icon.vue'
import { resUrl } from '../core/res'

const ctx = inject<any>('ctx')
const chat = ctx.chat
</script>

<template>
  <Transition name="reply"><div class="quotebar" v-if="chat.state.reply">
    <Icon class="qb-ico" :name="chat.state.reply.kind==='video'?'video':chat.state.reply.kind==='file'?'paperclip':chat.state.reply.kind==='audio'?'mic':'quote'" :size="17"/>
    <img v-if="chat.state.reply.image" class="qb-thumb" :src="resUrl(chat.state.reply.image)" alt="引用图片" />
    <div class="qb-main">
      <b>{{ chat.state.reply.sender }}</b>
      <span class="qb-text">{{ chat.state.reply.preview }}</span>
    </div>
    <button class="qb-x" aria-label="取消引用" title="取消引用" @click="chat.clearReply()"><Icon name="close" :size="15"/></button>
  </div></Transition>
</template>

<style scoped>
.quotebar {
  display: flex; align-items: center; gap: 10px; margin-bottom:6px; max-height:70px;overflow:hidden;box-sizing:border-box;
  padding: 7px 12px; border-radius: 9px; background: var(--card2); color: var(--fg);
  border-left: 3px solid var(--acc);
}
.qb-ico { color: var(--acc); font-size: 15px; }
.qb-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 5px; flex-shrink: 0; }
.qb-main { flex: 1; min-width: 0; display:flex; flex-direction:column; gap:2px; align-items:stretch; font-size: 12.5px; }
.qb-main b { color: var(--link, var(--fg)); }
.qb-text { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-x { background: transparent; color: var(--fg2); padding: 0 6px; font-size: 16px; line-height: 1; }
.qb-x:hover { color: var(--err); background: transparent; }
.reply-enter-active,.reply-leave-active{transition:max-height .18s,opacity .16s,margin .18s,padding .18s}.reply-enter-from,.reply-leave-to{max-height:0;opacity:0;margin-block:0;padding-block:0}.qb-x{display:grid;place-items:center;flex-shrink:0;width:24px;height:24px;border-radius:5px}.qb-main b{font-size:11px}.qb-text{font-size:12px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}</style>
