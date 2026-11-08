// 真实板块服务和页面，使用虚拟数据；不读取账号，不访问外部服务。
import FloatingCommunityEditor from '../../src/components/FloatingCommunityEditor.vue'
import CommunityEditorHost from '../../src/components/CommunityEditorHost.vue'
import { createApp, reactive, h } from 'vue'
import CommunityPage from '../../src/console/pages/CommunityPage.vue'
import MessageItem from '../../src/components/MessageItem.vue'
import { communityPlugin } from '../../src/plugins/community'
import '../../src/styles.css'
import '../../src/styles-m3.css'
const calls: any[] = [], errors: string[] = [], timers: any[] = []
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#41405f"/><path d="M16 20h32v26H16z" fill="none" stroke="#c9c2ff" stroke-width="3"/><path d="M22 28h20M22 35h14" stroke="#c9c2ff" stroke-width="2"/></svg>')
const boards = [
  { id: 925, name: '笔记 / 随感', avatar: picture, desc: '记录学习路上的一点想法' },
  { id: 1009, name: '可恶。', avatar: '/scripts/ui-fixture/missing.png' },
  { id: 1218, name: '物理研习室', avatar: picture },
  { id: 2034, name: '日常碎片', avatar: picture },
  { id: 3201, name: '开源与创造', avatar: picture },
]
const makePosts = (id: number) => Array.from({length:id===925?30:id===1009?0:4},(_,i)=>({id:id*100+i,title:['物理光学','物理电学','物理声学','给未来的自己'][i%4],senderName:'TR',createTime:Date.now()-i*3600000,likeNum:i*3,commentNum:i,content:i%2?'从一个小问题出发，把看似复杂的现象重新理解一遍。':'学习不止于记住结论，也在于发现问题、记录想法，与同好分享。'}))
const fail = reactive({ create: false, edit: false, posts: false, groups: false, detail: false })
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
const ctx: any = {
  auth: { state: reactive({ user: { id: 'fixture-user' } }) },
  chat: { state: reactive({ conversations: [{ id: 'g1', type: 2, name: '物理学习交流' }], current: null }), open: (c: any) => calls.push(['chat', c]) },
  social: { state: { book: { groups: [{ id: 'g1' }] } }, loadBook: async () => {}, apply: async (...v: any[]) => calls.push(['apply', ...v]) },
  group: { openProfile: (u: any) => calls.push(['profile', u]) },
  api: {
    baDrafts: async () => { if ((fail as any).drafts) throw Error('云端暂不可用'); return { list: JSON.parse(localStorage.getItem('qa.cloud-drafts') || '[]'), more: false } },
    baSaveDraft: async (baId: number, title: string, content: string, contentType: number, draftId: number) => {
      calls.push(['saveDraft', baId, title, content, contentType, draftId]); await delay(80)
      if ((fail as any).saveDraft) throw Error('云端保存失败')
      const id = Date.now(), all = JSON.parse(localStorage.getItem('qa.cloud-drafts') || '[]').filter((d: any) => d.id !== draftId)
      all.unshift({ id, baId, title, content, contentType, createTime: Date.now() / 1000, ba: { name: '笔记 / 随感' } }); localStorage.setItem('qa.cloud-drafts', JSON.stringify(all)); return id
    },
    baGetDraft: async (id: number) => { calls.push(['getDraft', id]); return JSON.parse(localStorage.getItem('qa.cloud-drafts') || '[]').find((d: any) => d.id === id) },
    baDeleteDraft: async (id: number) => { calls.push(['deleteDraft', id]); localStorage.setItem('qa.cloud-drafts', JSON.stringify(JSON.parse(localStorage.getItem('qa.cloud-drafts') || '[]').filter((d: any) => d.id !== id))) },
    addressBook: async () => { if ((fail as any).book) throw Error('通讯录查询失败'); return { groups: [{ id: 'g1' }], users: [], bots: [] } },
    applyFriend: async (...v: any[]) => calls.push(['apply', ...v]),
    baPostLike: async (...v: any[]) => { calls.push(['like', ...v]); await delay(60) },
    baPostCollect: async (...v: any[]) => { calls.push(['collect', ...v]); await delay(60) },
    baComments: async (_id: number, opts: any) => ({ comments: [{ id: 5, senderId: 'other', senderNickname: '同好', senderAvatar: picture, replies: [{ id: 6, senderId: 'reply-author', senderNickname: '回复者', senderAvatar: picture, content: '楼中楼回复' }], content: '一起讨论', createTime: Date.now(), likeNum: 2, isLiked: '0' }], total: 1 }),
    baComment: async (...v: any[]) => { calls.push(['comment', ...v]); await delay(80); if ((fail as any).comment) throw Error('评论接口失败') },
    baCommentLike: async (...v: any[]) => calls.push(['commentLike', ...v]),
    baForward: async (...v: any[]) => calls.push(['forward', ...v]), send: async (...v: any[]) => calls.push(['send', ...v]),
    baCreatePost: async (...v: any[]) => { calls.push(['publish', ...v]); await delay(80); if ((fail as any).publish) throw Error('发布接口失败'); const draftId = v[4]; localStorage.setItem('qa.cloud-drafts', JSON.stringify(JSON.parse(localStorage.getItem('qa.cloud-drafts') || '[]').filter((d: any) => d.id !== draftId))) },
    baEditPost: async (...v: any[]) => { calls.push(['editPost', ...v]); await delay(80) },
    baList: async (type: number, opts: any) => { calls.push(['list',type,opts]); await delay(25); return type===3?boards.filter(b=>b.id===925):type===1?[boards[2]]:boards.map(b=>({...b})) },
    baInfo: async (id: number) => ({id,memberNum:128,postNum:id===925?32:id===1009?0:4,groupNum:2,visibleRange:0,publishAuthority:1}),
    baPosts: async (id: number, opts: any) => { calls.push(['posts',id,opts]); await delay(40);if(fail.posts)throw Error('网络连接中断');return opts.page===1?makePosts(id):[{id:id*100+30,title:'最后一篇文章',senderName:'TR',content:'最后一篇'}] },
    baPostDetail: async (id: number) => { await delay(30);if(fail.detail)throw Error('详情接口失败');return {post:{id,senderId:'fixture-user',isLiked:'0',isCollected:'0',title:'物理光学：从观察开始',content:'## 从一个问题开始\n\n光为什么会折射？从观察到推理，我们可以一步一步理解它。\n\n> 记录过程，也记录每次灵光一现。\n\n```js\nconst curious = true\n```\n\n<script>window.evil=true</script><img src=x onerror="window.evil=true">'}} },
    baGroups: async () => { await delay(20);if(fail.groups)throw Error('群聊接口失败');return [{groupId:'g1',name:'物理学习交流',avatar:picture,introduction:'一起记录和讨论'},{groupId:'g2',name:'学习打卡',avatar:''}] },
    baCreate: async (...args: any[]) => {calls.push(['create',...args]);await delay(70);if(fail.create)throw Error('创建失败');return 6000},
    baEdit: async (...args: any[]) => {calls.push(['edit',...args]);await delay(50);if(fail.edit)throw Error('保存失败')},
    baManage: async (...args: any[]) => {calls.push(['manage',...args]);await delay(50)},
    followBoard: async (...args: any[]) => {calls.push(['follow',...args]);await delay(80)}, unfollowBoard: async (...args: any[]) => {calls.push(['unfollow',...args]);await delay(80)},
    bindBaGroup: async (...args: any[]) => {calls.push(['bind',...args]);await delay(50)},
    uploadFile: async (file: File) => {await delay(30);return {url:file.name === 'article.png' ? location.origin + '/scripts/ui-fixture/article-test.svg' : picture}},
  },
  ui: { toast: (message: string) => errors.push(message), confirm: async () => true },
  console: { state: reactive({ slots:[],menus:{} }), goto: (p: string) => calls.push(['goto',p]), addEntry() {} },
  on() {}, setTimeout(fn: any,ms: number) {const id=setTimeout(fn,ms);timers.push(id);return id}, set(key: string,value: any) {ctx[key]=value},
}
communityPlugin.apply(ctx)
const sessionId = new URLSearchParams(location.search).get('community-editor')
const shareCards = new URLSearchParams(location.search).has('share-cards')
const shareMessages = [
  { type: 8, text: `<div style="height:360px;background:#000"><a href="yunhu://alley-detail?id=925" data-yh-type="group"><img src="${picture}"><div>云湖去广版分享</div><div>邀请加入该板块</div></a></div>` },
  { type: 8, text: '<a href="yunhu://chat-add?id=925&type=group"><table><tr><td><b>学习交流</b><div>点击查看会话信息</div></td></tr></table></a>' },
  { type: 8, text: '<a data-yh-id="952" data-yh-type="group">历史群分享</a>' },
  { type: 3, text: '这里有一个[板块入口](yunhu://alley-detail?id=1218)。' },
  { type: 8, text: '<a href="yunhu://chat-add?id=925&type=user">用户分享</a>' },
]
if (shareCards) {
  ctx.chat.preferences = { antiRecall: false }
  Object.assign(ctx.chat.state, { selected: [], selecting: false })
  ctx.chat.toggleSelect = (id: string) => ctx.chat.state.selected.push(id)
  ctx.social.state.book.groups.push({ id: '925', name: '学习交流' })
}
const root = shareCards ? {
  render: () => [
    h('section', { class: 'messages', style: 'width:100%;max-height:480px;flex:none' },
      shareMessages.map(({ type, text }, i) => h(MessageItem, {
        key: i, msg: { id: 'share-' + i, type, ts: Date.now(), sender: 'Sh', right: i === 0, content: { text } },
      }))),
    h(CommunityPage),
  ],
} : { render: () => [h(CommunityPage), h(CommunityEditorHost)] }
const app=(sessionId ? createApp(FloatingCommunityEditor, { sessionId }) : createApp(root)).provide('ctx',ctx)
app.mount('#app')
;(window as any).__community={ctx,calls,fail,errors}
window.addEventListener('beforeunload',()=>{app.unmount();for(const id of timers)clearTimeout(id)})
