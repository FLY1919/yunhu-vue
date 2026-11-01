/**
 * api 服务插件
 * 提供 ctx.api：云湖 v1 接口封装（protobuf / JSON 混合）
 * 文档：https://github.com/yh-Tpdev/yhchatAPI  ·  https://yh-api.yyyyt.top
 */
import type { Context } from '../core/context'
import * as pb from '../core/pb'

const DEFAULT_BASE = 'https://chat-go.jwzhd.com'

function resolveBase() {
  if (typeof window === 'undefined') return DEFAULT_BASE
  return new URLSearchParams(location.search).get('base') || window.YUNHU_BASE || '/api'
}

/* MsgContent 字段编号（见 full.proto#MsgContent） */
const CONTENT_FIELD = {
  text: 1, buttons: 2, image_url: 3, file_name: 4, file_url: 5, mentioned_id: 6,
  form: 7, quote_msg_text: 8, image: 9, post_id: 10, post_title: 11, post_content: 12,
  post_content_type: 13, expression_id: 15, quote_image_url: 16, quote_image_name: 17,
  file_size: 18, video_url: 19, video_time: 20, audio_url: 21, audio_time: 22,
  quote_video_url: 23, quote_video_time: 24, sticker_item_id: 25, sticker_pack_id: 26,
  room_name: 29, call_status_text: 32, width: 33, height: 34, tip: 37,
}
const NUMERIC = new Set(['mentioned_id', 'file_size', 'video_time', 'audio_time', 'quote_video_time',
  'sticker_item_id', 'sticker_pack_id', 'width', 'height', 'post_content_type'])

function encodeContent(obj = {}) {
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    const f = CONTENT_FIELD[k]
    if (!f || v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) { for (const it of v) parts.push(pb.fStr(f, String(it))) }
    else if (NUMERIC.has(k)) parts.push(pb.fNum(f, Number(v)))
    else parts.push(pb.fStr(f, String(v)))
  }
  return pb.build(parts)
}

function decodeContent(bytes) {
  const c = bytes && bytes.length ? pb.decode(bytes) : {}
  const s = f => pb.str(c, f)
  const n = f => pb.num(c, f)
  return {
    text: s(1), buttons: s(2), image_url: s(3), file_name: s(4), file_url: s(5),
    mentioned_id: pb.list(c, 6).map(b => new TextDecoder().decode(b)),
    form: s(7), quote_msg_text: s(8), image: s(9), sticker_url: s(9),
    post_id: s(10), post_title: s(11), post_content: s(12), post_content_type: n(13),
    expression_id: s(15), quote_image_url: s(16), file_size: n(18),
    video_url: s(19), video_time: n(20), audio_url: s(21), audio_time: n(22),
    sticker_item_id: n(25), sticker_pack_id: n(26),
    room_name: s(29), call_status_text: s(32), width: n(33), height: n(34), tip: s(37),
    _raw: c,
  }
}

export const apiPlugin = {
  name: 'api',
  provide: ['api'],

  apply(ctx: Context, config: any = {}) {
    const base = (config.base || resolveBase()).replace(/\/$/, '')
    let token = ''
    let routes = null

    interface RequestOptions { method?: string; body?: any; timeout?: number; authToken?: string; signal?: AbortSignal }
    // 默认超时 60s（原 20s 在高负载机器+慢上游时批量上传表情会误 abort，
    // 用户实测连发多张收藏报「signal is aborted without reason」）
    async function request(path: string, { method = 'POST', body, timeout = 60000, authToken = token, signal }: RequestOptions = {}) {
      const headers: Record<string, string> = {}
      if (authToken) headers.token = authToken
      // 前端再保险一层：接口请求禁用缓存
      const init: RequestInit = { method, headers, cache: 'no-store' }
      if (body instanceof Uint8Array) {
        headers['Content-Type'] = 'application/x-protobuf'
        init.body = body as any
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const ctrl = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      let cancel: () => void
      const interrupted = new Promise<never>((_, reject) => {
        cancel = () => { ctrl.abort(); reject(new DOMException('请求已取消', 'AbortError')) }
        timer = setTimeout(() => {
          ctrl.abort()
          reject(new DOMException('请求超时', 'TimeoutError'))
        }, timeout)
        signal?.addEventListener('abort', cancel, { once: true })
      })
      init.signal = ctrl.signal
      try {
        if (signal?.aborted) cancel()
        return await Promise.race([interrupted, (async () => {
          if (ctrl.signal.aborted) throw new DOMException('请求已取消', 'AbortError')
          const res = await fetch(base + path, init)
          const buf = new Uint8Array(await res.arrayBuffer())
          const text = new TextDecoder().decode(buf).trimStart()
          const isJson = /json/i.test(res.headers.get('content-type') || '') || text.startsWith('{')
          const json = isJson ? JSON.parse(text) : undefined
          if (!res.ok) throw Object.assign(new Error(json?.msg || json?.message || `请求失败（HTTP ${res.status}）`), { status: res.status })
          if (json) return { json, http: res.status }
          if (text.startsWith('<')) throw new Error('服务器未返回有效的 API 数据')
          return { pb: pb.decode(buf), raw: buf, http: res.status }
        })()])
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    }

    function assertOk(r) {
      if (r.json) {
        if (r.json.code !== 1) throw new Error(r.json.msg || `请求失败(${r.json.code})`)
        return r.json
      }
      // protobuf：Status.code = 字段2
      const st = pb.msg(r.pb, 1)
      const code = pb.num(st, 2)
      if (code && code !== 1) throw new Error(pb.str(st, 3) || `请求失败(${code})`)
      return r
    }

    const api = {
      base,
      get token() { return token },
      setToken(t) { token = t || '' },
      request,

      async login(email, password, deviceId, platform = 'web') {
        const r = await request('/v1/user/email-login', { body: { email, password, deviceId, platform }, authToken: '' })
        assertOk(r)
        const t = r.json?.data?.token
        if (!t) throw new Error('未返回 token')
        return t
      },

      // An explicit token validates another local account without replacing the live connection's credentials.
      async self(authToken: string = token) {
        const r = assertOk(await request('/v1/user/info', { method: 'GET', authToken }))
        const d = pb.msg(r.pb, 2)
        const coinRaw = pb.raw(d, 8)
        return {
          id: pb.str(d, 1), name: pb.str(d, 2) || '我', avatar: pb.str(d, 4),
          phone: pb.str(d, 6), email: pb.str(d, 7),
          coin: coinRaw && coinRaw.length === 8
            ? new DataView(coinRaw.buffer, coinRaw.byteOffset, 8).getFloat64(0, true) : 0,
          vip: pb.bool(d, 9),
          vipExpired: pb.num(d, 10),
          invitationCode: pb.str(d, 12),
        }
      },

      /** 资源路由 + websocket 路由 */
      async distribution(force?: boolean) {
        if (routes && !force) return routes
        const raw = await request('/v1/misc/configure-distribution', { method: 'GET' })
        assertOk(raw)
        routes = raw.json?.data || {}
        return routes
      },

      async stickyList({ timeout = 60000 } = {}) {
        const r = assertOk(await request('/v1/sticky/list', { body: {}, timeout }))
        return (r.data?.sticky || []).filter((x: any) => !x.delFlag).map((x: any) => ({
          id: String(x.chatId), type: Number(x.chatType), name: x.chatName,
          avatar: x.avatarUrl, pinned: true, stickyId: x.id, pinSort: Number(x.sort) || 0,
        }))
      },
      async setPinned(chatId: string, chatType: number, pinned: boolean) {
        return assertOk(await request(pinned ? '/v1/sticky/add' : '/v1/sticky/delete', { body: { chatId, chatType } }))
      },
      async conversations({ timeout = 60000 } = {}) {
        // 置顶是独立列表，不能从消息时间或未读数猜测。置顶接口失败不丢失普通列表。
        const [r, pins] = await Promise.all([
          request('/v1/conversation/list', { body: new Uint8Array(), timeout }).then(assertOk),
          api.stickyList({ timeout }).catch(() => null),
        ])
        const list = pb.each(r.pb, 2).map(d => ({
          id: pb.str(d, 1), type: pb.num(d, 2),
          name: pb.str(d, 3) || pb.str(d, 15) || pb.str(d, 1),
          remark: pb.str(d, 3), preview: pb.str(d, 4),
          unread: pb.num(d, 6), at: pb.bool(d, 7),
          noDisturb: pb.bool(d, 11),
          avatar: pb.str(d, 9), ts: pb.num(d, 5),
          ...(pins ? { pinned: false } : {}),
        }))
        for (const pin of pins || []) {
          const hit = list.find(c => c.id === pin.id && c.type === pin.type)
          if (hit) Object.assign(hit, { pinned: true, stickyId: pin.stickyId, pinSort: pin.pinSort })
          // 未出现在普通列表里的置顶会话也必须展示；免打扰待资料接口确认。
          else list.push({ ...pin, unread: 0, at: false, ts: 0, preview: '', noDisturb: undefined })
        }
        return list
      },

      async messages(chatId, chatType, count = 30, { timeout = 60000 } = {}) {
        const body = pb.build(pb.fNum(2, count), pb.fNum(4, chatType), pb.fStr(5, chatId))
        const r = assertOk(await request('/v1/msg/list-message', { body, timeout }))
        return pb.each(r.pb, 2).map(decodeMsg).sort((a, b) => a.ts - b.ts)
      },

      /** 通用发送：contentType + MsgContent 字段对象 */
      async send(chatId: string, chatType: number, contentType: number, content: Record<string, any> = {}, { msgId, quoteId }: { msgId?: string; quoteId?: string } = {}) {
        const id = msgId || newMsgId()
        const parts = [
          pb.fStr(2, id),
          pb.fStr(3, chatId),
          pb.fNum(4, chatType),
          pb.fBytes(5, encodeContent(content)),
          pb.fNum(6, contentType),
        ]
        // SendMsgRequest.quote_msg_id = 8；收到的 MsgData.quote_msg_id 才是 9。
        // 请求字段 9 是 Media 子消息，放入字符串会触发上游「请求参数错误」。
        if (quoteId) parts.push(pb.fStr(8, quoteId))
        assertOk(await request('/v1/msg/send-message', { body: pb.build(parts) }))
        return id
      },

      sendText: (c, t, text, o) => api.send(c, t, pb.ContentType.text, { text }, o),
      sendMarkdown: (c, t, text, o) => api.send(c, t, pb.ContentType.markdown, { text }, o),
      sendHtml: (c, t, text, o) => api.send(c, t, pb.ContentType.html, { text }, o),
      sendImage: (c, t, url, o) => api.send(c, t, pb.ContentType.image, { image_url: url }, o),

      /** 撤回（单条或多条）
       *  RecallMsg{ repeated string msg_id=2, chat_id=3, chat_type=4 }
       *  多条走 /v1/msg/recall-msg-batch */
      async recall(chatId: string, chatType: number, msgIds: string | string[]) {
        const ids = Array.isArray(msgIds) ? msgIds : [msgIds]
        if (!ids.length) return
        const body = pb.build(
          ...ids.map(id => pb.fStr(2, id)),
          pb.fStr(3, chatId),
          pb.fNum(4, chatType),
        )
        const path = ids.length > 1 ? '/v1/msg/recall-msg-batch' : '/v1/msg/recall-msg'
        const r = await request(path, { body })
        return assertOk(r)
      },

      /** 转发消息（JSON）：POST /v1/msg/msg-forward */
      async forward(msgId: string, chatType: number, targets: Array<{ id: string; type: number }>) {
        const r = await request('/v1/msg/msg-forward', {
          body: {
            msgId,
            chatType,
            receive: targets.map(t => ({ chatId: t.id, chatType: t.type })),
          },
        })
        return assertOk(r)
      },

      /* ================= 机器人资料 ================= */

      /**
       * 机器人资料：POST /v1/bot/bot-info  BotInfoRequest{ id=2 } → BotData
       * （机器人不是「用户」，get-user 会返回「该用户不存在」，必须走这个）
       */
      async botInfo(botId: string, { timeout = 60000 } = {}) {
        const r = assertOk(await request('/v1/bot/bot-info', { body: pb.build(pb.fStr(2, botId)), timeout }))
        const d = pb.msg(r.pb, 2)
        return {
          isBot: true,
          id: pb.str(d, 1),
          name: pb.str(d, 2),
          avatar: pb.str(d, 4),
          introduction: pb.str(d, 6),
          createBy: pb.str(d, 7),
          createTime: pb.num(d, 8),
          headcount: pb.num(d, 9),
          isPrivate: pb.bool(d, 10),
          isStopped: pb.bool(d, 11),
          autoAgree: pb.bool(d, 13),
          noDelete: pb.bool(d, 14),
          noDisturb: pb.bool(d, 15),
          pinned: pb.bool(d, 18),
          isDeleted: pb.bool(d, 19),
          groupLimit: pb.bool(d, 20),
        }
      },

      /* ================= 聊天背景 ================= */

      /** 背景设置列表 → [{ id, chatId, imgUrl, updateTime }]；chatId='all' 是全局 */
      async chatBackgroundList() {
        const r = await request('/v1/chat-background/list', { body: {} })
        assertOk(r)
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, chatId: x.chatId, imgUrl: x.imgUrl,
          updateTime: x.updateTime, createTime: x.createTime,
        }))
      },

      /** 设置聊天背景：url 是**文件名+扩展名**（不是我上传后的完整 key），chatId 填 all 就是全局 */
      async setChatBackground(userId: string, chatId: string, url: string) {
        return assertOk(await request('/v1/chat-background/edit', { body: { userId, chatId, url } }))
      },

      /**
       * ⚠️ 云湖**没有**删除背景的接口（试过 /delete /remove /del 全是 404）。
       * 要清除某条背景设置，请用 setChatBackground(uid, chatId, '') —— 实测传空串会移除记录。
       */
      async deleteChatBackground(id: number) {
        throw new Error('云湖无此接口：请用 setChatBackground(uid, chatId, \'\') 清除背景')
      },

      /* ================= 群 WebDAV 挂载 ================= */

      /**
       * 群里的第三方网盘挂载（比如 123云盘的 WebDAV）。
       * 注意：挂载内容**不在** /v1/disk/file-list 里，必须单独用这个接口列。
       */
      async mountList(groupId: string) {
        const r = await request('/v1/mount-setting/list', { body: { groupId } })
        assertOk(r)
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, groupId: x.groupId, name: x.mountName,
          url: x.webdavUrl, user: x.webdavUserName, root: x.webdavRootPath || '/',
          createTime: x.createTime,
        }))
      },

      async mountCreate(groupId: string, p: { name: string; url: string; user?: string; pass?: string; root?: string }) {
        return assertOk(await request('/v1/mount-setting/create', {
          body: {
            groupId, mountName: p.name, webdavUrl: p.url,
            webdavUserName: p.user || '', webdavPassword: p.pass || '',
            webdavRootPath: p.root || '/',
          },
        }))
      },

      async mountDelete(id: number) {
        return assertOk(await request('/v1/mount-setting/delete', { body: { id } }))
      },

      /* ================= 通讯录 / 添加 / 创建 ================= */

      /** 好友申请列表 */
      async friendRequests({ size = 20, page = 1 } = {}) {
        const r = await request('/v1/friend/request-list', { body: { size, page } })
        assertOk(r)
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, targetId: x.targetId, chatType: x.chatType, name: x.name,
          avatar: x.avatar, message: x.message, time: x.createTime,
        }))
      },
      /** 同意 / 忽略 / 删除 好友申请 */
      async handleRequest(kind: 'agree' | 'ignore' | 'delete', id: number) {
        const path = kind === 'agree' ? '/v1/friend/agree-apply' : kind === 'ignore' ? '/v1/friend/ignore-apply' : '/v1/friend/delete-request'
        return assertOk(await request(path, { body: { id } }))
      },
      /** 免打扰开关（官方 NoNotifyRequest 实测：只有 chatId + noNotify(0|1) 两字段，
       *  好友/群/机器人共用；多传 chatType 或传布尔会导致云端同步不可靠） */
      async noNotify(chatId: string, noNotify: boolean | number = true) {
        return assertOk(await request('/v1/friend/no-notify', { body: { chatId, noNotify: noNotify ? 1 : 0 } }))
      },

      /** 删除好友/退群/删机器人：官方字段 { chatId, chatType }（同族 applyFriend 实测教训：
       *  targetId 是猜的字段名，服务端回 1100「请求参数错误」；chatType 2=退群 1=删好友 3=删机器人） */
      async deleteFriend(chatId: string, chatType = 1) {
        return assertOk(await request('/v1/friend/delete-friend', { body: { chatId, chatType } }))
      },

      /** full.proto: CreateGroupResponse { Status status=1; string group_id=2; } */
      async createGroup(name: string, introduction = '', avatarUrl = '', { signal, timeout = 15000 }: { signal?: AbortSignal; timeout?: number } = {}) {
        if (!name.trim()) throw new Error('群名称不能为空')
        if (!avatarUrl.trim()) throw new Error('请填写群头像地址，或先设置个人头像')
        const r = await request('/v1/group/create-group', {
          body: pb.build(pb.fStr(2, name), pb.fStr(3, introduction), pb.fStr(4, avatarUrl)),
          signal, timeout,
        })
        const status = r.json ? r.json : pb.msg(r.pb, 1)
        const code = r.json ? status.code : pb.num(status, 2)
        if (code !== 1) throw new Error((r.json ? status.msg : pb.str(status, 3)) || `创建群聊失败（状态 ${code ?? '缺失'}）`)
        // group_id is a scalar string. Decoding it as a nested message can hang on wire type 3.
        const value = r.json ? r.json.data?.groupId ?? r.json.data?.group_id : pb.str(r.pb, 2)
        const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
        if (!id) throw new Error('服务端已返回成功，但缺少群 ID；请先刷新群列表确认，避免重复创建')
        return id
      },
      /** 邀请进群 */
      async inviteToGroup(groupId: string, userIds: string[]) {
        return assertOk(await request('/v1/group/invite', {
          body: pb.build(pb.fStr(2, groupId), ...userIds.map((u) => pb.fStr(3, u))),
        }))
      },

      /**
       * 邀请**机器人**进群：同端点但请求体是 JSON { chatId=机器人ID, chatType=3, groupId }
       * （Murexide 实测；protobuf 形态只适用于普通用户，机器人会回「请求参数错误」）
       */
      async inviteBotToGroup(botId: string, groupId: string) {
        return assertOk(await request('/v1/group/invite', {
          body: { chatId: botId, chatType: 3, groupId },
        }))
      },

      /** 创建机器人：CreateBotRequest{ name=2, introduction=3, avatar_url=4, private=5 } */
      async createBot(name: string, introduction = '', avatarUrl = '', isPrivate = false) {
        const r = assertOk(await request('/v1/bot/create-bot', {
          body: pb.build(pb.fStr(2, name), pb.fStr(3, introduction), pb.fStr(4, avatarUrl), pb.bool(5, isPrivate)),
        }))
        return r.pb
      },
      /** 我创建的机器人（控制台用）：JSON */
      async myBots() {
        const r = await request('/v1/bot/console/my-bots', { body: {} })
        assertOk(r)
        const list = r.json?.data?.list?.bots || []
        return { total: r.json?.data?.botsTotal ?? list.length, list: list.map((b: any) => ({
          id: b.botId, name: b.nickname, avatar: b.avatarUrl, token: b.token,
          link: b.link || '', linkStop: b.linkStop, platform: b.platform,
        })) }
      },
      /**
       * 更改机器人信息。
       * ⚠️ 路径是 /v1/bot/**web-edit-bot**（我原来写的 /v1/bot/edit-bot-info 不存在），
       *    字段名也不是 name 而是 **nickname**。
       */
      async editBot(botId: string, patch: { name?: string; introduction?: string; avatarUrl?: string; isPrivate?: boolean }) {
        return assertOk(await request('/v1/bot/web-edit-bot', {
          body: {
            botId,
            nickname: patch.name ?? '',
            introduction: patch.introduction ?? '',
            avatarUrl: patch.avatarUrl ?? '',
            private: patch.isPrivate ? 1 : 0,
          },
        }))
      },
      /** 更改机器人设置：/v1/bot/edit-setting-json { id, settingJson } */
      async editBotSettings(botId: string, settingJson: any) {
        return assertOk(await request('/v1/bot/edit-setting-json', {
          body: { id: botId, settingJson: typeof settingJson === 'string' ? settingJson : JSON.stringify(settingJson) },
        }))
      },
      /** 机器人指令列表（网页控制台）：/v1/instruction/web-list { botId } */
      async botInstructions(botId: string) {
        return api.botInstructionsWeb(botId)
      },
      /** 重置机器人 token：/v1/bot/reset-bot-token { botId }（我原来写成 /v1/bot/reset-token） */
      async resetBotToken(botId: string) {
        const r = await request('/v1/bot/reset-bot-token', { body: { botId } })
        assertOk(r)
        return r.json?.data?.token || ''
      },

      /* ================= 板块文章 ================= */

      /** 板块（分区）里的文章列表 */
      async baPosts(baId: number, { typ = 1, size = 20, page = 1 } = {}) {
        const r = await request('/v1/community/posts/post-list', { body: { typ, baId, size, page } })
        assertOk(r)
        return (r.json?.data?.posts || []).map((x: any) => ({
          id: x.id, baId: x.baId, senderId: x.senderId, title: x.title || '',
          contentType: x.contentType, content: x.content || '',
          createTime: x.createTime, likeNum: x.likeNum || 0, commentNum: x.commentNum || 0,
          senderName: x.senderName || x.senderNickname || '',
          senderAvatar: x.senderAvatar || '',
        }))
      },
      /** 文章详情 */
      async baPostDetail(id: number) {
        const r = await request('/v1/community/posts/post-detail', { body: { id } })
        assertOk(r)
        return r.json?.data || null
      },
      /** 在板块里发文章 */
      async baCreatePost(baId: number, title: string, content: string, contentType = 2) {
        return assertOk(await request('/v1/community/posts/create', { body: { baId, title, content, contentType } }))
      },

      /* ================= 机器人指令 ================= */

      /**
       * 群里的机器人指令列表（按机器人归类）。
       * 返回的每条带 botId/botName，所以能直接按机器人分组展示。
       * auth: 0-所有人可用 1-禁用 2-群主可用 3-群管可用
       */
      async groupInstructions(groupId: string, chatType = 2) {
        const r = await request('/v1/group/instruction-list', { body: { groupId, chatType } })
        assertOk(r)
        return (r.json?.data?.instructions || r.json?.data?.list || []).map((x: any) => ({
          id: x.id, botId: String(x.botId || ''), botName: x.botName || '',
          name: x.name || '', desc: x.desc || '', sort: x.sort || 0, auth: x.auth ?? 0,
        }))
      },
      /**
       * 某个机器人自己的指令。
       * ⚠️ 接口是 /v1/instruction/web-list ——
       *    我原来调的 /v1/bot/console/instruction-list 是 404，所以「点指令没用」。
       */
      async botInstructionsWeb(botId: string) {
        const r = await request('/v1/instruction/web-list', { body: { botId } })
        assertOk(r)
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, name: x.name, desc: x.desc, type: x.instructionType,
          hintText: x.hintText || '', defaultText: x.defaultText || '',
          customJson: x.customJson || '', hidden: x.hidden || 0, sort: x.sort || 0,
        }))
      },
      /** 创建机器人指令 */
      async createInstruction(body: Record<string, any>) {
        return assertOk(await request('/v1/instruction/create', { body }))
      },
      /** 编辑机器人指令 */
      async editInstruction(body: Record<string, any>) {
        return assertOk(await request('/v1/instruction/edit', { body }))
      },
      /** 私聊指令：路径是 /v1/instruction/list（我原来写的 private-list 不存在） */
      async privateInstructions(botId: string) {
        const r = await request('/v1/instruction/list', { body: { botId } })
        assertOk(r)
        return r.json?.data?.list || []
      },

      /* ================= 板块（文章分区 community/ba） ================= */

      /** 分区列表：typ 1-关注 2-热门 3-我的 4-全部 */
      async baList(typ = 4, { size = 20, page = 1 } = {}) {
        const r = await request('/v1/community/ba/following-ba-list', { body: { typ, size, page } })
        assertOk(r)
        return (r.json?.data?.ba || []).map((b: any) => ({
          id: b.id, name: b.name, avatar: b.avatar, createTime: b.createTime,
          lastActive: b.lastActive, desc: b.desc || b.introduction || '',
        }))
      },
      /** 分区详情 */
      async baInfo(id: number) {
        const r = await request('/v1/community/ba/info', { body: { id } })
        assertOk(r)
        return r.json?.data?.ba || null
      },
      /** 创建分区（板块）：name 最多 10 字 */
      async baCreate(name: string, avatar = '') {
        const r = await request('/v1/community/ba/create', { body: { name, avatar } })
        assertOk(r)
        return r.json?.data?.id ?? 0
      },
      /** 编辑分区 */
      async baEdit(baId: number, patch: { name?: string; avatar?: string; desc?: string }) {
        return assertOk(await request('/v1/community/ba/edit', { body: { baId, ...patch } }))
      },
      /** 管理分区：visibleRange 0-公开 1-仅自己；publishAuthority 0/1/2 */
      async baManage(baId: number, visibleRange = 0, publishAuthority = 0) {
        return assertOk(await request('/v1/community/ba/manage', { body: { baId, visibleRange, publishAuthority } }))
      },
      /** **看别人**创建了哪些板块：/v1/community/ba/list-by-create { userId } */
      async baListByCreate(userId: string) {
        const r = await request('/v1/community/ba/list-by-create', { body: { userId } })
        assertOk(r)
        return (r.json?.data?.ba || []).map((b: any) => ({ id: b.id, name: b.name, avatar: b.avatar || '' }))
      },

      /** 分区下绑定的群聊 */
      async baGroups(baId: number, { size = 20, page = 1 } = {}) {
        const r = await request('/v1/community/ba/group-list', { body: { baId, size, page } })
        assertOk(r)
        return r.json?.data?.groups || []
      },

      /* ================= 表情收藏 ================= */

      /** 个人表情收藏（url 需要补 https://chat-img.jwznb.com/ 前缀） */
      async expressionList() {
        const r = await request('/v1/expression/list', { body: {} })
        assertOk(r)
        return (r.json?.data?.expression || []).map((e: any) => ({
          id: e.id, url: e.url, urlOriginal: e.urlOriginal, top: e.top || 0,
        }))
      },
      /**
       * 把图片加进个人表情收藏。
       * ⚠️ 接口是 /v1/expression/create { url: '完整图片 URL' } ——
       *    我原来写的 /v1/expression/add 是「添加已有表情包」({id})，完全不是一回事。
       */
      async expressionCreate(url: string) {
        // 批量上传时偶发 abort/超时：网络类错误重试一次，业务错误（assertOk 抛）不重试
        try {
          return assertOk(await request('/v1/expression/create', { body: { url } }))
        } catch (e: any) {
          if (/abort|timeout|network|fetch/i.test(e?.message || '')) {
            return assertOk(await request('/v1/expression/create', { body: { url } }))
          }
          throw e
        }
      },
      /** 添加已有表情包到自己的收藏：{ id: 表情包 ID } */
      async expressionAddPack(id: number) {
        return assertOk(await request('/v1/expression/add', { body: { id } }))
      },
      async expressionDelete(id: number) {
        return assertOk(await request('/v1/expression/delete', { body: { id } }))
      },
      /** 置顶：接口是 /v1/expression/topping（不是 /top） */
      async expressionTopping(id: number) {
        return assertOk(await request('/v1/expression/topping', { body: { id } }))
      },

      /* ================= 表情包（sticker pack） ================= */

      /** 我收藏的表情包（含每个包里的表情） */
      async stickerPacks() {
        const r = await request('/v1/sticker/list', { body: {} })
        assertOk(r)
        return (r.json?.data?.stickerPacks || []).map((p: any) => ({
          id: p.id, name: p.name, createBy: String(p.createBy || ''), uuid: p.uuid,
          createTime: p.createTime, updateTime: p.updateTime,
          userCount: p.userCount || 0, hot: p.hot || 0, sort: p.sort || 0,
          items: (p.stickerItems || []).map((i: any) => ({
            id: i.id, name: i.name,
            // 自愈：历史脏数据 url 可能存了完整 URL（官方约定相对 key）——统一剥域名，
            // 否则手机端二次补域名成坏地址、桌面端 /res 代理也会 404
            url: String(i.url || '').replace(/^https?:\/\/[^/]+\//, ''),
            urlOriginal: i.urlOriginal || i.url,
            stickerPackId: i.stickerPackId ?? p.id,   // 合集 id：发送时回填 sticker_pack_id，手机端才能归到合集
          })),
        }))
      },
      /** 表情包详情 */
      async stickerPackDetail(id: number) {
        const r = await request('/v1/sticker/detail', { body: { id } })
        assertOk(r)
        return r.json?.data || null
      },
      /** 创建表情包 → 返回新包 ID */
      async stickerCreatePack(name: string) {
        const r = await request('/v1/sticker/create-pack', { body: { name } })
        assertOk(r)
        return r.json?.data?.id ?? 0
      },
      /** 重命名表情包 */
      async stickerRenamePack(id: number, name: string) {
        return assertOk(await request('/v1/sticker/rename-pack', { body: { id, name } }))
      },
      /** 删除表情包 */
      async stickerDeletePack(id: number) {
        return assertOk(await request('/v1/sticker/delete-pack', { body: { id } }))
      },
      /** 移除收藏的表情包 */
      async stickerRemovePack(id: number) {
        return assertOk(await request('/v1/sticker/remove-sticker-pack', { body: { id } }))
      },
      /** 往表情包里加一张表情（需要是创建者） */
      async stickerAddSticker(packId: number, name: string, url: string) {
        return assertOk(await request('/v1/sticker/add-sticker', { body: { name, url, stickerPackId: packId } }))
      },
      /** 删除表情包里的某张表情 */
      async stickerRemoveSticker(packId: number, stickerId: number) {
        return assertOk(await request('/v1/sticker/remove-sticker', { body: { stickerPackId: packId, id: stickerId } }))
      },
      /** 重命名表情包里的表情 */
      async stickerRenameSticker(id: number, name: string) {
        return assertOk(await request('/v1/sticker/rename-sticker', { body: { id, name } }))
      },
      /** 导入 zip 表情包（key 必须带 stickerZip/ 前缀） */
      async stickerImportPack(name: string, fileKey: string) {
        return assertOk(await request('/v1/sticker/import-pack', { body: { name, fileKey } }))
      },

      /* ================= 编辑消息 ================= */

      /**
       * 编辑消息。云湖「编辑」和「发送」共用 SendMsgRequest，只是 msg_id 填**被编辑那条**的 id。
       * 服务端会限制类型转换（文本不能编成语音等）。
       */
      async editMessage(chatId: string, chatType: number, msgId: string, contentType: number, content: Record<string, any>) {
        const body = pb.build(
          pb.fStr(2, msgId),
          pb.fStr(3, chatId),
          pb.fNum(4, chatType),
          pb.fBytes(5, encodeContent(content)),
          pb.fNum(6, contentType),
        )
        return assertOk(await request('/v1/msg/edit-message', { body }))
      },

      /** 消息的历史编辑内容 → [{ text, msgTime, contentType }] */
      async editRecords(msgId: string, { size = 20, page = 1 } = {}) {
        const r = await request('/v1/msg/list-message-edit-record', { body: { msgId, size, page } })
        assertOk(r)
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, msgId: x.msgId, contentType: x.contentType,
          text: (() => { try { return JSON.parse(x.contentOld || '{}').text ?? x.contentOld } catch { return x.contentOld } })(),
          createTime: x.createTime, msgTime: x.msgTime,
        }))
      },

      /* ================= 通讯录 / 好友 ================= */

      /** 通讯录：AddressBookListRequest{ md5=2 }，留空取全量 → { users, groups, bots } */
      async addressBook() {
        const r = assertOk(await request('/v1/friend/address-book-list', { body: new Uint8Array() }))
        const out: Record<string, any[]> = { users: [], groups: [], bots: [] }
        for (const d of pb.each(r.pb, 2)) {
          const label = pb.str(d, 1)
          const declared = pb.num(d, 3)
          const type = [1, 2, 3].includes(declared) ? declared : /群/.test(label) ? 2 : /机器人/.test(label) ? 3 : /用户|好友/.test(label) ? 1 : 0
          if (!type) continue
          const list = pb.each(d, 2).map(u => ({
            id: pb.str(u, 1), remark: pb.str(u, 2), avatar: pb.str(u, 3),
            level: pb.num(u, 4), noDisturb: pb.bool(u, 5),
            name: pb.str(u, 8) || pb.str(u, 2) || pb.str(u, 1),
          }))
          out[type === 1 ? 'users' : type === 2 ? 'groups' : 'bots'].push(...list)
        }
        for (const key of Object.keys(out)) out[key] = [...new Map(out[key].map(item => [String(item.id), item])).values()]
        return out
      },

      /**
       * 添加用户/群/机器人。
       * ⚠️ 字段是 **{ chatId, chatType, remark }** —— 我原来写成 targetId/message，
       *    服务端直接回 1100「请求参数错误」（用户实测 8932561 就踩这个）。
       */
      async applyFriend(chatId: string, chatType = 1, remark = '') {
        return assertOk(await request('/v1/friend/apply', { body: { chatId, chatType, remark } }))
      },

      /* ================= 群文件（群网盘） ================= */

      /** 群文件列表：objectType=1 是文件夹 */
      async diskList(chatId: string, chatType = 2, folderId = 0, sort = 'name_asc') {
        const r = await request('/v1/disk/file-list', { body: { chatId, chatType, folderId, sort } })
        assertOk(r)
        // ★ 真实字段：qiniuKey 才是完整地址（https://chat-file.jwznb.com/disk/xxx）
        //   objectType: 1 文件夹 / 2 文件；fileSize 单位是字节
        return (r.json?.data?.list || []).map((x: any) => ({
          id: x.id, name: x.name, fileSize: x.fileSize,
          isFolder: x.objectType === 1,
          uploadTime: x.uploadTime,
          uploadByName: x.uploadByName || x.uploadBy || '',
          fileUrl: x.qiniuKey || '',
          parentId: x.parentFolderId ?? x.folderId ?? 0,
          objectType: x.objectType ?? (x.objectType === 1 ? 1 : 2),
        }))
      },

      async diskCreateFolder(chatId: string, chatType: number, folderName: string, parentFolderId = 0) {
        return assertOk(await request('/v1/disk/create-folder', { body: { chatId, chatType, folderName, parentFolderId } }))
      },

      /** 删除群文件：/v1/disk/remove。请求体与同族 rename 一致，必须带 objectType
       *  （只发 {id} 会失败——和 diskRename 当初漏 objectType 是同一个坑） */
      async diskDelete(id: number, objectType = 2) {
        return assertOk(await request('/v1/disk/remove', { body: { id, objectType } }))
      },

      /** 群网盘用量：接口是 /v1/disk/file-size（之前写的 total-size 是 404，控制台能看到报错） */
      async diskTotalSize(chatId: string, chatType = 2) {
        const r = await request('/v1/disk/file-size', { body: { chatId, chatType } })
        assertOk(r)
        return r.json?.data || null
      },

      /* ================= 群聊管理 ================= */

      /**
       * 群信息：POST /v1/group/info  GroupInfoRequest{ group_id=2 }
       * 字段号严格按 full.proto#GroupData（之前猜错了，avatar/introduction 全串位）
       */
      async groupInfo(groupId: string, { timeout = 60000 } = {}) {
        const r = assertOk(await request('/v1/group/info', { body: pb.build(pb.fStr(2, groupId)), timeout }))
        const d = pb.msg(r.pb, 2)
        return {
          id: pb.str(d, 1),
          name: pb.str(d, 2),
          avatar: pb.str(d, 3),
          avatarId: pb.num(d, 4),
          introduction: pb.str(d, 5),
          headcount: pb.num(d, 6),
          createBy: pb.str(d, 7),
          joinFree: pb.bool(d, 8),
          permission: pb.num(d, 9),
          category: pb.str(d, 11),
          isPrivate: pb.bool(d, 13),
          noDisturb: pb.bool(d, 14), pinned: pb.bool(d, 19),
          admins: pb.list(d, 20).map((b: any) => new TextDecoder().decode(b)),
          limitedMsgType: pb.str(d, 22),
          owner: pb.str(d, 23),
          isGag: pb.bool(d, 25),
          myGroupNickname: pb.str(d, 28),
          groupCode: pb.str(d, 29),
          hideMembers: pb.bool(d, 30),
          autoDeleteMessage: pb.bool(d, 32),
          denyUpload: pb.bool(d, 33),
          raw: d,
        }
      },

      /** 群成员列表：ListMemberRequest{ data=2{size=1,page=2}, group_id=3, keywords=4 } */
      async listMembers(groupId: string, { size = 50, page = 1, keywords = '' } = {}) {
        const data = pb.build(pb.fNum(1, size), pb.fNum(2, page))
        const body = pb.build(pb.fBytes(2, data), pb.fStr(3, groupId), pb.fStr(4, keywords))
        const r = assertOk(await request('/v1/group/list-member', { body }))
        const list = pb.each(r.pb, 2).map(d => {
          const info = pb.msg(d, 2)
          return {
            id: pb.str(info, 1),
            name: pb.str(info, 2),
            avatar: pb.str(info, 4),
            isVip: pb.bool(info, 6),
            level: pb.num(d, 3),
            gagTs: pb.num(d, 4),
            // ⚠️ isGag 的布尔字段号不可靠（实测全员 true 的猎奇显示）；
            //    改按 gagTs（禁言到期时间戳）判定：未来时间才是在禁言中
            // 禁言态默认空（字段号不可靠，实测全员误判）；仅 gag() 成功后本地置位
            isGag: false,
            role: pb.num(d, 3) >= 100 ? '群主' : pb.num(d, 3) >= 2 ? '管理员' : '成员',
          }
        })
        return { list, total: pb.num(r.pb, 3) }
      },

      /** 踢出成员（需群主/管理员） */
      async kickMember(groupId: string, userId: string) {
        return assertOk(await request('/v1/group/remove-member', { body: { groupId, userId } }))
      },

      /** 禁言成员：gag 0 取消 / 600 10分 / 3600 1时 / 21600 6时 / 43200 12时 / -1 永久 */
      async gagMember(groupId: string, userId: string, gag: number) {
        return assertOk(await request('/v1/group/gag-member', { body: { groupId, userId, gag } }))
      },

      /** 群机器人列表：BotListRequest{ group_id=2 } */
      async listBots(groupId: string) {
        const r = await request('/v1/group/bot-list', { body: pb.build(pb.fStr(2, groupId)) })
        assertOk(r)
        return pb.each(r.pb, 2).map(d => ({
          id: pb.str(d, 1),
          name: pb.str(d, 2),
          avatar: pb.str(d, 4),
          desc: pb.str(d, 6),
        }))
      },

      /* ================= 看板 ================= */

      /** 机器人群聊看板：BoardRequest{ id=3, chat_type=4 } */
      async board(id: string, chatType: number) {
        const r = await request('/v1/bot/board', { body: pb.build(pb.fStr(3, id), pb.fNum(4, chatType)) })
        assertOk(r)
        if (!r.pb) return null
        const d = pb.msg(r.pb, 2)
        if (!d || !Object.keys(d).length) return null
        return {
          botId: pb.str(d, 1),
          chatId: pb.str(d, 2),
          chatType: pb.num(d, 3),
          content: pb.str(d, 4),
          contentType: pb.num(d, 5),
          updatedAt: pb.num(d, 6),
          botName: pb.str(d, 7),
        }
      },

      /* ================= 历史记录 ================= */

      /** 按消息 id 为游标，向前翻更多历史 */
      async messagesBefore(chatId: string, chatType: number, beforeMsgId: string, count = 30) {
        const body = pb.build(pb.fNum(2, count), pb.fStr(3, beforeMsgId), pb.fNum(4, chatType), pb.fStr(5, chatId))
        const r = assertOk(await request('/v1/msg/list-message', { body }))
        return pb.each(r.pb, 2).map(decodeMsg).sort((a: any, b: any) => a.ts - b.ts)
      },

      /** 聊天记录搜索：POST /v1/search/chat-search */
      async searchChat({ word, chatId, chatType, size = 30, time = 9999999999999, type = 'all' }: any) {
        const r = await request('/v1/search/chat-search', {
          body: { word, chatId, chatType, size, time, type, direction: 1 },
        })
        assertOk(r)
        const list = r.json?.data?.list || []
        // 实测响应字段：content 是**字符串**（非对象）、发送者=name、时间=time、type 是字符串
        return list.map((m: any) => ({
          id: m.id || m.msgId,
          sender: m.name || m.senderName || '',
          avatar: m.avatarUrl,
          text: typeof m.content === 'string' ? m.content : (m.content?.text || ''),
          ts: m.time || m.timestamp || 0,
          type: Number(m.type) || 1,
          seq: m.sequence,
          raw: m,
        }))
      },

      /* ================= 上传 ================= */

      /**
       * 七牛上传 token：按媒体类型走专用端点（Murexide QiniuUploadUtil 实测对照）：
       *   image → qiniu-token；video → qiniu-token-video（video 桶）；
       *   audio → qiniu-token-audio（失败回退 token2）；file/sticker → qiniu-token2。
       * 视频/音频走错桶会上传失败或存错桶读不回（「音视频上传失败」根因之一）。
       */
      async uploadToken(kind: 'image' | 'file' | 'audio' | 'video' | 'sticker' = 'image') {
        const path = kind === 'image' ? '/v1/misc/qiniu-token'
          : kind === 'video' ? '/v1/misc/qiniu-token-video'
            : kind === 'audio' ? '/v1/misc/qiniu-token-audio'
              : '/v1/misc/qiniu-token2'
        let r = await request(path, { method: 'GET' })
        // audio 专用端点若云端未开，回退通用 token2（不阻塞发送）
        if (kind === 'audio' && r.http !== 200) r = await request('/v1/misc/qiniu-token2', { method: 'GET' })
        assertOk(r)
        const t = r.json?.data?.token
        if (!t) throw new Error('未取得上传 token')
        return t as string
      },

      /**
       * 上传文件到七牛，返回可用于发消息的 key
       *   0) 大小门：超过官方限制直接拒绝（不浪费流量）
       *   1) 取 token
       *   2) 从 token 里解析 ak / bucket，查上传域名（失败则用默认域名）
       *   3) 经本站 /up 代理 POST（绕开浏览器跨域），XHR 带上传进度回调
       */
      async uploadFile(file: File, kind: 'image' | 'file' | 'audio' | 'video' | 'sticker' = 'image',
        onProgress?: (loaded: number, total: number) => void) {
        // 官方上传大小限制：用户定死 40MB 上限（所有类型统一，超出直接拒绝不浪费流量）
        const LIMITS: Record<string, number> = { image: 40 * 1024 * 1024, video: 40 * 1024 * 1024, audio: 40 * 1024 * 1024, file: 40 * 1024 * 1024, sticker: 40 * 1024 * 1024 }
        const lim = LIMITS[kind] || 40 * 1024 * 1024
        if (!file.size) throw new Error('文件内容为空，请重新选择文件')
        if (file.size > lim) {
          throw new Error(`文件超过 40MB 上传限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`)
        }
        const token = await api.uploadToken(kind)
        const seg = token.split(':')
        const ak = seg[0] || ''
        let bucket = ''
        try {
          const b64 = (seg[2] || '').replace(/-/g, '+').replace(/_/g, '/')
          const policy = JSON.parse(decodeURIComponent(escape(atob(b64))))
          bucket = String(policy.scope || '').split(':')[0]
        } catch { /* 解不出来就用默认域名 */ }

        // 记住上次成功的上传域名（按 bucket 缓存），避免每次先撞一次区域错误
        const cacheKey = `yh.up.host.${bucket || ak || 'default'}`
        const validHost = (value: string) => /^(?:[a-z0-9-]+\.)*(?:qiniup\.com|qbox\.me)$/i.test(value)
        let cached = ''
        try { cached = localStorage.getItem(cacheKey) || '' } catch { /* storage can be unavailable */ }
        let host = validHost(cached) ? cached : 'upload.qiniup.com'
        if (ak && bucket && !cached) {
          try {
            const q: any = await fetch(`https://api.qiniu.com/v4/query?ak=${encodeURIComponent(ak)}&bucket=${encodeURIComponent(bucket)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json())
            const up = q?.hosts?.[0]?.up || q?.up
            const d = up?.domains?.[0] || up?.acc?.domains?.[0] || up?.src?.domains?.[0]
            const candidate = String(d || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
            if (validHost(candidate)) host = candidate
          } catch { /* 忽略，用默认 */ }
        }

        // ⚠️ 云湖的 key 约定是**裸文件名**（别人的图片 key 形如 1791136274952_xxx.png）。
        // 之前我自作聪明加了 `image/` 前缀，服务端拼出来是 域名/image/xxx，
        // 但它读回来只保留 域名/xxx，于是全部 404 —— 这里必须不带目录前缀。
        // 只有「表情包 zip」按官方文档要求用 stickerZip/ 前缀。
        const ext = (file.name.split('.').pop() || 'bin').slice(0, 8)
        const base = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const key = kind === 'sticker' ? `stickerZip/${base}` : base

        // 七牛会按 bucket 所在区域回「incorrect region, please use <host>」，这里自动跟随重试
        const tried = new Set<string>()
        let lastErr = ''
        for (let attempt = 0; attempt < 4; attempt++) {
          if (tried.has(host)) break
          tried.add(host)
          const fd = new FormData()
          fd.append('token', token)
          fd.append('key', key)
          fd.append('file', file)
          // 经本站代理上传：/up/<上传域名>/ -> https://<域名>/
          // 用 XHR 而非 fetch：fetch 拿不到上传进度，XHR 的 upload.onprogress 可以（速度条要用）
          const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', `/up/${host}/`)
            xhr.timeout = 120000
            xhr.ontimeout = () => reject(new Error('上传超时，请重试'))
            xhr.onabort = () => reject(new Error('上传已取消'))
            if (onProgress) {
              xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total) }
            }
            // Region redirects arrive as HTTP 400 JSON. Parse them before deciding whether to reject.
            xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText })
            xhr.onerror = () => reject(new Error('上传网络错误'))
            xhr.send(fd)
          })
          const text = result.text
          let json: any = {}
          try { json = JSON.parse(text) } catch { /* 非 JSON */ }
          if (result.status >= 200 && result.status < 300 && typeof json.key === 'string' && json.key.trim()) {
            try { localStorage.setItem(cacheKey, host) } catch { /* successful upload remains successful */ }
            return { key: json.key as string, host }
          }

          lastErr = String(json.error || text.slice(0, 200) || ('上传失败 HTTP ' + result.status))
          const m = lastErr.match(/please use\s+([\w.-]+)/i)
          if (m && validHost(m[1]) && !tried.has(m[1])) { host = m[1]; onProgress?.(0, file.size); continue }
          break
        }
        throw new Error(lastErr)
      },

      /** 上传后返回可直接用于消息的完整地址 */
      async uploadAndUrl(file: File, kind: 'image' | 'file' | 'audio' | 'video' | 'sticker' = 'image',
        onProgress?: (loaded: number, total: number) => void) {
        const { key } = await api.uploadFile(file, kind, onProgress)
        let routes: any = {}
        try { routes = await api.distribution() } catch { /* 忽略 */ }
        const base = kind === 'image' ? (routes.imageUrl || 'https://chat-img.jwznb.com/')
          : kind === 'audio' ? (routes.audioUrl || 'https://chat-audio1.jwznb.com/')
            : kind === 'video' ? (routes.videoUrl || 'https://chat-video1.jwznb.com/')
              : (routes.fileUrl || 'https://chat-file.jwznb.com/')
        return { key, url: new URL(key.replace(/^\/+/, ''), base.replace(/\/*$/, '/')).href }
      },

      /* ================= 群设置 ================= */

      /** 设置我在本群的群昵称 */
      async setMyGroupNickname(groupId: string, nickname: string) {
        return assertOk(await request('/v1/group/edit-my-group-nickname', { body: { groupId, nickname } }))
      },

      /** 设置消息类型限制（type 传 "1,2,3" 这样的串） */
      async setMsgTypeLimit(groupId: string, type: string) {
        return assertOk(await request('/v1/group/msg-type-limit', { body: { groupId, type } }))
      },

      /* ================= 审计补齐（对照 Yhchat_md3/Murexide 实测形态） ================= */

      /** 退出登录时通知云端注销本设备（否则「在线设备」残留） */
      async logoutDevice(deviceId: string) {
        return request('/v1/user/logout', { body: { deviceId } }).catch(() => null)
      },
      /** 保存好友备注（云端多端同步） */
      async saveUserRemarks(friendId: string, name: string, phone = '', others = '') {
        return assertOk(await request('/v1/user/save-user-remarks', { body: { friendId, name, phone, others } }))
      },
      /** 在线设备列表（protobuf） */
      async userClients() {
        const r = await request('/v1/user/clients', { method: 'GET' })
        assertOk(r)
        return pb.each(r.pb, 2).map((d: any) => ({
          deviceId: pb.str(d, 1), platform: pb.str(d, 2), online: pb.bool(d, 3), ts: pb.num(d, 4),
        }))
      },
      /** 金币收支明细 */
      async coinRecords(page = 1, size = 20) {
        const r = await request('/v1/user/gold-coin-increase-decrease-record', { body: { page, size } })
        assertOk(r)
        return r.json?.data?.records || r.json?.data?.list || []
      },
      /** 拉黑/取消拉黑用户 */
      async setBlackList(userId: string, isAdd: boolean) {
        return assertOk(await request('/v1/community/set-black-list', { body: { userId, isAdd: isAdd ? 1 : 0 } }))
      },
      /** 黑名单列表 */
      async getBlackList(page = 1, size = 50) {
        const r = await request('/v1/community/black-list', { body: { page, size } })
        assertOk(r)
        return r.json?.data?.list || r.json?.data?.users || []
      },
      /** 同意入群邀请/申请 */
      async agreeGroupInvite(inviteId: string) {
        return assertOk(await request('/v1/group/agree-invite', { body: { inviteId } }))
      },
      /** 移除群机器人 */
      async removeGroupBot(groupId: string, botId: string) {
        return assertOk(await request('/v1/group/remove-bot', { body: { groupId, botId } }))
      },
      /** 设置/取消群管理员（userLevel 2=管理员 0=普通） */
      async setManageSetting(groupId: string, userId: string, userLevel: number) {
        return assertOk(await request('/v1/group/manage-setting', { body: { groupId, userId, userLevel } }))
      },
      /** 群消息自动删除时长（秒，0=关） */
      async editAutoDeleteMessage(groupId: string, seconds: number) {
        return assertOk(await request('/v1/group/edit-auto-delete-message', { body: { groupId, time: seconds } }))
      },
      /** 群口令（仅群主） */
      async editGroupKeyword(groupId: string, keyword: string) {
        return assertOk(await request('/v1/group/edit-group-keyword', { body: { groupId, keyword } }))
      },
      /** 全局搜索（人/群/机器人/帖子混合结果） */
      async homeSearch(word: string) {
        const r = await request('/v1/search/home-search', { body: { word } })
        assertOk(r)
        return r.json?.data || {}
      },
      /** 按 msgId 拉前后一段消息（定位跳转用）；proto: seq=3 chatType=4 chatId=5 unknown=6 count=7 msgId=8 */
      async messagesAround(chatId: string, chatType: number, msgId: string, count = 20, seq = 0) {
        const body = pb.build(...(seq > 0 ? [pb.fNum(3, seq)] : []), pb.fNum(4, chatType), pb.fStr(5, chatId), pb.fNum(6, 0), pb.fNum(7, count), pb.fStr(8, msgId))
        const r = assertOk(await request('/v1/msg/list-message-by-mid-seq', { body }))
        return pb.each(r.pb, 2).map(decodeMsg).sort((a: any, b: any) => a.ts - b.ts)
      },
      /** 收藏（他人分享的）贴纸包到自己账号 */
      async stickerAddPack(id: number) {
        return assertOk(await request('/v1/sticker/add', { body: { id } }))
      },
      /** 收藏贴纸包排序：[{id, sort}] */
      async stickerSort(items: Array<{ id: number; sort: number }>) {
        return assertOk(await request('/v1/sticker/sort', { body: { sort: items } }))
      },
      /** 群网盘重命名 */
      /** 群盘重命名：官方请求体 { id, objectType, name }（此前字段全错导致接口报错） */
      async diskRename(fileId: number, objectType: number, name: string) {
        return assertOk(await request('/v1/disk/rename', { body: { id: fileId, objectType, name } }))
      },
      /** 「发现」页：推荐分区列表 */
      async recommendCategories() {
        const r = await request('/v1/user/recommend-category-list', { body: { appChannel: 'default' } })
        assertOk(r)
        return (r.json?.data?.categories || r.json?.data?.list || []).map((c: any) => {
          const name = typeof c === 'string' ? c : c.name || c.categoryName || c.category || String(c.id)
          return { id: name, name }
        })
      },
      /** 「发现」页：分区内推荐群/机器人 */
      async recommendList(categoryId: number | string) {
        const r = await request('/v1/user/recommend-list', { body: { category: String(categoryId), keyword: '', size: 30, page: 1 } })
        assertOk(r)
        return (r.json?.data?.groupList || r.json?.data?.list || []).map((x: any) => ({ ...x, id: String(x.chatId || x.id), name: x.nickname || x.name, avatar: x.avatarUrl || x.avatar, chatType: 2 }))
      },
      /** 「发现」页：推荐机器人 */
      async recommendBots() {
        const r = await request('/v1/user/recommend', { body: {} })
        assertOk(r)
        return (r.json?.data?.botList || r.json?.data?.list || r.json?.data?.bots || []).map((x: any) => ({ ...x, id: String(x.chatId || x.id), name: x.nickname || x.name, avatar: x.avatarUrl || x.avatar, chatType: 3 }))
      },
      /** 举报用户/群/机器人（/v1/report/create） */
      async report(chatId: string, chatType: number, chatName: string, content: string) {
        return assertOk(await request('/v1/report/create', { body: { chatId, chatType, chatName, content } }))
      },
      /** 创建分享（含群二维码图 imageKey + key + ts）：JSON {chatId, chatType, chatName}。
       *  ⚠️ 实测响应：shareUrl 只回裸域名 https://yhfx.jwznb.com/，完整链接要客户端用 key+ts 拼。
       *  ⚠️ assertOk 的返回值是 json body 本身（不是 request 的包装对象），
       *     取 data 必须用「先 request 再 assertOk(r)、再用 r.json」的写法——
       *     `const r = assertOk(await request(...))` 后接 r.json 会拿到 undefined（同族 4 处已修）。 */
      async shareCreate(chatId: string, chatType: number, chatName: string) {
        const r = await request('/v1/share/create', { body: { chatId, chatType, chatName } })
        assertOk(r)
        const d = r.json?.data || {}
        return { imageKey: d.imageKey || '', key: d.key || '', shareUrl: d.shareUrl || '', ts: Number(d.ts) || 0 }
      },
      /** 关注板块：{ baId, followSource=2 }（Yhchat 实测形态） */
      async followBoard(baId: number) {
        return assertOk(await request('/v1/community/ba/user-follow-ba', { body: { baId, followSource: 2 } }))
      },
      /** 取消关注板块：{ baId } */
      async unfollowBoard(baId: number) {
        return assertOk(await request('/v1/community/ba/user-unfollow-ba', { body: { baId } }))
      },

      /** 编辑群聊信息（只传要改的字段） */
      async editGroup(groupId: string, patch: Record<string, any>) {
        return assertOk(await request('/v1/group/edit-group', { body: { groupId, ...patch } }))
      },

      /* ================= 群标签 ================= */

      // size 默认给大一点：云湖群标签可以很多（这个群就有 50+），
      // 之前默认 50 只取到第一页，新建的标签会“看不见”
      async listTags(groupId: string, { size = 200, page = 1, tag = '' } = {}) {
        const r = await request('/v1/group-tag/list', { body: { groupId, size, page, tag } })
        assertOk(r)
        return (r.json?.data?.list || []) as any[]
      },

      async createTag(groupId: string, tag: string, color = '#2196F3', desc = '') {
        return assertOk(await request('/v1/group-tag/create', { body: { groupId, tag, color, desc, sort: 0 } }))
      },

      /** 删除标签：**只需要 id**（之前多传了 groupId，接口会失败） */
      async deleteTag(_groupId: string, id: number) {
        return assertOk(await request('/v1/group-tag/delete', { body: { id } }))
      },

      /** 编辑标签：{ id, groupId, tag, color, desc, sort } */
      async editTag(groupId: string, id: number, patch: Record<string, any>) {
        return assertOk(await request('/v1/group-tag/edit', { body: { id, groupId, ...patch } }))
      },

      /** 给用户打标签：{ userId, tagGroupId } */
      async relateTag(userId: string, tagGroupId: number) {
        return assertOk(await request('/v1/group-tag/relate', { body: { userId, tagGroupId } }))
      },

      /** 取消标签：{ userId, tagGroupId } */
      async relateTagCancel(userId: string, tagGroupId: number) {
        return assertOk(await request('/v1/group-tag/relate-cancel', { body: { userId, tagGroupId } }))
      },

      /**
       * 某个标签绑定了哪些用户。
       * TagMemberRequest{ data=2{size,page}, group_id=3, tag_id=4 } → ListMemberResponse
       */
      async tagMembers(groupId: string, tagId: number, { size = 100, page = 1 } = {}) {
        const data = pb.build(pb.fNum(1, size), pb.fNum(2, page))
        const body = pb.build(pb.fBytes(2, data), pb.fStr(3, groupId), pb.fNum(4, tagId))
        const r = assertOk(await request('/v1/group-tag/members', { body }))
        return pb.each(r.pb, 2).map(d => {
          const info = pb.msg(d, 2)
          return { id: pb.str(info, 1), name: pb.str(info, 2), avatar: pb.str(info, 4) }
        })
      },

      /* ================= 个人信息 ================= */

      /**
       * 获取自身个人资料。
       * 注意：这个接口的返回是 **data.data 双层嵌套**：
       *   { code:1, data:{ data:{ id, userId, introduction, gender, birthday,
       *                          province, city, district, locationCode } } }
       */
      async getMyProfile() {
        const r = await request('/v1/user/get-user-data', { body: {} })
        assertOk(r)
        return r.json?.data?.data || {}
      },

      /**
       * 保存个人资料（JSON，字段就是一套扁平字段）：
       *   introduction / gender(1男 2女 3其他) / birthday(秒级时间戳)
       *   province / city / district / locationCode
       */
      async saveMyProfile(data: Record<string, any>) {
        const body = {
          introduction: data.introduction ?? '',
          gender: Number(data.gender ?? 3),
          birthday: Number(data.birthday ?? 0),
          province: data.province ?? '',
          city: data.city ?? '',
          district: data.district ?? '',
          locationCode: data.locationCode ?? '',
        }
        return assertOk(await request('/v1/user/save-user-data', { body }))
      },

      /**
       * 改昵称。proto: EditNicknameRequest { string name = 3 }  ← 字段是 3！
       * （之前写成 1，服务端直接忽略，所以怎么都改不了）
       */
      async editNickname(name: string) {
        const r = await request('/v1/user/edit-nickname', { body: pb.build(pb.fStr(3, name)) })
        return assertOk(r)
      },

      /**
       * 改头像。proto: EditAvatarRequest { string url = 2 }  ← 字段 2，且要**完整 URL**
       * （之前写成 1 且传的是 key，所以也不生效）
       */
      async editAvatar(url: string) {
        const r = await request('/v1/user/edit-avatar', { body: pb.build(pb.fStr(2, url)) })
        return assertOk(r)
      },


      /**
       * 获取任意用户信息（含注册时间/在线天数/VIP/勋章/IP归属地等）。
       * proto: GetUserRequest { string id = 2 }
       */
      async getUser(id: string, { timeout = 60000 } = {}) {
        const r = assertOk(await request('/v1/user/get-user', { body: pb.build(pb.fStr(2, id)), timeout }))
        const d = pb.msg(r.pb, 2)
        const p = pb.msg(d, 19)
        return {
          id: pb.str(d, 1),
          name: pb.str(d, 2),
          nameId: pb.num(d, 3),
          avatar: pb.str(d, 4),
          avatarId: pb.num(d, 5),
          medalCount: pb.list(d, 6).length,
          registerTime: pb.str(d, 7),
          doNotDisturb: pb.bool(d, 8),
          noDisturb: pb.bool(d, 8), pinned: pb.bool(d, 17),
          banId: pb.num(d, 9),
          banUntil: pb.num(d, 10),
          onlineDay: pb.num(d, 11),
          continuousOnlineDay: pb.num(d, 12),
          isVip: pb.bool(d, 13),
          vipExpired: pb.num(d, 14),
          vipStatus: pb.num(d, 15),
          isBlocked: pb.bool(d, 16),
          profile: {
            introduction: pb.str(p, 2),
            gender: pb.num(p, 3),
            birthday: pb.num(p, 4),
            city: pb.str(p, 5),
            district: pb.str(p, 6),
            address: pb.str(p, 7),
          },
          ipGeo: pb.str(d, 20),
          banReason: pb.str(d, 21),
        }
      },

      async dismiss(chatId) {
        return request('/v1/conversation/dismiss-notification', { body: { chatId } })
      },

      /** A2UI 表单/按钮动作回报 */
      async a2uiFormReport({ chatType = 3, chatId, actionName, sourceComponentId, interactionJson }) {
        const r = await request('/v1/msg/a2ui-form-report', {
          body: { chatType, chatId, actionName, sourceComponentId, interactionJson },
        })
        return r.json ? assertOk(r) : r
      },

      /** 普通按钮消息回报 */
      async buttonReport({ chatId, chatType, msgId, userId, value }) {
        // ButtonReportRequest：消息 ID=2、会话类型=3、会话 ID=4、当前用户 ID=5、按钮值=6。
        const body = pb.build(
          pb.fStr(2, msgId || ''), pb.fNum(3, chatType || 0), pb.fStr(4, chatId || ''),
          pb.fStr(5, userId || ''), pb.fStr(6, value ?? ''),
        )
        const result = await request('/v1/msg/button-report', { body })
        if (result.http < 200 || result.http >= 300) throw new Error(`HTTP ${result.http}`)
        return assertOk(result)
      },
    }

    ctx.set('api', api)
    ctx.logger?.info(`api 服务已就绪 → ${base}`)
  },
}

/** 生成 32 位 hex 消息 ID（对齐 uuid4().hex）
 *  注意：crypto.randomUUID 只在安全上下文可用，http 页面下要用 getRandomValues 兜底 */
function newMsgId() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** protobuf MsgData -> 统一消息结构 */
export function decodeMsg(d) {
  const s = pb.msg(d, 2)
  return {
    id: pb.str(d, 1),
    senderId: pb.str(s, 1),
    sender: pb.str(s, 3) || pb.str(s, 1),
    avatar: pb.str(s, 4),
    senderType: pb.num(s, 2),
    // ★ 云湖把「管理员给群友设的头衔」直接塞在发送者结构里：
    //   Sender.tag(7) = repeated Tag{ id=1, group_id=2, text=3, color=4 }
    //   Sender.tag_old(6) = repeated string（旧版纯文本）
    // 之前只从 /v1/group-tag 查，所以只显示了个「管理员」，头衔全丢了。
    tags: decodeSenderTags(s),
    type: pb.num(d, 4),
    content: decodeContent(pb.raw(d, 5)),
    ts: pb.num(d, 6),
    direction: pb.str(d, 3),
    right: pb.str(d, 3) === 'right',
    seq: pb.num(d, 10),
    quoteId: pb.str(d, 9),
    recalled: pb.num(d, 8) > 0,
    edited: pb.num(d, 12) > 0,
    raw: d,
  }
}

/** 解发送者身上的头衔（Tag{id=1,group_id=2,text=3,color=4}） */
export function decodeSenderTags(sender: any) {
  const out = pb.each(sender, 7).map((t: any) => ({
    id: pb.num(t, 1),
    groupId: pb.str(t, 2),
    text: pb.str(t, 3),
    color: pb.str(t, 4) || '#888888',
  })).filter((t: any) => t.text)
  // 兜底：旧版的纯文本 tag_old(6)
  if (!out.length) {
    for (const b of pb.list(sender, 6)) {
      try { out.push({ id: 0, groupId: '', text: new TextDecoder().decode(b), color: '#888888' }) } catch { /* 忽略 */ }
    }
  }
  return out
}

export { encodeContent, decodeContent, newMsgId, CONTENT_FIELD }
