import { mediaMetadata } from '../core/media'
import { getChatRecordingStream } from '../core/media-devices'
/**
 * stickers 插件 —— 表情收藏面板 + 语音发送
 *
 * 表情：
 *   ctx.stickers.load()        拉个人表情收藏（/v1/expression/list）
 *   ctx.stickers.open()        打开面板（浮层，全局插槽）
 *   ctx.stickers.send(e)       作为表情消息发出（content_type 7）
 *   ctx.stickers.uploadAndAdd(file)  上传图片并收藏
 *   ctx.stickers.remove(e)     从收藏删除
 *
 * 语音：
 *   ctx.stickers.recordStart() / recordStop()  用 MediaRecorder 录一段并发出去
 *   ctx.stickers.sendAudioFile(file)           选本地音频文件发出去
 *
 * 另外往输入区注册两个按钮：「😀 表情」「🎤 语音」。
 */
import Schema from 'schemastery'
import { reactive } from 'vue'
import type { Context } from '../core/context'
import StickerPanel from '../components/StickerPanel.vue'
import StickersPage from '../console/pages/StickersPage.vue'
import { h } from '../satori/element'
import { resUrl } from '../core/res'

export const name = 'stickers'

export interface StickersCfg {
  panelOnStart: boolean
}

export const stickersConfig: Schema<StickersCfg> = Schema.object({
  panelOnStart: Schema.boolean().default(false).description('启动时是否展开表情面板'),
})

export const stickersPlugin = {
  Config: stickersConfig,
  name: 'stickers',
  inject: ['api', 'chat', 'ui', 'console'],
  provide: ['stickers'],

  apply(ctx: Context) {
    const api: any = ctx.api
    const chat: any = ctx.chat
    const ui: any = ctx.ui

    const state = reactive({
      list: [] as any[],
      loading: false,
      panelOpen: false,
      activeTab: 'fav' as 'fav' | number,   // 面板当前页签（openPackOf 可外部定位）
      /** 聊天里点表情后要在面板中高亮（圈线）的那一张：{ tab, id }。
       *  tab='fav' 时 id 是 expression_id；tab=数字时 id 是包内贴纸 itemId */
      locateSticker: null as null | { tab: 'fav' | number; id: number },
      keyword: '',
      recording: false,
      seconds: 0,
      recordingVideo: false,
      videoSeconds: 0,
      packs: [] as any[],
      packsLoading: false,
      /** 浏览未收藏的合集（点聊天里未收藏表情触发）：{id,name,items,locateId}，
       *  面板独立区域渲染全合集 + 框住点的那张 + 「添加合集」按钮 */
      browsePack: null as null | { id: number; name: string; items: any[]; locateId: number },
    })

    /* ---------------- 表情收藏 ---------------- */

    async function load(silent = false) {
      if (api.token === '' && !(ctx as any).auth?.state?.user?.id) return
      state.loading = true
      try { state.list = await api.expressionList() }
      catch (e: any) { if (!silent) ui.toast('表情收藏加载失败：' + e.message, 'error') }
      finally { state.loading = false }
    }

    // 每次打开都后台静默刷新：云端可能在别的端加了收藏
    // （旧实现 `if (!state.list.length) load()` 只空时拉一次，之后永远 stale）
    function open() { state.panelOpen = true; load(state.list.length > 0) }
    function close() { state.panelOpen = false }

    /** 点一张表情 → 作为表情消息发出 */
    async function send(e: any) {
      try {
        // 字段形态以**官方手机端真实发出的消息** dump 对照为准（2026-10-24 取证）：
        //   · f3 image_url = 完整 URL
        //   · f9 image/sticker_url = **相对 key**（手机端按它拼域名；发全 URL 会被服务端二次拼接污染 f3）
        //   · f15 expression_id = 收藏 id（包内贴纸为 0）；f25/f26 = item/pack id
        //   · f33/f34 = 实际宽高（手机端样本全带；取不到时 0）
        // ⚠️ 历史教训：10-20 经验「字段9发完整URL」是错的（只看了桌面回读），680f917 据此改坏，
        //    导致手机端三轮「识别不了」。
        const u = e.urlOriginal || e.url || ''
        if (!u) { ui.toast('这张表情没有可用地址', 'warn'); return }
        const rel = String(u).replace(/^https?:\/\/[^/]+\//, '')
        const full = /^https?:\/\//i.test(u) ? u : `https://chat-img.jwznb.com/${rel}`
        const inPack = !!e.stickerPackId
        // 取实际宽高（加载代理图）；超时/失败退 0，不阻塞发送
        let w = Number(e.width) || 0
        let hgt = Number(e.height) || 0
        if (!w || !hgt) {
          try {
            const dim = await new Promise<{ w: number; h: number }>((resolve) => {
              const img = new Image()
              const t = setTimeout(() => resolve({ w: 0, h: 0 }), 800)
              img.onload = () => { clearTimeout(t); resolve({ w: img.naturalWidth, h: img.naturalHeight }) }
              img.onerror = () => { clearTimeout(t); resolve({ w: 0, h: 0 }) }
              img.src = resUrl(full)
            })
            w = dim.w; hgt = dim.h
          } catch { /* 保持 0 */ }
        }
        await chat.sendMedia([h.sticker(rel, inPack ? Number(e.id) || 0 : 0, inPack ? Number(e.stickerPackId) || 0 : 0, inPack ? 0 : Number(e.id) || 0, w, hgt, full)])
        close()
      } catch (err: any) { ui.toast('发送失败：' + err.message, 'error') }
    }

    /** 上传一张图并加进收藏 */
    async function uploadAndAdd(ev: any) {
      const f = ev?.target?.files?.[0]
      if (!f) return
      await addFileToTarget(f, 'fav')
      ev.target.value = ''
    }

    /**
     * 上传到指定目标：'fav' = 个人收藏；数字 = 表情包组 id。
     * 面板里「选到哪一栏就传哪一栏」+ 粘贴上传都走这里。
     */
    async function addFileToTarget(f: File, target: 'fav' | number) {
      try {
        const res: any = await api.uploadFile(f, 'image')
        const key = typeof res === 'string' ? res : res?.key
        if (!key) throw new Error('上传没拿到 key')
        // ⚠️ 两个接口 url 形态不同（官方模型注释实测）：
        //   · expression/create（收藏）要**完整 URL**
        //   · sticker/add-sticker（表情包内贴纸）要**相对 key**——手机端自己补域名，传全 URL 会二次拼接导致不识别
        const url = res?.url || `https://chat-img.jwznb.com/${key}`
        // 文件名过长直接截短（保留扩展名）：云湖/七牛对 key 长度有限制，长文件名会上传失败
        const ext = (f.name.split('.').pop() || 'png').slice(0, 8)
        const base = f.name.replace(/\.\w+$/, '').slice(0, 24) || 'sticker'
        if (target === 'fav') await api.expressionCreate(url)
        else await api.stickerAddSticker(target as number, `${base}.${ext}`, key)
        ui.toast(target === 'fav' ? '已加入表情收藏' : '已加入表情包', 'success')
        await load()
        if (target !== 'fav') await loadPacks()
      } catch (e: any) { ui.toast('收藏失败：' + e.message, 'error') }
    }

    /** 把一张已在云端的图（消息里的 url/key）加进表情包组（add-sticker 要相对 key） */
    async function addUrlToPack(url: string, packId: number, name: string) {
      const rel = String(url).replace(/^https?:\/\/[^/]+\//, '')
      try {
        await api.stickerAddSticker(packId, name, rel)
        ui.toast('已加入表情包', 'success')
        await loadPacks()
      } catch (e: any) { ui.toast('加入失败：' + e.message, 'error') }
    }

    /** 置顶一张收藏表情 */
    async function topping(e: any) {
      try {
        await api.expressionTopping(e.id)
        ui.toast('已置顶', 'success')
        await load()
      } catch (err: any) { ui.toast('置顶失败：' + err.message, 'error') }
    }

    async function remove(e: any) {
      try {
        await api.expressionDelete(e.id)
        state.list = state.list.filter((x: any) => x.id !== e.id)
      } catch (err: any) { ui.toast('删除失败：' + err.message, 'error') }
    }

    /* ---------------- 语音 ---------------- */

    let recorder: MediaRecorder | null = null
    let chunks: BlobPart[] = []
    let timer: any = null

    /**
     * 录音/录像前的守卫：
     * 浏览器只在**安全上下文**（https / localhost）才暴露 navigator.mediaDevices，
     * 纯 http 打开时手机上连权限弹窗都不会出。这里给明确提示 + 降级建议。
     */
    function mediaReady(kind: 'audio' | 'video'): boolean {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        ui.toast(
          (kind === 'audio' ? '录音' : '录像') + '需要安全上下文：请用 https 打开（本服务 https 端口 8903），'
          + '或改用「选本地文件」的方式发送', 'error', 6000)
        return false
      }
      return true
    }

    async function recordStart() {
      if (state.recording) return recordStop()
      if (!mediaReady('audio')) return
      try {
        // 显式申请权限（手机上是这一步弹系统授权框）
        const stream = await getChatRecordingStream(false)
        chunks = []
        recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data) }
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
          await sendAudio(blob, state.seconds)
        }
        recorder.start()
        state.recording = true
        state.seconds = 0
        timer = window.setInterval(() => { state.seconds++ }, 1000)
      } catch (e: any) {
        ui.toast('拿不到麦克风权限：' + e.message, 'error')
      }
    }

    function recordStop() {
      if (!state.recording) return
      state.recording = false
      if (timer) { window.clearInterval(timer); timer = null }
      try { recorder?.stop() } catch { /* 忽略 */ }
    }

    /** 上传音频并作为语音消息发出（content_type 11） */
    async function sendAudio(blob: Blob, seconds: number) {
      try {
        const ext = (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm')
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type })
        const res: any = await api.uploadFile(file, 'audio')
        const key = typeof res === 'string' ? res : res?.key
        if (!key) throw new Error('上传没拿到 key')
        await chat.sendMedia([h.audio(key, seconds || 1)])
      } catch (e: any) { ui.toast('语音发送失败：' + e.message, 'error') }
    }

    async function sendAudioFile(ev: any) {
      const f = ev?.target?.files?.[0]
      if (!f) return
      // ⚠️ 手机端进度条依赖 f22 音频时长：传 0 会被 protobuf 省略字段 → 手机无法拖进度。
      //    选文件发送时先读真实时长（metadata），读不到退 1s 保底。
      const secs = await audioDuration(f)
      await sendAudio(f, secs)
      ev.target.value = ''
    }

    /** 读音频文件真实时长（秒，向上取整）；解码失败返回 0 */
    function audioDuration(f: File): Promise<number> {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(f)
        const a = document.createElement('audio')
        const done = (v: number) => { URL.revokeObjectURL(url); resolve(v) }
        const t = setTimeout(() => done(0), 3000)
        a.preload = 'metadata'
        a.onloadedmetadata = () => { clearTimeout(t); done(Math.max(1, Math.ceil(a.duration || 0))) }
        a.onerror = () => { clearTimeout(t); done(0) }
        a.src = url
      })
    }

    /* ---------------- 视频 ---------------- */

    let videoRecorder: MediaRecorder | null = null
    let videoChunks: BlobPart[] = []
    let videoTimer: any = null

    /** 上传视频并作为视频消息发出（content_type 10） */
    async function sendVideo(blob: Blob, seconds = 0) {
      try {
        const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'mp4'
        const file = blob instanceof File ? blob : new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type || 'video/mp4' })
        const res: any = await api.uploadFile(file, 'video')
        const key = typeof res === 'string' ? res : res?.key
        if (!key) throw new Error('上传没拿到 key')
        const meta = await mediaMetadata(file, 'video')
        await chat.sendMedia([{ ...h.video(key, seconds || meta.time), attrs: { src: key, ...meta, time: seconds || meta.time, name: file.name, size: file.size } }])
      } catch (e: any) { ui.toast('视频发送失败：' + e.message, 'error') }
    }

    async function sendVideoFile(ev: any) {
      const f = ev?.target?.files?.[0]
      if (!f) return
      await sendVideo(f, 0)
      ev.target.value = ''
    }

    /** 摄像头录制：点一次开始，再点结束并发送 */
    async function recordVideoStart() {
      if (state.recordingVideo) return recordVideoStop()
      if (!mediaReady('video')) return
      try {
        const stream = await getChatRecordingStream(true)
        videoChunks = []
        videoRecorder = new MediaRecorder(stream)
        videoRecorder.ondataavailable = (ev) => { if (ev.data.size) videoChunks.push(ev.data) }
        videoRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(videoChunks, { type: videoRecorder?.mimeType || 'video/webm' })
          await sendVideo(blob, state.videoSeconds)
        }
        videoRecorder.start()
        state.recordingVideo = true
        state.videoSeconds = 0
        videoTimer = window.setInterval(() => { state.videoSeconds++ }, 1000)
      } catch (e: any) {
        ui.toast('拿不到摄像头权限：' + e.message, 'error')
      }
    }

    function recordVideoStop() {
      if (!state.recordingVideo) return
      state.recordingVideo = false
      if (videoTimer) { window.clearInterval(videoTimer); videoTimer = null }
      try { videoRecorder?.stop() } catch { /* 忽略 */ }
    }

    /* ---------------- 表情包管理 ---------------- */

    async function loadPacks() {
      if (api.token === '' && !(ctx as any).auth?.state?.user?.id) return
      state.packsLoading = true
      try { state.packs = await api.stickerPacks() }
      catch (e: any) { ui.toast('表情包加载失败：' + e.message, 'error') }
      finally { state.packsLoading = false }
    }
    async function createPack(name: string) {
      if (!name.trim()) return ui.toast('要填名称', 'warn')
      try {
        await api.stickerCreatePack(name.trim())
        ui.toast('表情包已创建', 'success')
        await loadPacks()
      } catch (e: any) { ui.toast('创建失败：' + e.message, 'error') }
    }
    async function renamePack(id: number, name: string) {
      try { await api.stickerRenamePack(id, name); ui.toast('已重命名', 'success'); await loadPacks() }
      catch (e: any) { ui.toast('重命名失败：' + e.message, 'error') }
    }
    async function deletePack(p: any) {
      if (!(await ui.confirm('删除表情包', `删除表情包「${p.name}」？不可恢复`, { danger: true }))) return
      try { await api.stickerDeletePack(p.id); ui.toast('已删除', 'success'); await loadPacks() }
      catch (e: any) { ui.toast('删除失败：' + e.message, 'error') }
    }
    async function removePack(p: any) {
      try { await api.stickerRemovePack(p.id); ui.toast('已移出收藏', 'success'); await loadPacks() }
      catch (e: any) { ui.toast('操作失败：' + e.message, 'error') }
    }

    /** 把一张已在 CDN 的图（消息图片/表情）直接加进表情收藏（右键「收藏」用） */
    async function addFromUrl(url: string) {
      if (!url) return ui.toast('没有可收藏的图片地址', 'warn')
      try {
        await api.expressionCreate(url)
        ui.toast('已加入表情收藏', 'success')
        await load()
      } catch (e: any) { ui.toast('收藏失败：' + e.message, 'error') }
    }

    /**
     * 聊天里左键点表情 → 打开面板并**定位到那张表情**（圈线高亮）。
     *  · 属于我已收藏的合集：切到该合集页签，高亮包内 itemId 对应的贴纸；
     *  · 是个人收藏表情（无 packId）：切收藏页签，高亮 expression_id；
     *  · 合集不在我的收藏里：停在收藏页签 + 提示条（suggestPack）可一键添加。
     * @param arg 兼容对象 {packId,itemId,expressionId} 与旧的两参调用 (packId, expressionId)
     */
    const suggestPack = { id: 0, name: '' }
    async function openPackOf(arg: any, legacyExpr?: any) {
      const a = (arg && typeof arg === 'object') ? arg : { packId: Number(arg) || 0, expressionId: Number(legacyExpr) || 0 }
      const pid = Number(a.packId) || 0
      const itemId = Number(a.itemId) || 0
      const exprId = Number(a.expressionId) || 0
      state.panelOpen = true
      state.locateSticker = null
      state.browsePack = null
      if (!state.packs.length) await loadPacks()
      // ⚠️ 包 id 可能是字符串，pid 是 number —— 双侧强转再比，否则 find 恒空
      const hit = pid ? state.packs.find((p: any) => Number(p.id) === pid) : null
      if (hit) {
        suggestPack.id = 0; suggestPack.name = ''
        state.activeTab = Number(hit.id)
        state.locateSticker = { tab: Number(hit.id), id: itemId }
        return
      }
      if (pid) {
        // 未收藏的合集：拉全合集列表独立展示 + 框住点的那张 + 「添加合集」按钮
        // （/v1/sticker/detail 不要求已收藏，实测他人合集全量返回；url 需归一化）
        try {
          const d = await api.stickerPackDetail(pid)
          const pack = d?.stickerPack
          const items = (pack?.stickerItems || []).map((i: any) => ({
            id: i.id, name: i.name, stickerPackId: i.stickerPackId ?? pid,
            url: String(i.url || '').replace(/^https?:\/\/[^/]+\//, ''),
            urlOriginal: i.url,
          }))
          state.browsePack = { id: pid, name: pack?.name || `合集 ${pid}`, items, locateId: itemId }
          return
        } catch (e: any) {
          ui.toast('该合集不可用：' + e.message, 'warn')
        }
      }
      if (exprId) {
        suggestPack.id = 0; suggestPack.name = ''
        state.activeTab = 'fav'
        state.locateSticker = { tab: 'fav', id: exprId }
        return
      }
      suggestPack.id = pid
      suggestPack.name = pid ? `合集 ${pid}` : ''
      state.activeTab = 'fav'
    }
    function closeBrowse() { state.browsePack = null }

    const service = {
      state, load, open, close, send, uploadAndAdd, remove, topping, addFromUrl,
      addFileToTarget, addUrlToPack, suggestPack, openPackOf, closeBrowse,
      loadPacks, createPack, renamePack, deletePack, removePack,
      recordStart, recordStop, sendAudioFile,
      sendVideo, sendVideoFile, recordVideoStart, recordVideoStop,
    }
    ctx.set('stickers', service)

    /* ---------------- 输入区按钮 ----------------
     * 默认序（用户定）：文本/MD/HTML(10-12) → 表情(40) → 图片(50) → 视频(60) → 文件(70)。
     * 录音/录制视频按钮按用户要求移除（service 函数保留给其他插件/快捷键用）。 */
    ctx.effect(() => chat.composer('composer', [
      { id: 'emoji.panel', kind: 'emoji', label: '表情', order: 40 },
      { id: 'video.pick', kind: 'videoFile', label: '视频', order: 60 },
    ], ctx))

    /* ---------------- 全局浮层 ---------------- */
    // 同上：走聊天插槽，浮层只在聊天区域内
    ctx.effect(() => chat.slot({ type: 'global', component: StickerPanel, order: 60 }, ctx))

    ctx.on('auth/login', () => { load(); loadPacks() })
    load()
    loadPacks()
    ctx.logger?.info('stickers 插件已加载（表情收藏 / 表情包 / 语音 / 视频）')

    ctx.console.addEntry((cc: any) => {
      cc.page({ name: '表情', path: '/stickers', icon: 'smile', order: 155, component: StickersPage })
    })
  },
}
