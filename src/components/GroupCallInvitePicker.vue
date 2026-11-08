<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{ groupId: string; video: boolean }>()
const emit = defineEmits<{ invite: [ids: string[]] }>()
const ctx = inject<any>('ctx')
const size = 20
const query = ref('')
const page = ref(1)
const pages = ref(1)
const pending = ref(false)
const error = ref('')
const members = ref<{ id: string; name: string }[]>([])
const selected = ref<string[]>([])
const account = String(ctx.auth.state.user?.id)
const available = computed(() => members.value.filter(member => member.id && member.id !== account))
let generation = 0

async function load(next: number) {
  const request = ++generation
  pending.value = true
  error.value = ''
  try {
    const result = await ctx.api.listMembers(props.groupId, { size, page: next, keywords: query.value.trim(), timeout: 10000 })
    if (generation !== request) return
    members.value = result.list
    page.value = next
    pages.value = result.total ? Math.ceil(result.total / size) : next + Number(result.list.length === size)
  } catch (cause) {
    if (generation === request) error.value = cause?.message || '无法加载群成员，请重试。'
  } finally {
    if (generation === request) pending.value = false
  }
}
onMounted(() => { void load(1) })
onUnmounted(() => { generation++ })
</script>

<template>
  <div class="group-invites">
    <form @submit.prevent="load(1)"><input v-model="query" aria-label="搜索群成员" placeholder="群成员昵称或 ID" />
      <button type="submit" class="ghost" :disabled="pending">搜索</button>
    </form>
    <p v-if="pending" role="status">正在加载群成员…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!available.length">当前页没有可邀请的成员</p>
    <div v-else class="invite-list">
      <label v-for="member in available" :key="member.id">
        <input v-model="selected" type="checkbox" :value="member.id" /><span>{{ member.name || member.id }}</span><small>{{ member.id }}</small>
      </label>
    </div>
    <div class="invite-actions">
      <button type="button" class="ghost" :disabled="pending || page <= 1" @click="load(page - 1)">上一页</button>
      <button type="button" class="ghost" :disabled="pending || page >= pages" @click="load(page + 1)">下一页</button>
      <button type="button" :disabled="!selected.length" @click="emit('invite', selected.slice())">
        {{ video ? '预览视频' : '开始群通话' }}（{{ selected.length }}）
      </button>
    </div>
  </div>
</template>

<style scoped>
.group-invites { display:grid; gap:8px; min-width:0; font-size:12px; }
.group-invites p { margin:0; color:var(--fg2); }
.group-invites form,.invite-actions { display:flex; gap:6px; flex-wrap:wrap; }
.group-invites form input { flex:1; min-width:110px; }
.invite-list { max-height:min(230px,35dvh); overflow:auto; display:grid; }
.invite-list label { display:flex; align-items:center; gap:8px; min-height:34px; padding:3px; }
.invite-list span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.invite-list small { margin-left:auto; color:var(--fg2); }
</style>
