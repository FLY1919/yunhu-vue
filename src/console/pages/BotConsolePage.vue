<script setup lang="ts">
/**
 * 机器人控制台（botconsole 插件注册）
 *   我创建的机器人列表（/v1/bot/console/my-bots）
 *   改名字/简介/头像、重置 token、看指令、创建新机器人
 */
import { inject, ref, onMounted } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res'
import { fallbackAvatar } from '../../core/util'

const ctx = inject<any>('ctx')
const bc = ctx.botconsole
const s = bc.state

const editing = ref<any>(null)
const newBot = ref({ name: '', introduction: '', isPrivate: false })

onMounted(() => bc.load())

async function save() {
  if (!editing.value) return
  await bc.edit(editing.value.id, {
    name: editing.value.name, introduction: editing.value.introduction, avatarUrl: editing.value.avatar,
  })
  editing.value = null
}
async function create() {
  if (!newBot.value.name.trim()) return ctx.ui.toast('机器人名称不能为空', 'warn')
  await bc.create(newBot.value.name.trim(), newBot.value.introduction, newBot.value.isPrivate)
  newBot.value = { name: '', introduction: '', isPrivate: false }
}
function copy(text: string, label = '内容') {
  navigator.clipboard?.writeText(text).then(
    () => ctx.ui.toast(`已复制${label}`, 'success'),
    () => window.prompt(`复制${label}：`, text))
}
</script>

<template>
  <KLayout ns="bots" title="机器人" desc="我创建的机器人 · 编辑信息 / Token / 指令">
    <template #actions>
      <span class="pill">共 {{ s.total }} 个</span>
      <button class="ghost small" @click="bc.load()">刷新</button>
    </template>

    <KCard title="创建机器人">
      <div class="row">
        <input v-model="newBot.name" placeholder="机器人名称" />
        <input v-model="newBot.introduction" placeholder="简介（可选）" />
        <label class="chk"><input type="checkbox" v-model="newBot.isPrivate" /> 私有</label>
        <button class="small" @click="create">创建</button>
      </div>
      <div class="row" v-if="s.createdId">
        <span class="dim small">刚创建：<b>{{ s.createdId }}</b></span>
        <button class="ghost small" @click="copy(s.createdId, '机器人 ID')">复制 ID</button>
      </div>
    </KCard>

    <KCard class="mt" :pad="false">
      <div class="list">
        <div class="item" v-for="b in s.list" :key="b.id">
          <img :src="b.avatar ? resUrl(b.avatar) : fallbackAvatar(b.name)" @error="(e: any) => (e.target.src = fallbackAvatar(b.name))" alt="" />
          <div class="imain">
            <div class="iname">
              {{ b.name }}
              <em v-if="b.platform">{{ b.platform }}</em>
            </div>
            <div class="dim small">ID {{ b.id }}<span v-if="b.link"> · 订阅 {{ b.link.slice(0, 30) }}</span></div>
          </div>
          <div class="acts">
            <button class="ghost small" @click="bc.loadInstructions(b)">指令</button>
            <button class="ghost small" @click="bc.resetToken(b.id)">重置 Token</button>
            <button class="ghost small" @click="copy(b.token, 'Token')">复制 Token</button>
            <button class="small" @click="editing = { ...b }">编辑</button>
          </div>
        </div>
        <p v-if="!s.list.length" class="dim center">{{ s.loading ? '加载中…' : '你还没有创建过机器人' }}</p>
      </div>
    </KCard>

    <!-- 编辑弹窗 -->
    <div v-if="editing" class="mask" @click.self="editing = null">
      <KCard title="编辑机器人" style="width: 420px; max-width: 92vw">
        <div class="col">
          <label>名称<input v-model="editing.name" /></label>
          <label>简介<input v-model="editing.introduction" /></label>
          <label>头像 URL<input v-model="editing.avatar" /></label>
          <div class="row">
            <button class="small" @click="save">保存</button>
            <button class="ghost small" @click="editing = null">取消</button>
          </div>
        </div>
      </KCard>
    </div>

    <!-- 指令弹窗 -->
    <div v-if="s.showInstructions" class="mask" @click.self="s.showInstructions = null">
      <KCard :title="`指令 · ${s.instructionsOf?.name || ''}`" style="width: 520px; max-width: 92vw">
        <div class="list" style="max-height: 46vh">
          <div class="item" v-for="(i, k) in s.instructions" :key="k">
            <div class="imain">
              <div class="iname">
                {{ i.name || i.command || i.id || ('指令 ' + (k + 1)) }}
                <em v-if="i.type === 2">直发</em>
                <em v-else-if="i.type === 5">自定义</em>
                <em v-else>普通</em>
              </div>
              <div class="dim small">{{ i.desc || i.description || '' }}</div>
            </div>
          </div>
        </div>
        <p v-if="!s.instructions.length" class="dim center">还没有指令</p>
      </KCard>
    </div>
  </KLayout>
</template>

<style scoped>
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 130px; }
.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--fg2); }
.col { display: flex; flex-direction: column; gap: 10px; }
.col label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--fg2); }
.list { max-height: 50vh; overflow: auto; }
.item { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px dashed var(--line); flex-wrap: wrap; }
.acts { display: flex; gap: 6px; flex: 1 0 100%; margin-top: 4px; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.acts::-webkit-scrollbar { display: none; }
.acts > * { flex: 0 0 auto; }
.item img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: var(--card2); }
.imain { flex: 1; min-width: 0; }
.iname { font-size: 13.5px; display: flex; gap: 6px; align-items: center; }
.iname em { font-style: normal; font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--acc-soft); color: var(--acc); }
.center { text-align: center; padding: 16px 0; }
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 200; display: flex; align-items: center; justify-content: center; }
.mt { margin-top: 12px; }
</style>
