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
  const ctx = { api, ui: { toast: (...args) => toasts.push(args) }, console: { addEntry() {} }, set: (key,value) => ctx[key]=value, on: (key,fn) => events.set(key,fn), setTimeout() {} }
  communityPlugin.apply(ctx)
  return { cm:ctx.community, s:ctx.community.state, api,toasts,calls,events }
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
