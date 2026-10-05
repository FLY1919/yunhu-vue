<script setup lang="ts">
/**
 * 聊天背景设置
 * 数据来自 /v1/chat-background/list（chatId='all' 是全局）；
 * 设置走 /v1/chat-background/edit { userId, chatId, url }，url 是文件名或完整链接。
 */
import { inject, computed } from 'vue'
import { resUrl } from '../core/res'

const ctx = inject<any>('ctx')
const bg = ctx.charbg
const chat = ctx.chat

const scope = computed(() => chat.state.current?.id || 'all')
const scopeName = computed(() => (chat.state.current ? chat.state.current.name : '全局（所有会话）'))

async function pickFile(e: any) {
  const f = e.target.files?.[0]
  if (!f) return
  try { await bg.uploadBg(f) } catch (err: any) { ctx.ui.toast('上传失败：' + err.message, 'error') }
  e.target.value = ''
}
</script>

<template>
  <div v-if="bg.state.open" class="bg-mask" @click.self="bg.closeDialog()">
    <div class="bg">
      <header>
        <b>聊天背景</b>
        <span class="dim small">当前范围：{{ scopeName }}</span>
        <span class="grow"></span>
        <button class="ghost small" @click="bg.load()">刷新</button>
        <button class="bg-x" @click="bg.closeDialog()">×</button>
      </header>

      <div class="bg-body">
        <div class="bg-cur">
          <div class="lab">预览</div>
          <div class="preview" :style="bg.bgStyleOf(chat.state.current?.id)"></div>
        </div>

        <div class="bg-row">
          <input v-model="bg.state.urlInput" placeholder="背景文件名或图片链接，如 8ae0e571….png" />
          <button class="small" @click="bg.setBg(scope, bg.state.urlInput)">设为背景</button>
          <button class="ghost small" @click="bg.setBg(chat.state.current?.id, bg.state.urlInput)">
            只设当前会话
          </button>
          <label class="ghost small file">
            <input type="file" accept="image/*" hidden @change="pickFile" />上传图片
          </label>
        </div>
        <p class="dim small">
          说明：「只设当前会话」用会话 ID 作范围；不填 chatId 就是全局（all）。
          云湖要求 url 是**文件名+扩展名**，直接传完整链接也能用。
        </p>

        <div class="lab">已设置的背景（{{ bg.state.list.length }}）</div>
        <div class="bg-list">
          <div v-for="b in bg.state.list" :key="b.id" class="bg-item">
            <img :src="resUrl(b.imgUrl)" alt="" />
            <div>
              <div>{{ b.chatId === 'all' ? '全局（所有会话）' : '会话 ' + b.chatId }}</div>
              <div class="dim small">{{ b.imgUrl.split('/').pop() }}</div>
            </div>
            <span class="grow"></span>
            <button class="ghost small" @click="bg.setBg(scope, b.imgUrl)">应用到当前</button>
            <button class="ghost small danger" @click="bg.clearBg(b.chatId)">取消</button>
          </div>
          <div v-if="!bg.state.list.length" class="dim center">还没有设置过背景</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 126; display: flex; align-items: center; justify-content: center; }
.bg { width: 620px; max-width: 95vw; max-height: 86vh; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
.bg > header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.bg > header .grow { flex: 1; }
.bg-x { background: transparent; color: var(--fg2); font-size: 20px; padding: 0 8px; line-height: 1; }
.bg-x:hover { color: var(--err); background: transparent; }
.bg-body { overflow: auto; padding: 14px; }
.lab { font-size: 12.5px; color: var(--fg2); margin: 6px 0; }
.preview { height: 130px; border-radius: 10px; background: var(--card2); border: 1px solid var(--line); background-size: cover; background-position: center; }
.bg-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.bg-row input[type=text], .bg-row input:not([type]) { flex: 1; min-width: 200px; }
.file { display: inline-flex; align-items: center; cursor: pointer; padding: 3px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); }
.bg-list { display: flex; flex-direction: column; gap: 4px; }
.bg-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.bg-item img { width: 52px; height: 34px; object-fit: cover; border-radius: 6px; background: var(--card2); }
.bg-item .grow { flex: 1; }
.center { text-align: center; padding: 14px 0; }
</style>
