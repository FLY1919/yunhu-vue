// 真实板块服务和页面，使用虚拟数据；不读取账号，不访问外部服务。
import { createApp, reactive } from 'vue'
import CommunityPage from '../../src/console/pages/CommunityPage.vue'
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
  api: {
    baList: async (type: number, opts: any) => { calls.push(['list',type,opts]); await delay(25); return type===3?boards.filter(b=>b.id===925):type===1?[boards[2]]:boards.map(b=>({...b})) },
    baInfo: async (id: number) => ({id,postNum:id===925?32:id===1009?0:4,groupNum:2,visibleRange:0,publishAuthority:1}),
    baPosts: async (id: number, opts: any) => { calls.push(['posts',id,opts]); await delay(40);if(fail.posts)throw Error('网络连接中断');return opts.page===1?makePosts(id):[{id:id*100+30,title:'最后一篇文章',senderName:'TR',content:'最后一篇'}] },
    baPostDetail: async (id: number) => { await delay(30);if(fail.detail)throw Error('详情接口失败');return {post:{id,title:'物理光学：从观察开始',content:'## 从一个问题开始\n\n光为什么会折射？从观察到推理，我们可以一步一步理解它。\n\n> 记录过程，也记录每次灵光一现。\n\n```js\nconst curious = true\n```\n\n<script>window.evil=true</script><img src=x onerror="window.evil=true">'}} },
    baGroups: async () => { await delay(20);if(fail.groups)throw Error('群聊接口失败');return [{groupId:'g1',name:'物理学习交流',avatar:picture,introduction:'一起记录和讨论'},{groupId:'g2',name:'学习打卡',avatar:''}] },
    baCreate: async (...args: any[]) => {calls.push(['create',...args]);await delay(70);if(fail.create)throw Error('创建失败');return 6000},
    baEdit: async (...args: any[]) => {calls.push(['edit',...args]);await delay(50);if(fail.edit)throw Error('保存失败')},
    baManage: async (...args: any[]) => {calls.push(['manage',...args]);await delay(50)},
    followBoard: async (...args: any[]) => {calls.push(['follow',...args]);await delay(80)}, unfollowBoard: async (...args: any[]) => {calls.push(['unfollow',...args]);await delay(80)},
    bindBaGroup: async (...args: any[]) => {calls.push(['bind',...args]);await delay(50)},
    uploadFile: async () => {await delay(30);return {url:picture}},
  },
  ui: { toast: (message: string) => errors.push(message) },
  console: { state: reactive({ slots:[],menus:{} }), addEntry() {} },
  on() {}, setTimeout(fn: any,ms: number) {const id=setTimeout(fn,ms);timers.push(id);return id}, set(key: string,value: any) {ctx[key]=value},
}
communityPlugin.apply(ctx)
const app=createApp(CommunityPage).provide('ctx',ctx)
app.mount('#app')
;(window as any).__community={ctx,calls,fail,errors}
window.addEventListener('beforeunload',()=>{app.unmount();for(const id of timers)clearTimeout(id)})
