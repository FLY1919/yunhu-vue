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
import { inject, computed, ref, reactive, watch, nextTick } from 'vue'
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
  // 新标签页没有 Basic 认证上下文 → 带 token query（网关支持），否则 401「打不开」
  const token = ctx.api?.token || ''
  return `${location.origin}/webdav/${gid}/@mount/${mid}/${p}?token=${encodeURIComponent(token)}`
}

/** 定位文件：一律走系统资源管理器（server /local-open 下载缓存 + explorer /select）；
 *  挂载盘文件用网关地址，云盘文件用 fileUrl */
async function locateFile(name: string) {
  let url = ''
  if (g.state.mountView) {
    url = mountFileUrl(name)
  } else {
    const f = (g.state.diskList || []).find((x: any) => x.name === name)
    url = f?.fileUrl ? resUrl(f.fileUrl) : ''
  }
  if (!url) { ctx.ui?.toast?.('找不到该文件地址', 'warn'); return }
  try {
    const r = await fetch('/local-open?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(name))
    const j = await r.json().catch(() => null)
    if (!j?.ok) ctx.ui?.toast?.('打开失败：' + (j?.msg || r.status), 'error')
  } catch (e: any) { ctx.ui?.toast?.('打开失败：' + e.message, 'error') }
}

/** 群网盘重命名（/v1/disk/rename，审计补齐 UI；内联输入框，不用原生 prompt） */
const renaming = ref<{ id: number; name: string; objectType?: number } | null>(null)
function renameDisk(f: any) { renaming.value = { id: f.id, name: f.name, objectType: f.objectType ?? 2 } }
async function renameDiskOk() {
  const rn = renaming.value
  renaming.value = null
  if (!rn || !rn.name.trim()) return
  try {
    await ctx.api.diskRename(rn.id, rn.objectType ?? 2, rn.name.trim())
    ctx.ui?.toast?.('已重命名', 'success')
    g.loadDisk()
  } catch (e: any) { ctx.ui?.toast?.('重命名失败：' + e.message, 'error') }
}

/** 群网盘删除（/v1/disk/remove） */
async function delDisk(f: any) {
  if (!(await ctx.ui?.confirm?.('删除文件', `确定删除「${f.name}」？`, { danger: true }))) return
  try {
    await ctx.api.diskDelete(f.id, f.objectType ?? (f.isFolder ? 1 : 2))
    ctx.ui?.toast?.('已删除', 'success')
    g.loadDisk()
  } catch (e: any) { ctx.ui?.toast?.('删除失败：' + e.message, 'error') }
}

/* ---- 群管理补齐：设/撤管理员（/v1/group/manage-setting，仅群主） ---- */
const isOwner = computed(() => {
  const me = ctx.auth?.state?.user?.id
  const info = g.state.info
  return !!me && (info?.owner === me || info?.createBy === me)
})
async function setAdmin(m: any) {
  const gid = chat.state.current?.id
  if (!gid) return
  const next = m.level >= 2 ? 0 : 2
  try {
    await ctx.api.setManageSetting(gid, m.id, next)
    ctx.ui?.toast?.(next === 2 ? `已设 ${m.name} 为管理员` : `已撤销 ${m.name} 的管理员`, 'success')
    m.level = next
  } catch (e: any) { ctx.ui?.toast?.('设置失败：' + e.message, 'error') }
}

/** 搜索、引用与通知共用定位流程，避免慢请求覆盖新会话。 */
async function jumpToMsg(r: any) {
  const current = chat.state.current
  if (!current || !r?.id) return
  g.closeDock()
  await chat.locate(current, r.id)
}

/* ---- 成员「管理」弹窗（居中模态：发言权限/成员角色/其它操作分组，不再只是行内禁言小浮层） ---- */
const mgmt = ref<any>(null)
function openMemberMgmt(m: any) { mgmt.value = m }
function closeMgmt() { mgmt.value = null }
/** 弹窗内各操作执行后关闭弹窗 */
async function mgmtGag(seconds: number) { const m = mgmt.value; closeMgmt(); if (m) await g.gag(m, seconds) }
async function mgmtSetAdmin() { const m = mgmt.value; closeMgmt(); if (m) await setAdmin(m) }
function mgmtTag() { const m = mgmt.value; closeMgmt(); if (m) { g.setDockTab('tags'); g.openTagMember(m) } }
function mgmtProfile() { const m = mgmt.value; closeMgmt(); if (m) g.openProfile(m) }
async function mgmtKick() { const m = mgmt.value; closeMgmt(); if (m) await g.kick(m) }

/* ---- 群主管理：编辑群资料 / 消息自动删除 / 入群口令 ---- */
const gEdit = reactive({ name: '', intro: '', autoDel: 0, keyword: '' })
watch(() => g.state.info, (info) => {
  if (!info) return
  gEdit.name = info.name || ''
  gEdit.intro = info.introduction || ''
  gEdit.autoDel = info.autoDeleteMessage || 0
}, { immediate: true })
async function saveGroupEdit() {
  const gid = chat.state.current?.id
  if (!gid) return
  try {
    await ctx.api.editGroup(gid, { name: gEdit.name.trim(), introduction: gEdit.intro.trim() })
    ctx.ui?.toast?.('群资料已保存', 'success')
    g.loadInfo()
  } catch (e: any) { ctx.ui?.toast?.('保存失败：' + e.message, 'error') }
}
async function saveAutoDel() {
  const gid = chat.state.current?.id
  if (!gid) return
  try {
    await ctx.api.editAutoDeleteMessage(gid, gEdit.autoDel)
    ctx.ui?.toast?.('自动删除设置已保存', 'success')
  } catch (e: any) { ctx.ui?.toast?.('保存失败：' + e.message, 'error') }
}
async function saveKeyword() {
  const gid = chat.state.current?.id
  if (!gid) return
  try {
    await ctx.api.editGroupKeyword(gid, gEdit.keyword.trim())
    ctx.ui?.toast?.('群口令已保存', 'success')
  } catch (e: any) { ctx.ui?.toast?.('保存失败：' + e.message, 'error') }
}

/* ---- 第三方网盘挂载增删（mount-setting create/delete，审计补齐 UI） ---- */
const mountForm = ref(false)
const mfBusy = ref(false)
const mf = ref({ name: '', url: '', user: '', pass: '', root: '' })
async function addMount() {
  const cur = chat.state.current
  if (!cur || mfBusy.value) return
  mfBusy.value = true
  try {
    await ctx.api.mountCreate(cur.id, {
      name: mf.value.name.trim(), url: mf.value.url.trim(),
      user: mf.value.user.trim(), pass: mf.value.pass, root: mf.value.root.trim(),
    })
    ctx.ui?.toast?.('挂载已添加', 'success')
    mf.value = { name: '', url: '', user: '', pass: '', root: '' }
    mountForm.value = false
    g.loadDisk()
  } catch (e: any) { ctx.ui?.toast?.('添加失败：' + e.message, 'error') }
  finally { mfBusy.value = false }
}
async function delMount(m: any) {
  if (!(await ctx.ui?.confirm?.('删除挂载', `确定删除挂载「${m.name}」？`, { danger: true }))) return
  try {
    await ctx.api.mountDelete(m.id)
    ctx.ui?.toast?.('挂载已删除', 'success')
    g.loadDisk()
  } catch (e: any) { ctx.ui?.toast?.('删除失败：' + e.message, 'error') }
}

/**
 * 上传文件到群网盘当前目录：复用 server 的 WebDAV PUT 网关
 * （user=群ID, pass=token；网关内部走七牛 + /v1/disk/upload-file）。
 */
const diskUploading = ref(false)
async function uploadDisk(e: any) {
  const fs: File[] = Array.from(e.target?.files || [])
  e.target.value = ''
  const gid = chat.state.current?.id
  const token = ctx.api?.token
  if (!gid || !token) { ctx.ui?.toast?.('未登录，无法上传', 'warn'); return }
  diskUploading.value = true
  let ok = 0
  for (const f of fs) {
    // 40MB 上限（与聊天上传一致）
    if (f.size > 40 * 1024 * 1024) { ctx.ui?.toast?.(`「${f.name}」超过 40MB 限制`, 'error'); continue }
    const path = [...g.state.diskPath.map((p: any) => p.name), f.name].map(encodeURIComponent).join('/')
    try {
      const r = await fetch(`/webdav/${gid}/${path}`, {
        method: 'PUT',
        headers: {
          authorization: 'Basic ' + btoa(`${gid}:${token}`),
          'content-type': f.type || 'application/octet-stream',
        },
        body: f,
      })
      if (r.ok || r.status === 201) ok++
      else ctx.ui?.toast?.(`「${f.name}」上传失败：HTTP ${r.status}`, 'error')
    } catch (err: any) { ctx.ui?.toast?.(`「${f.name}」上传失败：${err.message}`, 'error') }
  }
  diskUploading.value = false
  if (ok) { ctx.ui?.toast?.(`已上传 ${ok} 个文件`, 'success'); g.loadDisk() }
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
    () => navigator.clipboard.writeText(webdavUrl.value).then(() => ctx.ui?.toast?.('地址已复制', 'success')).catch(() => ctx.ui?.toast?.('复制失败', 'error')))
}

/** 把看板 HTML 净化后返回（多份看板共用） */
// 看板内容可能是 markdown 也可能是 HTML，交给 renderRich 判断
function boardHtmlOf(b: any) { return b?.content ? renderRich(b.content) : '' }
</script>

<template>
  <!-- 遮罩：点空白处关闭 dock（与所有弹窗行为一致） -->
  <div v-if="g.state.dockOpen" class="dock-mask" @click.self="g.closeDock()">
  <div class="dock">
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
      </div>

      <span class="grow"></span>
      <button class="ghost small" title="刷新"
              @click="g.state.dockTab === 'board' ? g.loadBoard() : g.state.dockTab === 'disk' ? g.loadDisk() : g.scanAllBoards()">
        <Icon name="refresh" :size="13" />
      </button>
      <button class="ghost small dock-x" title="关闭" @click="g.closeDock()">×</button>
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
            <span class="nm" @click="g.openProfile(m)">{{ m.name }}</span>
            <em v-if="m.level >= 100" class="role owner">群主</em>
            <em v-else-if="m.level >= 2" class="role admin">管理员</em>
            <em v-if="m.isGag" class="role gag">已禁言</em>
            <span class="grow"></span>
            <!-- 「管理」按钮：打开居中弹窗（发言权限/角色/资料/踢出集中一处，一目了然） -->
            <button class="ghost small" @click.stop="openMemberMgmt(m)">管理</button>
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
          <li v-for="r in g.state.results" :key="r.id" class="r-hit" title="点击跳转到该消息" @click="jumpToMsg(r)">
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
            <div class="kv"><span class="k">创建时间</span><span class="dim">云湖接口不返回该字段</span></div>
          </div>
          <!-- 群主管理区（审计补齐：编辑群资料/自动删除/群口令） -->
          <template v-if="isOwner">
            <div class="ginfo-sec">群主管理</div>
            <div class="ginfo-row">
              <input v-model="gEdit.name" placeholder="群名称" />
              <textarea v-model="gEdit.intro" rows="3" placeholder="群公告/简介（可多行编辑）"></textarea>
              <button class="ghost small" @click="saveGroupEdit">保存群资料</button>
            </div>
            <div class="ginfo-row">
              <select v-model.number="gEdit.autoDel">
                <option :value="0">不自动删除消息</option>
                <option :value="3600">1 小时后删除</option>
                <option :value="86400">1 天后删除</option>
                <option :value="604800">7 天后删除</option>
              </select>
              <button class="ghost small" @click="saveAutoDel">保存</button>
              <input v-model="gEdit.keyword" placeholder="入群口令（可空）" />
              <button class="ghost small" @click="saveKeyword">保存口令</button>
            </div>
          </template>
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
            第三方网盘挂载会在根目录里以「<Icon name="link" :size="14" class="inline-icon" aria-hidden="true" /> 名称」列出来，可直接点进去
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
          <label class="ghost small file" title="上传到群网盘当前目录">
            <input type="file" multiple hidden @change="uploadDisk" />上传文件
          </label>
          <button class="ghost small" @click="g.loadDisk()">刷新</button>
        </div>
        <!-- 群里的第三方网盘挂载（比如 123云盘 WebDAV）——不在 file-list 里，要单独列 -->
        <div class="mounts">
          <div class="m-head">
            第三方网盘挂载（WebDAV）· {{ g.state.mounts.length }} 个
            <span class="grow"></span>
            <button class="ghost small" @click="mountForm = !mountForm">{{ mountForm ? '收起' : '+ 添加挂载' }}</button>
          </div>
          <div v-if="mountForm" class="m-form">
            <input v-model="mf.name" placeholder="名称" />
            <input v-model="mf.url" placeholder="WebDAV 地址 https://…" />
            <input v-model="mf.user" placeholder="账号（可空）" />
            <input v-model="mf.pass" type="password" placeholder="密码（可空）" />
            <input v-model="mf.root" placeholder="根路径（可空，如 /dav）" />
            <button class="ghost small" :disabled="mfBusy || !mf.name.trim() || !mf.url.trim()" @click="addMount">保存</button>
          </div>
          <div v-for="m in g.state.mounts" :key="m.id" class="m-item">
            <span class="d-ico"><Icon name="link" :size="15" /></span>
            <b>{{ m.name }}</b>
            <span class="dim small">{{ m.url }}{{ m.user ? ' · ' + m.user : '' }}</span>
            <span class="grow"></span>
            <!-- 走本站 WebDAV 网关：浏览器直接得到可点的目录页（不用手输账号密码） -->
            <button class="small" @click="openMount(m)">浏览</button>
            <button class="ghost small icon-btn" title="删除挂载" @click="delMount(m)"><Icon name="trash" :size="13" /></button>
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
            <li v-for="e in g.state.mountEntries" :key="e.name" :data-fn="e.name">
              <span class="d-ico"><Icon :name="e.isDir ? 'folder' : 'page'" :size="15" /></span>
              <span class="d-name" @click="e.isDir ? g.mountEnter(e.name) : locateFile(e.name)">{{ e.name }}</span>
              <span class="dim small">{{ e.isDir ? '' : human(e.size) }}</span>
              <span class="grow"></span>
              <span class="dim small">{{ e.mtime }}</span>
              <template v-if="!e.isDir">
                <a class="ghost small" :href="mountFileUrl(e.name)" target="_blank" rel="noreferrer">打开</a>
                <button class="ghost small icon-btn" title="在列表中定位" @click="locateFile(e.name)"><Icon name="search" :size="13" /></button>
              </template>
            </li>
            <li v-if="!g.state.mountEntries.length" class="dim center">
              {{ g.state.mountLoading ? '加载中…' : '这个目录是空的（或需要密码）' }}
            </li>
          </ul>
        </div>

        <ul v-else class="disk-list">
          <li v-for="f in g.state.diskList" :key="f.id" :class="{ hit: g.locateHighlight?.name && f.name === g.locateHighlight.name }"
              @dblclick="f.isFolder && g.openFolder(f)">
            <span class="d-ico"><Icon :name="f.isFolder ? 'folder' : 'page'" :size="15" /></span>
            <template v-if="renaming?.id === f.id">
              <input v-model="renaming.name" class="disk-rename" @keyup.enter="renameDiskOk" @keyup.esc="renaming = null" autofocus />
              <button class="ghost small" @click="renameDiskOk">确定</button>
            </template>
            <span v-else class="d-name" @click="f.isFolder && g.openFolder(f)">{{ f.name }}</span>
            <span class="dim small">{{ f.isFolder ? '' : (f.fileSize ? (f.fileSize / 1024).toFixed(1) + ' KB' : '') }}</span>
            <span class="grow"></span>
            <span class="dim small">{{ fmtTime(f.uploadTime) }}</span>
            <button class="ghost small icon-btn" title="重命名" @click="renameDisk(f)"><Icon name="pencil" :size="13" /></button>
            <button class="ghost small icon-btn" title="删除" @click="delDisk(f)"><Icon name="trash" :size="13" /></button>
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
  </div>

  <!-- 成员「管理」弹窗：居中模态，分组展示所有管理动作（不再只是禁言小浮层） -->
  <Teleport to="body">
    <div v-if="mgmt" class="mgmt-mask" @click.self="closeMgmt">
      <div class="mgmt-box">
        <div class="mgmt-head">
          <img :src="mgmt.avatar ? resUrl(mgmt.avatar) : fallbackAvatar(mgmt.name)"
               @error="(e: any) => (e.target.src = fallbackAvatar(mgmt.name))" alt="" />
          <div class="mgmt-hi">
            <b>{{ mgmt.name }}</b>
            <span class="dim small">
              {{ mgmt.level >= 100 ? '群主' : mgmt.level >= 2 ? '管理员' : '成员' }}
              <template v-if="mgmt.isGag"> · 已禁言</template>
            </span>
          </div>
          <span class="grow"></span>
          <button class="mgmt-x" title="关闭" @click="closeMgmt">×</button>
        </div>

        <div class="mgmt-body">
          <!-- 发言权限（禁言） -->
          <div class="mgmt-sec">发言权限</div>
          <div class="mgmt-chips">
            <button v-for="o in g.GAG_OPTIONS" :key="o.value" class="ghost small"
                    :class="{ on: mgmt.isGag && o.value !== 0 }"
                    :disabled="mgmt.level >= 100" @click="mgmtGag(o.value)">{{ o.label }}</button>
          </div>
          <p v-if="mgmt.level >= 100" class="dim small">群主不可被禁言。</p>

          <!-- 成员角色（仅群主可改，且不能改自己/群主） -->
          <template v-if="isOwner && mgmt.level < 100">
            <div class="mgmt-sec">成员角色</div>
            <div class="mgmt-chips">
              <button class="ghost small" @click="mgmtSetAdmin">
                {{ mgmt.level >= 2 ? '取消管理员' : '设为管理员' }}
              </button>
            </div>
          </template>

          <!-- 其它操作 -->
          <div class="mgmt-sec">其它操作</div>
          <div class="mgmt-chips">
            <button class="ghost small" @click="mgmtProfile">查看资料</button>
            <button v-if="g.state.tags.length" class="ghost small" @click="mgmtTag">打群标签</button>
            <button v-if="mgmt.level < 100" class="ghost small danger" @click="mgmtKick">踢出群聊</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 全屏独立界面：不再挤在输入框上面 */
/* 遮罩：dock 打开时铺满，点空白关闭 */
.dock-mask { position: fixed; inset: 0; z-index: 74; background: rgba(0, 0, 0, .3); }
.dock {
  /* 居中大弹窗（用户偏好）：不透明、层级 75（高于三栏与 rail 菜单，低于对话框 80+） */
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(860px, 94vw); height: min(640px, 90vh);
  z-index: 75; background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .5);
  display: flex; flex-direction: column; overflow: hidden;
}
.dock-x {
  width: 26px; height: 26px; padding: 0; border-radius: 7px; font-size: 17px; line-height: 1;
  display: grid; place-items: center; flex: 0 0 auto;
}
.dock-x:hover { background: var(--card2); color: var(--err); }
.dock-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 13px;
  border-bottom: 1px solid var(--line); background: var(--card);
}
.dock-head b { font-size: 14px; }
.dock-head .grow { flex: 1; }
.dock-head .owner { display: inline-flex; align-items: center; gap: 4px; color: var(--fg2); }
.dock-head .owner img { width: 16px; height: 16px; border-radius: 50%; }
.bot-sel { font-size: 12px; padding: 3px 6px; max-width: 170px; }
.dock-body { flex: 1; min-height: 320px; overflow: auto; padding: 14px 18px; background: var(--card); }
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
.dock-tabs button { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; font-size: 12px; height: 28px; }
/* 头部所有按钮（页签/刷新/×）统一 28px 高，与聊天标题栏按钮同尺寸协调 */
.dock-head > button { height: 28px; min-width: 28px; display: inline-grid; place-items: center; padding: 0 6px; }
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
.gp-results .r-hit { cursor: pointer; border-radius: 8px; padding: 6px 8px; }
.gp-results .r-hit:hover { background: color-mix(in srgb, var(--acc) 14%, transparent); }
/* 成员「管理」弹窗：居中模态，明显分组（发言权限/角色/其它） */
.mgmt-mask {
  position: fixed; inset: 0; z-index: 88; background: rgba(0, 0, 0, .5);
  display: grid; place-items: center; backdrop-filter: blur(2px);
}
.mgmt-box {
  width: min(360px, 92vw); max-height: 84vh; overflow: auto;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .5); padding: 4px 0 8px;
}
.mgmt-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.mgmt-head img { width: 40px; height: 40px; border-radius: 10px; object-fit: cover; background: var(--card2); }
.mgmt-hi { min-width: 0; }
.mgmt-hi b { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mgmt-head .grow { flex: 1; }
.mgmt-x { background: transparent; color: var(--fg2); font-size: 20px; line-height: 1; padding: 0 6px; }
.mgmt-x:hover { color: var(--fg); }
.mgmt-body { padding: 10px 14px; }
.mgmt-sec { font-size: 11.5px; color: var(--fg2); margin: 12px 0 7px; }
.mgmt-sec:first-child { margin-top: 2px; }
.mgmt-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.mgmt-chips .ghost.on { background: var(--acc); color: #fff; border-color: transparent; }
.mgmt-body .dim.small { margin-top: 6px; }
/* 上传文件 label 按钮：补边框（label 不吃 button 样式） */
label.file, .dock label.ghost {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  padding: 5px 11px; font-size: 12.5px; border-radius: 12px;
  border: 1px solid var(--line); background: transparent; color: var(--fg);
}
label.file:hover, .dock label.ghost:hover { background: var(--card2); }
.gp-results .r-text { white-space: pre-wrap; word-break: break-word; }
.ginfo-grid { display: flex; flex-direction: column; gap: 2px; }
.ginfo-sec { font-size: 12px; color: var(--fg2); margin: 12px 0 6px; border-top: 1px solid var(--line); padding-top: 10px; }
.ginfo-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.ginfo-row input, .ginfo-row select {
  flex: 1; min-width: 90px; background: var(--card2); border: 1px solid var(--line);
  border-radius: 8px; color: var(--fg); padding: 6px 9px; font-size: 12.5px; outline: none;
}
.wd-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; font-size: 12.5px; background: var(--card2); }
.wd-bar code { font-size: 12px; background: var(--card); padding: 2px 6px; border-radius: 5px; }
.mount-browse { margin-bottom: 14px; }
.mb-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.mb-head .grow { flex: 1; }
.mb-pwd { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card2); }
.mounts { margin-bottom: 14px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.m-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fg2); margin-bottom: 6px; }
.m-head .grow { flex: 1; }
.m-form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.m-form input {
  background: var(--card2); border: 1px solid var(--line); border-radius: 8px;
  color: var(--fg); padding: 6px 10px; font-size: 12.5px; outline: none;
}
.m-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
.m-item .grow { flex: 1; }
.disk-rename {
  flex: 1; min-width: 0; background: var(--card2); border: 1px solid var(--acc);
  border-radius: 7px; color: var(--fg); padding: 4px 8px; font-size: 13px; outline: none;
}
.disk-list { list-style: none; margin: 0; padding: 0; }
.disk-list li { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--line); font-size: 13px; }
.disk-list li.hit { background: var(--acc-soft, var(--card2)); outline: 1px solid var(--acc); border-radius: 6px; }
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
