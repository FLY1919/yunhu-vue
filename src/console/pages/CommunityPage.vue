<script setup lang="ts">
/**
 * 板块页（community 插件注册）
 * 「板块」= 云湖的文章分区（/v1/community/ba/*）
 *   列表（关注/热门/我的/全部）、创建、编辑、管理（可见范围/发帖权限）、看绑定的群聊
 */
import { inject, ref, onMounted } from 'vue'
import KLayout from '../components/KLayout.vue'
import KCard from '../components/KCard.vue'
import { resUrl } from '../../core/res'
import { fmtTime } from '../../core/util'
import { renderMarkdown } from '../../core/render'

const ctx = inject<any>('ctx')
const cm = ctx.community
const s = cm.state

const tab = ref<'mine' | 'all' | 'hot' | 'follow'>('mine')
const newBa = ref({ name: '', avatar: '' })
/** 文章正文按 markdown 渲染 */
const md = (t: string) => renderMarkdown(t || '')
const editing = ref<any>(null)

const TABS: Array<[string, number]> = [['我的', 3], ['全部', 4], ['热门', 2], ['关注', 1]]

onMounted(() => cm.load(3))

async function switchTab(t: any) {
  tab.value = t[0] === '我的' ? 'mine' : t[0] === '全部' ? 'all' : t[0] === '热门' ? 'hot' : 'follow'
  const hit = TABS.find((x) => x[0] === t[0])
  await cm.load(hit ? hit[1] : 4)
}
async function create() {
  if (!newBa.value.name.trim()) return ctx.ui.toast('板块名称不能为空', 'warn')
  if (newBa.value.name.trim().length > 10) return ctx.ui.toast('板块名称最多 10 个字', 'warn')
  await cm.create(newBa.value.name.trim(), newBa.value.avatar)
  newBa.value = { name: '', avatar: '' }
}
</script>

<template>
  <KLayout ns="community" title="板块" desc="云湖文章分区：创建 / 管理 / 绑定群聊">
    <template #actions>
      <button v-for="t in TABS" :key="t[0]" class="ghost small"
              :class="{ on: (tab === 'mine' && t[0] === '我的') || (tab === 'all' && t[0] === '全部') || (tab === 'hot' && t[0] === '热门') || (tab === 'follow' && t[0] === '关注') }"
              @click="switchTab(t)">{{ t[0] }} {{ cm.countOf(t[1]) }}</button>
      <button class="ghost small" @click="cm.load(tab === 'mine' ? 3 : 4)">刷新</button>
    </template>

    <KCard title="创建板块">
      <div class="row">
        <input v-model="newBa.name" placeholder="板块名称（最多 10 字）" maxlength="10" />
        <span class="acts-inline">
        <label class="ghost small file">
          <input type="file" accept="image/*" hidden @change="(e: any) => cm.uploadAvatar(e, 'new')" />上传头像
        </label>
        <img v-if="s.newAvatar" :src="s.newAvatar" class="pre" alt="" />
        <span v-else-if="newBa.avatar" class="dim small">已填 URL</span>
        <button class="small" @click="cm.createWithAvatar(newBa.name.trim())">创建</button>
        </span>
      </div>
      <p class="dim small">名称最多 10 字；头像可以直接上传图片（不填也行）。</p>
    </KCard>

    <KCard class="mt" :pad="false">
      <div class="list">
        <div class="item" v-for="b in s.list" :key="b.id">
          <img :src="b.avatar ? resUrl(b.avatar) : ''" v-if="b.avatar" alt="" />
          <div class="ic" v-else>{{ (b.name || '?').slice(0, 1) }}</div>
          <div class="imain">
            <div class="iname">
              {{ b.name }}
              <em v-if="s.myIds.includes(b.id)">我创建的</em>
            </div>
            <div class="dim small">
              ID {{ b.id }}
              <span v-if="b.createTime"> · 建 {{ fmtTime(b.createTime) }}</span>
              <span v-if="b.lastActive"> · 活跃 {{ fmtTime(b.lastActive) }}</span>
            </div>
          </div>
          <!-- 手机上一行放不下：这组按钮单独一个容器，横向可滑，不再被压扁 -->
          <div class="acts">
            <button class="small" @click="cm.enter(b)">进入板块</button>
            <button class="ghost small" @click="cm.loadGroups(b)">绑定群聊</button>
            <button class="ghost small" @click="editing = { ...b }">编辑</button>
            <button class="ghost small" @click="cm.manage(b.id, 0, 0)">设为公开</button>
          </div>
        </div>
        <p v-if="!s.list.length" class="dim center">{{ s.loading ? '加载中…' : '这个分类下还没有板块' }}</p>
      </div>
    </KCard>

    <!-- 编辑 + 管理 -->
    <div v-if="editing" class="mask" @click.self="editing = null">
      <KCard title="编辑板块" style="width: 460px; max-width: 92vw">
        <div class="col">
          <label>名称<input v-model="editing.name" maxlength="10" /></label>
          <label>头像
            <div class="row">
              <input v-model="editing.avatar" placeholder="URL" />
              <label class="ghost small file">
                <input type="file" accept="image/*" hidden @change="(e: any) => cm.uploadAvatar(e, 'edit')" />上传
              </label>
              <img v-if="editing.avatar" :src="editing.avatar" class="pre" alt="" />
            </div>
          </label>
          <div class="row">
            <button class="small" @click="cm.edit(editing.id, { name: editing.name, avatar: editing.avatar }); editing = null">保存</button>
            <button class="ghost small" @click="editing = null">取消</button>
          </div>
          <div class="sep"></div>
          <div class="dim small">可见范围 / 发帖权限：</div>
          <div class="row">
            <div class="acts">
              <button class="ghost small" @click="cm.manage(editing.id, 0, 0)">公开·所有人可发</button>
              <button class="ghost small" @click="cm.manage(editing.id, 0, 1)">公开·仅我可发</button>
              <button class="ghost small" @click="cm.manage(editing.id, 1, 2)">仅自己可见</button>
            </div>
          </div>
        </div>
      </KCard>
    </div>

    <!-- 进入板块：文章列表 + 详情 -->
    <div v-if="s.viewing" class="mask" @click.self="cm.exitBoard()">
      <div class="board">
        <header>
          <img v-if="s.viewing.avatar" :src="s.viewing.avatar" class="bav" alt="" />
          <div>
            <b>{{ s.viewing.name }}</b>
            <div class="dim small">
              板块 {{ s.viewing.id }}
              <span v-if="s.info"> · {{ s.info.postNum ?? '?' }} 篇文章 · {{ s.info.groupNum ?? '?' }} 个群</span>
            </div>
          </div>
          <span class="grow"></span>
          <button class="ghost small" @click="cm.enter(s.viewing)">刷新</button>
          <button class="bx" @click="cm.exitBoard()">×</button>
        </header>
        <div class="bbody">
          <div v-if="s.postDetail" class="post-detail">
            <button class="ghost small" @click="s.postDetail = null">← 返回列表</button>
            <h3>{{ s.postDetail.title || (s.postDetail.post && s.postDetail.post.title) || '无标题' }}</h3>
            <div class="pd-meta dim small">
              {{ s.postDetail.senderName || '' }} · 赞 {{ s.postDetail.likeNum ?? 0 }} · 评论 {{ s.postDetail.commentNum ?? 0 }}
            </div>
            <div class="pd-body" v-html="md(s.postDetail.content || (s.postDetail.post && s.postDetail.post.content) || '')"></div>
          </div>
          <template v-else>
            <div class="post" v-for="p in s.posts" :key="p.id" @click="cm.openPost(p)">
              <b>{{ p.title || '(无标题)' }}</b>
              <div class="dim small">
                {{ p.senderName || p.senderId }} · {{ fmtTime(p.createTime) }} · 赞 {{ p.likeNum }} · 评论 {{ p.commentNum }}
              </div>
            </div>
            <p v-if="!s.posts.length" class="dim center">{{ s.loadingPosts ? '加载中…' : '这个板块还没有文章' }}</p>
          </template>
        </div>
      </div>
    </div>

    <!-- 绑定群聊 -->
    <div v-if="s.groupsOf" class="mask" @click.self="s.groupsOf = null">
      <KCard :title="`绑定的群聊 · ${s.groupsOf.name}`" style="width: 520px; max-width: 92vw">
        <div class="list" style="max-height: 46vh">
          <div class="item" v-for="g in s.groups" :key="g.groupId">
            <div class="imain">
              <div class="iname">{{ g.name }}</div>
              <div class="dim small">ID {{ g.groupId }} · {{ g.introduction || '无简介' }}</div>
            </div>
          </div>
        </div>
        <p v-if="!s.groups.length" class="dim center">这个板块还没绑定群聊</p>
        <div class="row mt">
          <input v-model="s.bindGroupId" placeholder="要绑定的群 ID" />
          <button class="small" @click="cm.bindGroup(s.groupsOf.id, s.bindGroupId)">绑定</button>
        </div>
      </KCard>
    </div>
  </KLayout>
</template>

<style scoped>
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 130px; }
.col { display: flex; flex-direction: column; gap: 10px; }
.col label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--fg2); }
.sep { height: 1px; background: var(--line); }
.list { max-height: 52vh; overflow: auto; }
.item { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px dashed var(--line); flex-wrap: wrap; }
/* 操作按钮组：手机上横向可滑，不挤压不拉伸 */
.acts { display: flex; gap: 6px; flex: 1 0 100%; margin-top: 4px;
        overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.acts::-webkit-scrollbar { display: none; }
.acts > * { flex: 0 0 auto; }
.acts-inline { display: inline-flex; gap: 8px; align-items: center; }
.item img, .ic { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; background: var(--card2); display: flex; align-items: center; justify-content: center; font-weight: 600; }
.imain { flex: 1; min-width: 0; }
.iname { font-size: 13.5px; display: flex; gap: 6px; align-items: center; }
.iname em { font-style: normal; font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--acc-soft); color: var(--acc); }
.tabs .on, .ghost.on { background: var(--acc); color: #fff; border-color: transparent; }
.center { text-align: center; padding: 16px 0; }
.pre { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; }
.file { display: inline-flex; align-items: center; cursor: pointer; padding: 3px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); }
.board { width: 720px; max-width: 94vw; max-height: 82vh; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); }
.board > header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.board .bav { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; }
.board .grow { flex: 1; }
.bx { background: transparent; color: var(--fg2); font-size: 20px; line-height: 1; padding: 0 8px; }
.bbody { overflow: auto; padding: 12px 16px; }
.post { padding: 10px 4px; border-bottom: 1px dashed var(--line); cursor: pointer; }
.post:hover b { color: var(--acc); }
.post-detail h3 { margin: 12px 0 4px; font-size: 16px; }
.pd-meta { margin-bottom: 10px; }
.pd-body { font-size: 13.5px; line-height: 1.65; }
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 200; display: flex; align-items: center; justify-content: center; }
.mt { margin-top: 12px; }
</style>
