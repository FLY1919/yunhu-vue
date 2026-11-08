/** All identities, messages and mutations in this fixture are local test data. */
import './fixture'
import { createApp } from 'vue'
import { groupAdminPlugin } from '../../src/plugins/group-admin'
import GroupPanel from '../../src/components/GroupPanel.vue'
const qa = (window as any).__qa, ctx = qa.ctx
qa.groupCalls = []
const info = { id:'normal',name:'云湖设计与开发',introduction:'讨论设计，记录想法。\n一起把聊天体验做得更好。',headcount:86,owner:'me',createBy:'founder',admins:['admin'],joinFree:false,readHistory:true,isPrivate:false,hideMembers:false,autoDeleteMessage:365,groupCode:'设计开发',limitedMsgType:'',denyUpload:false,myGroupNickname:'我的本群昵称',category:'技术' }
ctx.api.groupInfo = async (id:string) => ({ ...info,id })
ctx.api.listMembers = async (_id:string, p:any) => {
  const rows = [{ id:'me',name:'离线测试',level:100,role:'群主' },{ id:'admin',name:'林间',level:2,role:'管理员' },...Array.from({ length:84 },(_,i) => ({ id:'member-'+i,name:i === 0 ? '这是一位昵称特别长的群聊成员' : ['简一','木木','小夏','亦舟','山野','北岛'][i % 6] + (i || ''),level:0,role:'成员' }))]
  const selected = rows.filter(m => !p.keywords || (m.name + m.id).includes(p.keywords))
  return { list:selected.slice((p.page-1)*50,p.page*50),total:selected.length }
}
ctx.api.listBots = async () => [{ id:'design-bot',name:'灵感记录助手' }]
ctx.api.listTags = async () => []; ctx.api.addressBook = async () => ({ users:[],groups:[],bots:[] })
for (const name of ['editGroup','setMsgTypeLimit','editAutoDeleteMessage','editGroupKeyword','setGroupDiskUpload','setMyGroupNickname','kickMember','gagMember','setManageSetting','inviteBotToGroup','removeGroupBot']) {
  ctx.api[name] = async (...args:any[]) => {
    qa.groupCalls.push([name,...args])
    if (name === 'editGroup') Object.assign(info,args[1])
  }
}
ctx.get = (name:string) => ctx[name]
groupAdminPlugin.apply(ctx)
const host = document.createElement('div'); document.body.append(host)
const settings = createApp(GroupPanel); settings.provide('ctx',ctx); settings.mount(host)
await ctx.chat.open(ctx.chat.state.conversations.find((c:any) => c.id === 'normal'))
ctx.chat.state.messages.push({ id:'file-test',type:4,right:true,ts:Date.now(),senderId:'me',sender:'离线测试',elements:[{ type:'file',attrs:{ name:'yunhulaoda-1.0.34-windows-x64-setup.exe',size:28209152,src:'/fixture-download.exe' } }] })
qa.groupPanelsReady = true
window.addEventListener('beforeunload',() => settings.unmount())
