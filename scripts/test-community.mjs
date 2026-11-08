import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const temp = await mkdtemp(join(resolve('node_modules'), '.community-test-'))
const bundle = join(temp, 'community.mjs')
await build({ entryPoints: ['src/plugins/community.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'stub-ui', setup(b) { b.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }] })
const { communityPlugin } = await import(pathToFileURL(bundle))
after(() => rm(temp, { recursive: true, force: true }))
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(overrides = {}) {
  const events = new Map(), toasts = [], calls = []
  const api = { baList: async typ => typ === 3 ? [{id:'1',name:'我的'}] : [], baInfo: async id => ({id,postNum:id}), baPosts: async () => [], baPostDetail: async id => ({post:{id,title:'全文',content:'正文'}}), baGroups: async () => [], baCreate: async () => 9, baEdit: async (...v) => calls.push(['edit',...v]), baManage: async (...v) => calls.push(['manage',...v]), followBoard: async () => {}, unfollowBoard: async () => {}, ...overrides }
  const ctx = { auth: { state: { user: { id: 'test-user' } } }, api, ui: { toast: (...args) => toasts.push(args), confirm: async () => true }, console: { addEntry() {} }, set: (key,value) => ctx[key]=value, on: (key,fn) => events.set(key,fn), setTimeout() {} }
  communityPlugin.apply(ctx)
  return { ctx, cm:ctx.community, s:ctx.community.state, api,toasts,calls,events }
}
await test('late categories cannot replace a newer tab or its loading state', async () => {
  const a=deferred(), b=deferred(), f=fixture({baList:typ=>typ===2?a.promise:typ===4?b.promise:Promise.resolve([])})
  const first=f.cm.load(2), next=f.cm.load(4)
  b.resolve([{id:4}]); await next; a.resolve([{id:2}]); await first
  assert.equal(f.s.listType,4); assert.deepEqual(f.s.list.map(x=>x.id),[4]); assert.equal(f.s.loading,false)
})
await test('switching boards invalidates stale info, posts and an open article detail',async()=>{
  const a=deferred(), infoA=deferred(), detail=deferred(), f=fixture({baInfo:id=>id===1?infoA.promise:Promise.resolve({id}),baPosts:id=>id===1?a.promise:Promise.resolve([{id:22}]),baPostDetail:()=>detail.promise})
  const first=f.cm.enter({id:1}); const oldDetail=f.cm.openPost({id:11}); const next=f.cm.enter({id:2}); await next
  a.resolve([{id:11}]); infoA.resolve({id:1}); detail.resolve({title:'旧文章',content:'旧正文'}); await first; await oldDetail; await tick()
  assert.equal(f.s.viewing.id,2); assert.equal(f.s.info.id,2); assert.deepEqual(f.s.posts.map(x=>x.id),[22]); assert.equal(f.s.postDetail,null)
})
await test('shared posts open the actual article even with a preview and can return to its board', async () => {
  const routes = [], ids = [], f = fixture({ baPostDetail: async id => {
    ids.push(id)
    return { post: { id, title: '完整标题', content: '完整正文', contentType: 2, baId: 27 }, ba: { id: 27, name: '所属板块' } }
  } })
  f.ctx.console.goto = route => routes.push(route)
  assert.equal(await f.cm.openSharedPost({ id: 118, title: '预览标题', content: '截断正文' }), true)
  assert.deepEqual(routes, ['/community'])
  assert.deepEqual(ids, [118])
  assert.equal(f.s.postDetail.content, '完整正文')
  assert.equal(f.s.viewing.id, 27)
  f.cm.openPostList()
  await tick()
  assert.equal(f.s.postDetail, null)
  assert.equal(f.s.viewing.name, '所属板块')
})
await test('closing an article prevents a late detail from reopening it',async()=>{
  const d=deferred(), f=fixture({baPostDetail:()=>d.promise}); await f.cm.enter({id:1}); const p=f.cm.openPost({id:11});f.cm.backToPosts();d.resolve({title:'迟到'});await p
  assert.equal(f.s.postDetail,null);assert.equal(f.s.loadingDetail,false)
})
await test('failed next page retries the same page, deduplicates items and stops at the end',async()=>{
  let fail=true;const pages=[],f=fixture({baPosts:async(_id,{page})=>{pages.push(page);if(page===1)return Array.from({length:30},(_,id)=>({id}));if(fail){fail=false;throw Error('断网')}return [{id:29},{id:30}]}})
  await f.cm.enter({id:1});await f.cm.loadMorePosts();assert.equal(f.s.postPage,1);assert.match(f.s.postsError,/断网/)
  await f.cm.loadMorePosts();assert.deepEqual(pages,[1,2,2]);assert.equal(f.s.posts.length,31);assert.equal(f.s.postPage,2);assert.equal(f.s.hasMorePosts,false);await f.cm.loadMorePosts();assert.equal(pages.length,3)
})
await test('group responses are scoped to their dialog and missing bind API cannot report success',async()=>{
  const d=deferred(),f=fixture({baGroups:id=>id===1?d.promise:Promise.resolve([{groupId:2}])});await tick()
  const old=f.cm.loadGroups({id:1});await f.cm.loadGroups({id:2});d.resolve([{groupId:1}]);await old
  assert.equal(f.s.groups[0].groupId,2);await f.cm.loadGroups({id:1});assert.equal(await f.cm.bindGroup(1,'33'),false);assert.match(f.toasts.at(-1)[0],/不支持/)
  f.cm.closeGroups();assert.equal(f.s.groupsOf,null)
})
await test('failed creation preserves avatar and validation prevents blank or oversized submissions',async()=>{
  let calls=0;const f=fixture({baCreate:async()=>{calls++;throw Error('失败')}});f.s.newAvatar='keep.png'
  assert.equal(await f.cm.createWithAvatar('  '),false);assert.equal(await f.cm.create('一'.repeat(11)),false);assert.equal(calls,0)
  assert.equal(await f.cm.createWithAvatar('有效名称'),false);assert.equal(f.s.newAvatar,'keep.png');assert.equal(f.s.creating,false)
})
await test('only owned boards may be edited; successful edit updates selected board without changing category',async()=>{
  const f=fixture();await tick();assert.equal(f.cm.owns(1),true);f.s.list=[{id:1,name:'旧名称'}];f.s.viewing={id:1,name:'旧名称'};f.s.listType=2
  assert.equal(await f.cm.edit(2,{name:'无权限'}),false);assert.equal(await f.cm.manage(2,0,0),false);assert.equal(f.calls.length,0)
  assert.equal(await f.cm.edit(1,{name:'新名称',avatar:'new.png'}),true);assert.equal(f.s.viewing.name,'新名称');assert.equal(f.s.list[0].avatar,'new.png');assert.equal(f.s.listType,2)
})
await test('avatar upload writes to the shared editing draft and rejects invalid file types',async()=>{
  const f=fixture({uploadFile:async()=>({key:'avatar.png'})});f.s.editing={id:1,avatar:''}
  const event={target:{files:[{type:'image/png',size:64}],value:'file'}};assert.equal(await f.cm.uploadAvatar(event,'edit'),true);assert.match(f.s.editing.avatar,/avatar.png$/);assert.equal(event.target.value,'')
  event.target.files[0].type='text/plain';assert.equal(await f.cm.uploadAvatar(event,'new'),false)
})
await test('double follow clicks are serialized, failures keep existing follow state',async()=>{
  let count=0;const d=deferred(),f=fixture({unfollowBoard:()=>{count++;return d.promise}});f.s.followReady=true;f.s.followIds=[1]
  const first=f.cm.toggleFollow({id:1});assert.equal(await f.cm.toggleFollow({id:1}),false);assert.equal(count,1);d.reject(Error('断网'));await first
  assert.equal(f.cm.isFollowed(1),true);assert.deepEqual(f.s.following,[])
})
await test('logout invalidates pending read requests and clears private board data',async()=>{
 const d=deferred(),f=fixture({baPosts:()=>d.promise});const p=f.cm.enter({id:1});f.events.get('auth/logout')();d.resolve([{id:1}]);await p;assert.equal(f.s.viewing,null);assert.deepEqual(f.s.posts,[]);assert.deepEqual(f.s.myIds,[])
})

const localValues = new Map()
globalThis.localStorage = { getItem: k => localValues.get(k) || null, setItem: (k,v) => localValues.set(k,v), removeItem: k => localValues.delete(k) }
await test('post interactions normalize string flags, serialize clicks and leave failures unchanged', async () => {
 const d=deferred(),f=fixture({baPostLike:()=>d.promise,baPostCollect:async()=>{throw Error('断网')}})
 f.s.postDetail={id:10,isLiked:'0',isCollected:'0',likeNum:4};f.s.posts=[{...f.s.postDetail}]
 const pending=f.cm.togglePost('like');assert.equal(await f.cm.togglePost('like'),false);d.resolve();await pending
 assert.equal(f.s.postDetail.isLiked,1);assert.equal(f.s.postDetail.likeNum,5);assert.equal(f.s.posts[0].likeNum,5)
 assert.equal(await f.cm.togglePost('collect'),false);assert.equal(f.s.postDetail.isCollected,'0')
})
await test('late comments cannot replace a new post; failed sends retain the text and reject duplicates', async () => {
 const d=deferred(),f=fixture({baComments:()=>d.promise,baComment:async()=>{throw Error('评论失败')}})
 f.s.viewing={id:1};f.s.postDetail={id:10};const pending=f.cm.loadComments();f.cm.backToPosts();d.resolve({comments:[{id:1}]});await pending
 assert.deepEqual(f.s.comments,[]);assert.equal(f.s.loadingComments,false)
 f.s.postDetail={id:11};f.s.commentText='保留评论';assert.equal(await f.cm.comment(),false);assert.equal(f.s.commentText,'保留评论')
})
await test('manual cloud draft save uses returned replacement IDs and publishing consumes only the saved draft', async () => {
 const calls=[],f=fixture({baSaveDraft:async(...v)=>{calls.push(v);return calls.length===1?100:101},baDrafts:async()=>({list:[],more:false}),baCreatePost:async(...v)=>calls.push(['publish',...v])})
 f.s.viewing={id:925,name:'笔记'};f.cm.openEditor();Object.assign(f.s.editor,{title:'我的文章',content:'正文'})
 assert.equal(calls.length,0);assert.equal(await f.cm.saveDraft(),true);assert.equal(f.s.editor.cloudId,100);assert.equal(f.cm.editorDirty(),false)
 f.s.editor.content='更新';assert.equal(await f.cm.saveDraft(),true);assert.equal(calls[1][4],100);assert.equal(f.s.editor.cloudId,101)
 assert.equal(await f.cm.publish(),true);assert.deepEqual(calls.at(-1),['publish',925,'我的文章','更新',2,101]);assert.equal(f.s.editor,null)
})
await test('cloud save failure preserves text and close requires an explicit discard decision', async () => {
 const f=fixture({baSaveDraft:async()=>{throw Error('断网')}});f.s.viewing={id:1,name:'一'};f.cm.openEditor();Object.assign(f.s.editor,{title:'标题',content:'正文'})
 assert.equal(await f.cm.saveDraft(),false);assert.match(f.s.editorError,/云端草稿保存失败/);assert.equal(f.s.editor.content,'正文');f.ctx.ui.confirm=async()=>false
 assert.equal(await f.cm.closeEditor(),false);assert.ok(f.s.editor)
})
await test('concurrent manual saves are serialized and a late response cannot mark newer text as saved', async () => {
 const d=deferred();let calls=0;const f=fixture({baSaveDraft:()=>{calls++;return d.promise}});f.s.viewing={id:1};f.cm.openEditor();f.s.editor.content='保存时内容'
 const saving=f.cm.saveDraft();assert.equal(await f.cm.saveDraft(),false);f.s.editor.content='后续修改';d.resolve(42);await saving
 assert.equal(calls,1);assert.equal(f.s.editor.cloudId,42);assert.equal(f.s.savedAt,0);assert.equal(f.cm.editorDirty(),true)
})
await test('account switches discard late cloud lists, saves and publish completions without leaking drafts', async () => {
 const d=deferred(),list=deferred(),f=fixture({baSaveDraft:()=>d.promise,baDrafts:()=>list.promise});f.s.viewing={id:1};f.cm.openEditor();f.s.editor.content='上一账号'
 const saving=f.cm.saveDraft(),loading=f.cm.refreshDrafts();f.events.get('auth/logout')();f.ctx.auth.state.user.id='next';d.resolve(99);list.resolve({list:[{id:99,content:'上一账号'}],more:false});await saving;await loading
 assert.equal(f.s.editor,null);assert.equal(f.s.savingDraft,false);assert.deepEqual(f.s.drafts,[])
})
await test('resume reads current cloud content and failed deletion leaves the cloud draft visible', async () => {
 const f=fixture({baDrafts:async()=>({list:[{id:3,baId:925,title:'旧标题',content:'旧内容'}],more:false}),baGetDraft:async()=>({id:3,baId:925,title:'云端最新',content:'最新内容'}),baDeleteDraft:async()=>{throw Error('删除失败')}})
 await f.cm.refreshDrafts();const d=f.s.drafts[0];assert.equal(await f.cm.resumeDraft(d),true);assert.equal(f.s.editor.content,'最新内容');await f.cm.deleteDraft(d.id);assert.equal(f.s.drafts.length,1)
})
await test('publication failure retains the editor without silently uploading an automatic cloud draft', async () => {
 let saves=0;const f=fixture({baSaveDraft:async()=>{saves++;return 1},baCreatePost:async()=>{throw Error('服务器失败')}});f.s.viewing={id:925};f.cm.openEditor();Object.assign(f.s.editor,{title:'标题',content:'正文'})
 assert.equal(await f.cm.publish(),false);assert.equal(saves,0);assert.equal(f.s.editor.content,'正文');assert.match(f.s.editorError,/编辑内容已保留/)
})
await test('publishing keeps the board chosen when writing began, even after another board is viewed',async()=>{
 const calls=[],f=fixture({baDrafts:async()=>({list:[],more:false}),baCreatePost:async(...v)=>calls.push(v)})
 f.s.viewing={id:925,name:'开始写作的板块'};f.cm.openEditor();Object.assign(f.s.editor,{title:'标题',content:'正文'})
 f.s.viewing={id:1009,name:'另一个板块'}
 assert.equal(await f.cm.publish(),true);assert.equal(calls[0][0],925)
})
await test('cloud draft detail missing board ID preserves the original target board',async()=>{
 const f=fixture({baGetDraft:async()=>({id:40,title:'云端标题',content:'云端正文'})})
 assert.equal(await f.cm.resumeDraft({id:'cloud:40',cloudId:40,owner:'test-user',baId:925,boardName:'笔记',title:'标题',content:'正文',contentType:2,updatedAt:1}),true)
 assert.equal(f.s.editor.baId,925);assert.equal(f.s.editor.boardName,'笔记')
})
await test('offline recovery opens the newer local backup instead of fetching an older cloud revision', async () => {
 localValues.clear()
 const backup={id:'local-recovery',cloudId:42,owner:'test-user',baId:925,boardName:'笔记',title:'恢复',content:'较新的本机内容',contentType:2,updatedAt:Date.now()}
 localValues.set('yh.community.drafts.v1:test-user',JSON.stringify([backup]))
 let reads=0;const f=fixture({baDrafts:async()=>{throw Error('offline')},baGetDraft:async()=>{reads++;throw Error('must not fetch')}})
 await f.cm.refreshDrafts();assert.match(f.s.draftsError,/offline/);assert.equal(f.s.drafts.length,1)
 assert.equal(await f.cm.resumeDraft(f.s.drafts[0]),true);assert.equal(f.s.editor.content,backup.content);assert.equal(reads,0)
 localValues.clear()
})
await test('silent cloud saves remove matching recovery copies but keep changes made during the save', async () => {
 localValues.clear();const d=deferred(),f=fixture({baSaveDraft:()=>d.promise});f.s.viewing={id:925};f.cm.openEditor();f.s.editor.content='snapshot'
 const key='yh.community.drafts.v1:test-user';localValues.set(key,JSON.stringify([{...f.s.editor}]))
 const save=f.cm.saveDraft({silent:true});f.s.editor.content='newer';localValues.set(key,JSON.stringify([{...f.s.editor}]))
 d.resolve(42);await save;assert.equal(JSON.parse(localValues.get(key))[0].content,'newer');assert.equal(f.toasts.length,0)
 f.api.baSaveDraft=async()=>43;await f.cm.saveDraft({silent:true});assert.deepEqual(JSON.parse(localValues.get(key)),[]);assert.equal(f.toasts.length,0)
 localValues.clear()
})
await test('deleting a local recovery copy leaves a same-ID cloud draft untouched', async () => {
 localValues.clear();let deletes=0;const f=fixture({baDeleteDraft:async()=>{deletes++}})
 const draft={id:'cloud:42',cloudId:42,owner:'test-user',baId:925,title:'草稿',content:'本机较新',contentType:2,updatedAt:Date.now()}
 localValues.set('yh.community.drafts.v1:test-user',JSON.stringify([draft]))
 f.s.drafts=[{...draft,content:'云端旧内容'},{...draft,legacy:true}]
 await f.cm.deleteDraft('cloud:42',true);assert.equal(deletes,0);assert.equal(f.s.drafts.length,1);assert.equal(f.s.drafts[0].content,'云端旧内容');assert.deepEqual(JSON.parse(localValues.get('yh.community.drafts.v1:test-user')),[])
 localValues.clear()
})
