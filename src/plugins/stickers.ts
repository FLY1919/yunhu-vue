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
import { reactive } from 'vue'
import type { Context } from '../core/context'
import StickerPanel from '../components/StickerPanel.vue'
import StickersPage from '../console/pages/StickersPage.vue'
import { h } from '../satori/element'

export const stickersPlugin = {
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
      keyword: '',
      recording: false,
      seconds: 0,
      recordingVideo: false,
      videoSeconds: 0,
      packs: [] as any[],
      packsLoading: false,
    })

    /* ---------------- 表情收藏 ---------------- */

    async function load() {
      state.loading = true
      try { state.list = await api.expressionList() }
      catch (e: any) { ui.toast('表情收藏加载失败：' + e.message, 'error') }
      finally { state.loading = false }
    }

    function open() { state.panelOpen = true; if (!state.list.length) load() }
    function close() { state.panelOpen = false }

    /** 点一张表情 → 作为表情消息发出 */
    async function send(e: any) {
      try {
        await chat.sendMedia([h.sticker(e.url || e.urlOriginal, e.id, 0)])
        close()
      } catch (err: any) { ui.toast('发送失败：' + err.message, 'error') }
    }

    /** 上传一张图并加进收藏 */
    async function uploadAndAdd(ev: any) {
      const f = ev?.target?.files?.[0]
      if (!f) return
      try {
        const res: any = await api.uploadFile(f, 'image')
        const key = typeof res === 'string' ? res : res?.key
        if (!key) throw new Error('上传没拿到 key')
        // ⚠️ /v1/expression/create 要的是**完整图片 URL**（不是裸 key）
        const url = res?.url || `https://chat-img.jwznb.com/${key}`
        await api.expressionCreate(url)
        ui.toast('已加入表情收藏', 'success')
        await load()
      } catch (e: any) { ui.toast('收藏失败：' + e.message, 'error') }
      ev.target.value = ''
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
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
      await sendAudio(f, 0)
      ev.target.value = ''
    }

    /* ---------------- 视频 ---------------- */

    let videoRecorder: MediaRecorder | null = null
    let videoChunks: BlobPart[] = []
    let videoTimer: any = null

    /** 上传视频并作为视频消息发出（content_type 10） */
    async function sendVideo(blob: Blob, seconds = 0) {
      try {
        const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'mp4'
        const file = new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type || 'video/mp4' })
        const res: any = await api.uploadFile(file, 'video')
        const key = typeof res === 'string' ? res : res?.key
        if (!key) throw new Error('上传没拿到 key')
        await chat.sendMedia([h.video(key, seconds || 0)])
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
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
      if (!window.confirm(`删除表情包「${p.name}」？不可恢复`)) return
      try { await api.stickerDeletePack(p.id); ui.toast('已删除', 'success'); await loadPacks() }
      catch (e: any) { ui.toast('删除失败：' + e.message, 'error') }
    }
    async function removePack(p: any) {
      try { await api.stickerRemovePack(p.id); ui.toast('已移出收藏', 'success'); await loadPacks() }
      catch (e: any) { ui.toast('操作失败：' + e.message, 'error') }
    }

    const service = {
      state, load, open, close, send, uploadAndAdd, remove, topping,
      loadPacks, createPack, renamePack, deletePack, removePack,
      recordStart, recordStop, sendAudioFile,
      sendVideo, sendVideoFile, recordVideoStart, recordVideoStop,
    }
    ctx.set('stickers', service)

    /* ---------------- 输入区按钮 ---------------- */
    ctx.effect(() => chat.composer('composer', [
      { id: 'emoji.panel', kind: 'emoji', label: '表情', order: 40 },
      { id: 'voice.rec', kind: 'voice', label: '语音', order: 41 },
      { id: 'video.pick', kind: 'videoFile', label: '视频', order: 42 },
      { id: 'video.rec', kind: 'videoRec', label: '录制视频', order: 43 },
    ], ctx))

    /* ---------------- 全局浮层 ---------------- */
    // 同上：走聊天插槽，浮层只在聊天区域内
    ctx.effect(() => chat.slot({ type: 'global', component: StickerPanel, order: 60 }, ctx))

    load()
    loadPacks()
    ctx.logger?.info('stickers 插件已加载（表情收藏 / 表情包 / 语音 / 视频）')

    ctx.console.addEntry((cc: any) => {
      cc.page({ name: '表情', path: '/stickers', icon: 'smile', order: 155, component: StickersPage })
    })
  },
}
