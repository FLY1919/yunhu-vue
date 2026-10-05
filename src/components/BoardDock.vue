<script setup lang="ts">
/**
 * 群界面（全屏，覆盖右侧内容区）—— 看板 / 成员 / 记录 / 群资料 / 群文件 / 群标签 / 全部看板。
 *
 * 布局约束（踩过）：
 *   · 用 position:absolute 在 .page-area 内铺满，**不能用 fixed** ——
 *     fixed 会盖住左侧导航栏，导致「开着群界面时左边点了没反应」
 *   · 页签一行可横向滑动，最后一个按钮固定是「退出」
 *
 * 群文件这块有两套列表：
 *   · 云湖自带群网盘：api.diskList（字段是 qiniuKey，别写 fileUrl）
 *   · 群里的第三方网盘挂载：走 /mount-json 代理，页内浏览（不跳新标签）
 */
import { inject, computed, ref, watch, nextTick } from 'vue'
import { resUrl } from '../core/res'
import { fallbackAvatar, fmtTime } from '../core/util'
import { sanitizeHtml, renderRich, postProcess } from '../core/render'
import Icon from '../console/components/Icon.vue'

const ctx = inject<any>('ctx')
const g = ctx.group
const chat = ctx.chat

const el = ref<HTMLElement | null>(null)
const html = computed(() => (g.state.board?.content ? renderRich(g.state.board.content) : ''))
async function fix() { await nextTick(); postProcess(el.value) }
watch(html, fix)
watch(() => g.state.allBoards.length, fix)

// 只列「真的有看板」的机器人（接口没法按机器人查，靠扫描结果反推）
const boardBots = computed(() => g.state.boardBots || [])
const bots = computed(() => g.state.bots || [])
/** 还没扫描过时，先扫一遍再刷新列表 */
async function scanThenRefresh() {
  await g.scanAllBoards()
  g.refreshBoardBots?.()
}

/** 字节数转可读大小（接口给的是 totalSize，单位字节） */
function human(n: number) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`
}

/** 挂载盘里某个文件的下载地址（走本站 WebDAV 网关） */
function mountFileUrl(name: string) {
  const gid = chat.state.current?.id
  const mid = g.state.mountView?.id
  const p = [...g.state.mountPath, name].map(encodeURIComponent).join('/')
  return `${location.origin}/webdav/${gid}/@mount/${mid}/${p}`
}

/** 打开挂载盘（页内浏览，不跳转） */
function openMount(m: any) {
  g.openMount(m)
}

/** 当前群的 WebDAV 地址（指向本站网关） */
const webdavUrl = computed(() =>
  `${location.protocol}//${location.host}/webdav/${chat.state.current?.id || ''}/`)
function copyWebdav() {
  navigator.clipboard?.writeText(webdavUrl.value).then(
    () => ctx.ui?.toast('已复制 WebDAV 地址', 'success'),
    () => window.prompt('复制地址：', webdavUrl.value))
}

/** 把看板 HTML 净化后返回（多份看板共用） */
// 看板内容可能是 markdown 也可能是 HTML，交给 renderRich 判断
function boardHtmlOf(b: any) { return b?.content ? renderRich(b.content) : '' }
</script>

<template>
  <div class="dock" v-if="g.state.dockOpen">
    <!-- 顶部：页签一行可横向滑动，最后一个按钮固定为「退出」 -->
    <div class="dock-head">
      <b class="dock-title">群</b>
      <div class="dock-tabs">
        <button class="ghost small" :class="{ on: g.state.dockTab === 'board' }" @click="g.setDockTab('board')">
          <Icon name="page" :size="13" /> 看板
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'members' }" @click="g.setDockTab('members')">
          <Icon name="user" :size="13" /> 成员
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'search' }" @click="g.setDockTab('search')">
          <Icon name="search" :size="13" /> 记录
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'info' }" @click="g.setDockTab('info')">
          <Icon name="page" :size="13" /> 群资料
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'disk' }" @click="g.setDockTab('disk')">
          <Icon name="folder" :size="13" /> 群文件
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'tags' }" @click="g.setDockTab('tags')">
          <Icon name="check" :size="13" /> 群标签
        </button>
        <button class="ghost small" :class="{ on: g.state.dockTab === 'all' }" @click="g.setDockTab('all')">
          <Icon name="search" :size="13" /> 全部看板
        </button>
        <button class="ghost small dock-exit" title="退出" @click="g.closeDock()">
          <Icon name="logout" :size="13" /> 退出
        </button>
      </div>

      <span class="grow"></span>
      <button class="ghost small" title="刷新"
              @click="g.state.dockTab === 'board' ? g.loadBoard() : g.state.dockTab === 'disk' ? g.loadDisk() : g.scanAllBoards()">
        <Icon name="refresh" :size="13" />
      </button>
    </div>

    <div v-show="g.state.boardOpen" class="dock-body">
      <!-- ===== 当前会话看板 ===== -->
      <template v-if="g.state.dockTab === 'board'">
        <div v-if="g.state.boardLoading" class="dim">加载中…</div>
        <div v-else-if="html" ref="el" class="rich" v-html="html"></div>
        <div v-else class="dim">该会话没有看板</div>

        <!-- 看板来源 + 机器人切换：放在内容**下面**，不跟顶部标题挤在一起 -->
        <div class="board-src">
          <template v-if="g.state.boardOwner">
            <img v-if="g.state.boardOwner.avatar" :src="resUrl(g.state.boardOwner.avatar)" alt="" />
            <span>来自 <b>{{ g.state.boardOwner.name }}</b></span>
          </template>
          <span v-else class="dim">来源未知</span>
          <span v-if="g.state.board?.updatedAt" class="dim small">· 更新于 {{ fmtTime(g.state.board.updatedAt) }}</span>
          <span class="grow"></span>
          <span v-if="boardBots.length" class="dim small">
            有看板的机器人（{{ boardBots.length }}）
          </span>
          <select v-if="boardBots.length" class="bot-sel" :value="g.state.boardBotId"
                  @change="(e: any) => g.setBoardBot(e.target.value)">
            <option value="">本会话看板</option>
            <option v-for="b in boardBots" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
          <button v-else class="ghost small" @click="scanThenRefresh">找出有看板的机器人</button>
        </div>
      </template>

      <!-- ===== 成员列表（收纳在停靠栏里，不用再开右侧抽屉）===== -->
      <template v-else-if="g.state.dockTab === 'members'">
        <div class="gp-search">
          <input v-model="g.state.memberKeyword" placeholder="搜索成员…" @keyup.enter="g.loadMembers()" />
          <button class="ghost small" @click="g.loadMembers()">搜索</button>
          <span class="dim small">{{ g.state.members.length }}/{{ g.state.membersTotal }}</span>
        </div>
        <ul class="dock-members">
          <li v-for="m in g.state.members" :key="m.id">
            <img :src="m.avatar ? resUrl(m.avatar) : fallbackAvatar(m.name)"
                 @error="(e: any) => (e.target.src = fallbackAvatar(m.name))" alt="" />
            <span class="nm">{{ m.name }}</span>
            <em v-if="m.level >= 100" class="role owner">群主</em>
            <em v-else-if="m.level >= 2" class="role admin">管理员</em>
            <em v-if="m.isGag" class="role gag">已禁言</em>
            <span class="grow"></span>
            <select class="gag-sel" @change="(e: any) => { if (e.target.value !== '') { g.gag(m, Number(e.target.value)); e.target.value = '' } }">
              <option value="">禁言…</option>
              <option v-for="o in g.GAG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <button v-if="g.state.tags.length" class="ghost small" @click="g.setDockTab('tags'); g.openTagMember(m)">标签</button>
            <button class="ghost small danger" @click="g.kick(m)">踢出</button>
          </li>
          <li v-if="!g.state.members.length" class="dim center">
            {{ g.state.membersLoading ? '加载中…' : '暂无成员' }}
          </li>
        </ul>
        <div class="center" v-if="g.state.members.length < g.state.membersTotal">
          <button class="ghost small" :disabled="g.state.membersLoading" @click="g.loadMoreMembers()">加载更多</button>
        </div>
      </template>

      <!-- ===== 聊天记录搜索 ===== -->
      <template v-else-if="g.state.dockTab === 'search'">
        <div class="gp-search">
          <input v-model="g.state.searchWord" placeholder="搜索本会话聊天记录…" @keyup.enter="g.doSearch()" />
          <button class="small" :disabled="g.state.searching" @click="g.doSearch()">搜索</button>
        </div>
        <ul class="gp-results">
          <li v-for="r in g.state.results" :key="r.id">
            <div class="r-top"><b>{{ r.sender }}</b><span class="dim small">{{ fmtTime(r.ts) }}</span></div>
            <div class="r-text">{{ r.text || '[非文本]' }}</div>
          </li>
          <li v-if="g.state.searched && !g.state.results.length" class="dim center">没有匹配的记录</li>
          <li v-if="!g.state.searched" class="dim center">输入关键词搜索</li>
        </ul>
      </template>

      <!-- ===== 群资料（群详细信息） ===== -->
      <template v-else-if="g.state.dockTab === 'info'">
        <div v-if="g.state.infoLoading" class="dim center">加载中…</div>
        <div v-else-if="g.state.info" class="ginfo">
          <div class="ginfo-top">
            <img :src="g.state.info.avatar ? resUrl(g.state.info.avatar) : fallbackAvatar(g.state.info.name)"
                 @error="(e: any) => (e.target.src = fallbackAvatar(g.state.info.name))" alt="" />
            <div>
              <div class="ginfo-name">{{ g.state.info.name }}</div>
              <div class="dim small">群 ID {{ g.state.info.id }} · {{ g.state.info.headcount }} 人</div>
            </div>
          </div>
          <div class="ginfo-grid">
            <div class="kv"><span class="k">群简介</span><span>{{ g.state.info.introduction || '—' }}</span></div>
            <div class="kv"><span class="k">群主</span><span>{{ g.state.info.createBy || '—' }}</span></div>
            <div class="kv"><span class="k">创建时间</span><span>{{ g.state.info.createTime ? fmtTime(g.state.info.createTime) : '—' }}</span></div>
          </div>
          <p class="dim small">接口：/v1/group/info（GroupInfoRequest{group_id=2}）</p>
        </div>
        <div v-else class="dim center">没拿到群信息</div>
      </template>

      <!-- ===== 群文件（群网盘） ===== -->
      <template v-else-if="g.state.dockTab === 'disk'">
        <!-- 作为群网盘用 WebDAV 打开：给出地址 + 账号说明 -->
        <div class="wd-bar">
          <b>用 WebDAV 打开这个群网盘</b>
          <code>{{ webdavUrl }}</code>
          <button class="ghost small" @click="copyWebdav">复制地址</button>
          <button class="ghost small" @click="g.loadDisk()">刷新</button>
          <span class="dim small">
            用户名填群 ID <b>{{ chat.state.current?.id }}</b>，密码填你的 token ·
            第三方网盘挂载会在根目录里以「🔗 名称」列出来，可直接点进去
          </span>
        </div>

        <div class="dock-scan">
          <button class="ghost small" v-if="g.state.diskPath.length" @click="g.backFolder()">← 返回上级</button>
          <span class="dim small">
            {{ g.state.diskPath.length ? g.state.diskPath.map((p: any) => p.name).join(' / ') : '根目录' }}
            · {{ g.state.diskList.length }} 项
          </span>
          <span v-if="g.state.diskTotal" class="dim small">· 已用 {{ human(g.state.diskTotal.totalSize || g.state.diskTotal.usedSize || 0) }}</span>
          <span class="grow"></span>
          <input v-model="g.state.newFolder" placeholder="新文件夹名" style="max-width:160px" />
          <button class="ghost small" @click="g.createFolder(g.state.newFolder); g.state.newFolder = ''">建文件夹</button>
          <button class="ghost small" @click="g.loadDisk()">刷新</button>
        </div>
        <!-- 群里的第三方网盘挂载（比如 123云盘 WebDAV）——不在 file-list 里，要单独列 -->
        <div v-if="g.state.mounts.length" class="mounts">
          <div class="m-head">第三方网盘挂载（WebDAV）· {{ g.state.mounts.length }} 个</div>
          <div v-for="m in g.state.mounts" :key="m.id" class="m-item">
            <span class="d-ico"><Icon name="link" :size="15" /></span>
            <b>{{ m.name }}</b>
            <span class="dim small">{{ m.url }}{{ m.user ? ' · ' + m.user : '' }}</span>
            <span class="grow"></span>
            <!-- 走本站 WebDAV 网关：浏览器直接得到可点的目录页（不用手输账号密码） -->
            <button class="small" @click="openMount(m)">浏览</button>
            <a class="ghost small" :href="m.url" target="_blank" rel="noreferrer" title="原始地址（需自行认证）">原始</a>
          </div>
        </div>

        <!-- 挂载盘：**页内浏览**（跟云湖自带网盘一样的交互，不跳转新标签） -->
        <div v-if="g.state.mountView" class="mount-browse">
          <div class="mb-head">
            <button class="ghost small" @click="g.mountUp()" :disabled="!g.state.mountPath.length">← 上级</button>
            <b>{{ g.state.mountView.name }}</b>
            <span class="dim small">/{{ g.state.mountPath.join('/') }}</span>
            <span class="grow"></span>
            <button class="ghost small" @click="g.closeMount()">返回群网盘</button>
          </div>
          <div v-if="g.state.mountNeedPwd || g.state.mountError" class="mb-pwd">
            <span class="dim small">{{ g.state.mountError || '这个盘需要密码（云湖不把挂载密码下发到客户端，输一次即可）' }}</span>
            <input v-model="g.state.mountPwd" type="password" placeholder="盘密码" />
            <button class="small" @click="g.reloadMount()">进入</button>
          </div>
          <ul class="disk-list">
            <li v-for="e in g.state.mountEntries" :key="e.name">
              <span class="d-ico"><Icon :name="e.isDir ? 'folder' : 'page'" :size="15" /></span>
              <span class="d-name" @click="e.isDir ? g.mountEnter(e.name) : null">{{ e.name }}</span>
              <span class="dim small">{{ e.isDir ? '' : human(e.size) }}</span>
              <span class="grow"></span>
              <span class="dim small">{{ e.mtime }}</span>
              <a v-if="!e.isDir" class="ghost small" :href="mountFileUrl(e.name)" target="_blank" rel="noreferrer">下载</a>
            </li>
            <li v-if="!g.state.mountEntries.length" class="dim center">
              {{ g.state.mountLoading ? '加载中…' : '这个目录是空的（或需要密码）' }}
            </li>
          </ul>
        </div>

        <ul v-else class="disk-list">
          <li v-for="f in g.state.diskList" :key="f.id" @dblclick="f.isFolder && g.openFolder(f)">
            <span class="d-ico"><Icon :name="f.isFolder ? 'folder' : 'page'" :size="15" /></span>
            <span class="d-name" @click="f.isFolder && g.openFolder(f)">{{ f.name }}</span>
            <span class="dim small">{{ f.isFolder ? '' : (f.fileSize ? (f.fileSize / 1024).toFixed(1) + ' KB' : '') }}</span>
            <span class="grow"></span>
            <span class="dim small">{{ fmtTime(f.uploadTime) }}</span>
            <a v-if="!f.isFolder && f.fileUrl" class="ghost small" :href="resUrl(f.fileUrl)" target="_blank" rel="noreferrer" :download="f.name">下载</a>
          </li>
          <li v-if="!g.state.diskList.length" class="dim center">
            {{ g.state.diskLoading ? '加载中…' : '这个文件夹是空的' }}
          </li>
        </ul>
      </template>

      <!-- ===== 群标签 ===== -->
      <template v-else-if="g.state.dockTab === 'tags'">
        <div class="dock-scan">
          <input v-model="g.state.newTag" placeholder="新标签名称" @keyup.enter="g.createTag()" />
          <input type="color" v-model="g.state.newTagColor" class="color" />
          <button class="small" @click="g.createTag()">创建标签</button>
          <span class="grow"></span>
          <input v-model="g.state.tagSearch" placeholder="搜索标签…" style="max-width:180px" @keyup.enter="g.searchTags()" />
          <button class="ghost small" @click="g.searchTags()">搜索</button>
          <button class="ghost small" @click="g.loadTags()">刷新</button>
        </div>
        <div class="center" v-if="!g.state.tagsEnd">
          <button class="ghost small" :disabled="g.state.tagsLoading" @click="g.loadMoreTags()">
            {{ g.state.tagsLoading ? '加载中…' : '加载更多标签' }}
          </button>
        </div>
        <div class="taglist">
          <span v-for="t in g.state.tags" :key="t.id" class="tag">
            <i class="dotc" :style="{ background: t.color || '#888' }"></i>
            {{ t.tag }}
            <small v-if="t.desc" class="dim">{{ t.desc }}</small>
            <button class="tag-x" @click="g.removeTag(t)">×</button>
          </span>
          <span v-if="!g.state.tags.length" class="dim small">
            {{ g.state.tagsLoading ? '加载中…' : '本群还没有标签' }}
          </span>
        </div>

        <!-- 给成员打标签 -->
        <div class="tagmember" v-if="g.state.tagMemberFor">
          <b>给「{{ g.state.tagMemberFor.name }}」打标签</b>
          <div class="taglist mt-sm">
            <label v-for="t in g.state.tags" :key="t.id" class="tag-pick">
              <input type="checkbox" :value="t.id"
                     :checked="g.state.memberTagIds.includes(t.id)"
                     @change="(e: any) => {
                       const i = g.state.memberTagIds.indexOf(t.id)
                       if (e.target.checked && i < 0) g.state.memberTagIds.push(t.id)
                       if (!e.target.checked && i >= 0) g.state.memberTagIds.splice(i, 1)
                     }" />
              <i class="dotc" :style="{ background: t.color || '#888' }"></i>{{ t.tag }}
            </label>
          </div>
          <div class="mt-sm">
            <button class="small" @click="g.saveMemberTags()">保存</button>
            <button class="ghost small" @click="g.state.tagMemberFor = null">取消</button>
          </div>
        </div>
      </template>

      <!-- ===== 所有会话的看板（含每个机器人的）===== -->
      <template v-else>
        <div class="dock-scan">
          <button class="ghost small" :disabled="g.state.scanning" @click="g.scanAllBoards()">
            {{ g.state.scanning ? `扫描中 ${g.state.scanProgress}` : '扫描全部会话的看板' }}
          </button>
          <span class="dim small">共 {{ g.state.allBoards.length }} 个有看板的会话</span>
        </div>
        <div v-for="it in g.state.allBoards" :key="it.chat.id" class="allboard">
          <div class="ab-head" @click="it.open = !it.open">
            <b>{{ it.chat.name }}</b>
            <span class="dim small">来自 {{ it.board.botName || it.board.botId }}</span>
            <span class="grow"></span>
            <span class="dim small">{{ it.open ? '收起' : '展开' }}</span>
          </div>
          <div v-show="it.open" class="ab-body rich" v-html="boardHtmlOf(it.board)"></div>
        </div>
        <div v-if="!g.state.allBoards.length && !g.state.scanning" class="dim center">
          点上面的按钮扫描一次
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 全屏独立界面：不再挤在输入框上面 */
.dock {
  /* 在「右侧内容区」内铺满（.page-area 是定位父级）：
     既不盖左边导航栏，也不会像 fixed 全屏那样飘在整个窗口上面 */
  position: absolute; inset: 0; z-index: 30; background: var(--bg);
  display: flex; flex-direction: column;
  animation: dock-in .16s ease-out;
}
@keyframes dock-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.dock-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 13px;
  border-bottom: 1px solid var(--line); background: var(--card);
}
.dock-head b { font-size: 14px; }
.dock-head .grow { flex: 1; }
.dock-head .owner { display: inline-flex; align-items: center; gap: 4px; color: var(--fg2); }
.dock-head .owner img { width: 16px; height: 16px; border-radius: 50%; }
.bot-sel { font-size: 12px; padding: 3px 6px; max-width: 170px; }
.dock-body { flex: 1; overflow: auto; padding: 14px 18px; }
.dock-body .rich :deep(img) { max-width: 100%; border-radius: 8px; }
.dock-body .rich :deep(a) { color: var(--acc); }
.dock-body .rich :deep(h1), .dock-body .rich :deep(h2), .dock-body .rich :deep(h3) { margin: 6px 0; }
.dock-tabs {
  display: flex; gap: 5px; align-items: center; flex-wrap: nowrap;
  overflow-x: auto; overflow-y: hidden; max-width: 100%;
  scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
.dock-tabs::-webkit-scrollbar { display: none; }
.dock-tabs > * { flex: 0 0 auto; }
.dock-title { flex: 0 0 auto; }
.dock-exit { color: var(--err); border-color: color-mix(in srgb, var(--err) 35%, transparent); }
.dock-exit:hover { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }
.dock-head .grow { flex: 1; }
.dock-tabs .on { background: var(--acc-soft); border-color: var(--acc); color: var(--acc); }
.dock-tabs button { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; font-size: 12px; }
.gp-search { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.gp-search input { flex: 1; }
.dock-members { list-style: none; margin: 0; padding: 0; }
.dock-members li { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-bottom: 1px solid var(--line); font-size: 13px; }
.dock-members img { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; background: var(--card2); }
.dock-members .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.dock-members .grow { flex: 1; }
.role { font-style: normal; font-size: 10px; border-radius: 5px; padding: 1px 5px; }
.role.owner { background: #d4a01722; color: #d4a017; }
.role.admin { background: var(--acc-soft); color: var(--acc); }
.role.gag { background: color-mix(in srgb, var(--err) 16%, transparent); color: var(--err); }
.gag-sel { font-size: 12px; padding: 3px 6px; }
.ghost.danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 35%, transparent); }
.center { justify-content: center; text-align: center; padding: 4px 0; }
.dock-scan { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.allboard { border: 1px solid var(--line); border-radius: 9px; margin-bottom: 8px; overflow: hidden; }
.ab-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer; background: var(--card2); font-size: 13px; }
.ab-head .grow { flex: 1; }
.ab-body { padding: 12px; max-height: 46vh; overflow: auto; }
.ab-body :deep(img) { max-width: 100%; border-radius: 8px; }
.taglist { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.color { width: 38px; height: 32px; padding: 2px; flex: 0 0 auto; }
.dotc { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 4px; }
.tag-pick { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; }
.board-src {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line);
  font-size: 12.5px; color: var(--fg2);
}
.board-src img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.board-src .grow { flex: 1; }
.ginfo-top { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.ginfo-top img { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; background: var(--card2); }
.ginfo-name { font-size: 16px; font-weight: 600; }
.ginfo-grid { display: flex; flex-direction: column; gap: 2px; }
.wd-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; font-size: 12.5px; background: var(--card2); }
.wd-bar code { font-size: 12px; background: var(--card); padding: 2px 6px; border-radius: 5px; }
.mount-browse { margin-bottom: 14px; }
.mb-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.mb-head .grow { flex: 1; }
.mb-pwd { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card2); }
.mounts { margin-bottom: 14px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.m-head { font-size: 12.5px; color: var(--fg2); margin-bottom: 6px; }
.m-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
.m-item .grow { flex: 1; }
.disk-list { list-style: none; margin: 0; padding: 0; }
.disk-list li { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--line); font-size: 13px; }
.disk-list .d-ico { font-size: 18px; }
.disk-list .d-name { cursor: pointer; }
.disk-list .d-name:hover { color: var(--acc); }
.disk-list .grow { flex: 1; }
.gp-results { list-style: none; margin: 0; padding: 0; }
.gp-results li { padding: 8px 6px; border-bottom: 1px solid var(--line); }
.r-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.r-text { font-size: 13px; color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tagmember { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 10px; }
</style>
