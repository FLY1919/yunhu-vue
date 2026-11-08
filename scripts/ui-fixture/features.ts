/** Virtual accounts and deterministic local media only. */
import './fixture'
import { createApp, nextTick } from 'vue'
import ImageEditor from '../../src/components/ImageEditor.vue'
import ProfilePanel from '../../src/components/ProfilePanel.vue'
import LockScreen from '../../src/console/components/LockScreen.vue'
import { lockPlugin } from '../../src/plugins/lock'
const qa = (window as any).__qa, ctx = qa.ctx
ctx.get = (name: string) => ctx[name]
qa.botCalls = 0; qa.exported = null
ctx.api.getUser = async (id: string) => ({ id, name: '用户 ' + id })
ctx.api.botInfo = async (id: string) => { qa.botCalls++; return { id, name: '机器人', isBot: true } }
ctx.api.baListByCreate = async () => []
ctx.api.recommendCategories = async () => [{ id: '精选', name: '精选' }]
ctx.api.recommendList = async () => [{ id: 'discovered', name: '发现测试群', introduction: '本地推荐', chatType: 2 }]
ctx.group.openProfile = (user: any) => { ctx.group.state.profileUser = user }
ctx.group.closeProfile = () => { ctx.group.state.profileUser = null }
ctx.group.open = () => { ctx.group.state.panelOpen = true }
ctx.group.isFriend = (id: string) => ctx.social.state.book.users.some((u: any) => String(u.id) === String(id))
const profileHost = document.createElement('div'); document.body.append(profileHost)
const profileApp = createApp(ProfilePanel); profileApp.provide('ctx', ctx); profileApp.mount(profileHost)
ctx.auth.state.status = 'ready'
lockPlugin.apply(ctx)
const lockHost = document.createElement('div'); document.body.append(lockHost)
const lockApp = createApp(LockScreen); lockApp.provide('ctx', ctx); lockApp.mount(lockHost)
qa.openEditor = async (gif = false) => {
  qa.exported = null
  const blob = gif ? await fetch('/scripts/ui-fixture/animated.gif').then(r => r.blob()) : await fetch(qa.messages.find((m: any) => m.id === 'sticker-test').elements[0].attrs.src).then(r => r.blob())
  const file = new File([blob], gif ? 'animation.gif' : 'picture.png', { type: gif ? 'application/octet-stream' : 'image/png' })
  const host = document.createElement('div'); document.body.append(host)
  let app: ReturnType<typeof createApp>
  const dispose = () => { app.unmount(); host.remove() }
  app = createApp(ImageEditor, { file, confirmLabel: '导出测试副本', onDone(file: File) { qa.exported = file; dispose() }, onClose: dispose })
  app.provide('ctx', ctx); app.mount(host); await nextTick()
}
qa.featuresReady = true
window.addEventListener('beforeunload', () => { profileApp.unmount(); lockApp.unmount() })
