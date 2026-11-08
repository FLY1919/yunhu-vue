/** Actual API codec and upload pipeline; a local fake server models lost/invalid acknowledgements. */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const temp=await mkdtemp(join(process.cwd(),'node_modules','.delivery-'))
await build({stdin:{contents:"export {apiPlugin} from './src/plugins/api';export * as pb from './src/core/pb';export * from './src/core/upload-image';",resolveDir:process.cwd()},outfile:join(temp,'subject.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'})
const {apiPlugin,pb,normalizeImageUpload}=await import(pathToFileURL(join(temp,'subject.mjs')))
const original={fetch:globalThis.fetch,XMLHttpRequest:globalThis.XMLHttpRequest,localStorage:globalThis.localStorage}
after(async()=>{await rm(temp,{recursive:true,force:true})})
const photo=await readFile('scripts/image-properties-fixtures/photo.png')
function fixture({empty=false,store=true,miss=0,badKey=false,resourceFails=0}={}) {
 const ctx={set(k,v){this[k]=v}},sent=[],records=[];let checks=0,probes=0
 globalThis.localStorage={getItem:()=>null,setItem(){}}
 apiPlugin.apply(ctx,{base:'/test'});ctx.api.setToken('fixture-only')
 globalThis.fetch=async(url,init={})=>{
  if(String(url).startsWith('/res/')){probes++;return probes<=resourceFails?new Response('missing',{status:404}):new Response(photo.subarray(0,64),{headers:{'content-type':'image/png'}})}
  if(url.endsWith('/configure-distribution'))return Response.json({code:1,data:{imageUrl:'https://chat-img.jwznb.com/'}})
  if(url.endsWith('/send-message')){const d=pb.decode(init.body),id=pb.str(d,2),c=pb.msg(d,5);sent.push({id,key:pb.str(c,3)});if(store)records.push({id,key:badKey?'wrong.png':pb.str(c,3)});return empty?new Response(new Uint8Array()):Response.json({code:1})}
  if(url.endsWith('/list-message-by-mid-seq')||url.endsWith('/list-message')){checks++;const hits=checks<=miss?[]:records;return new Response(pb.build(pb.fBytes(1,pb.fNum(2,1)),...hits.map(m=>pb.fBytes(2,pb.build(pb.fStr(1,m.id),pb.fNum(4,2),pb.fBytes(5,pb.fStr(3,'https://chat-img.jwznb.com/'+m.key)))))))}
  throw Error('Unexpected '+url)
 }
 return {api:ctx.api,sent,records,get checks(){return checks},get probes(){return probes}}
}
await test('missing/wrong MIME and suffix use the actual image format without changing a byte',async()=>{
 const file=new File([photo],'Screenshot',{type:'application/octet-stream'}),normalized=await normalizeImageUpload(file)
 assert.equal(normalized.name,'Screenshot.png');assert.equal(normalized.type,'image/png');assert.deepEqual(Buffer.from(await normalized.arrayBuffer()),photo)
})
await test('a transient CDN 404 is retried before sending and the original key is confirmed from server history',async()=>{
 const f=fixture({resourceFails:1});assert.equal(await f.api.send('g',2,2,{image_url:'photo.png',width:48,height:32},{msgId:'stable'}),'stable');assert.equal(f.probes,2);assert.equal(f.sent.length,1);assert.equal(f.sent[0].key,'photo.png');assert.ok(f.checks>0)
})
await test('an unreadable object cannot be advertised as a sent image',async()=>{
 const f=fixture({resourceFails:10});await assert.rejects(()=>f.api.send('g',2,2,{image_url:'photo.png'}),/图片资源暂不可读取/);assert.equal(f.sent.length,0)
})
await test('an empty HTTP 200 send response is not success',async()=>{
 const f=fixture({empty:true});await assert.rejects(()=>f.api.send('g',2,2,{image_url:'photo.png'}),/未确认发送结果/);assert.equal(f.sent.length,1)
})
await test('HTTP success without the actual image in history keeps delivery unconfirmed',async()=>{
 const f=fixture({store:false});await assert.rejects(()=>f.api.send('g',2,2,{image_url:'photo.png'}),/尚未确认图片已入库/);assert.equal(f.sent.length,1);assert.equal(f.checks,3)
})
await test('retry after a lost readback confirms the same ID without sending a second message',async()=>{
 const f=fixture({miss:3});await assert.rejects(()=>f.api.send('g',2,2,{image_url:'photo.png'},{msgId:'stable'}),/尚未确认/)
 assert.equal(await f.api.send('g',2,2,{image_url:'photo.png'},{msgId:'stable',retry:true}),'stable');assert.equal(f.sent.length,1)
})
await test('wrong object key in the server record never confirms the intended image',async()=>{
 const f=fixture({badKey:true});await assert.rejects(()=>f.api.send('g',2,2,{image_url:'photo.png'}),/尚未确认/)
})
await test('upload response size must agree with the file actually uploaded',async()=>{
 const f=fixture();f.api.uploadToken=async()=> 'fixture-token'
 globalThis.XMLHttpRequest=class {upload={};open(){}send(body){this.status=200;this.responseText=JSON.stringify({key:body.get('key'),fsize:1});queueMicrotask(()=>this.onload())}}
 await assert.rejects(()=>f.api.uploadFile(new File([photo],'image.png'),'image'),/大小校验失败/)
})
await test('official draft CRUD uses the documented fields and rotated draft IDs; older lists fall back read-only',async()=>{
 const f=fixture(),calls=[]
 globalThis.fetch=async(url,init={})=>{const body=init.body?JSON.parse(init.body):null;calls.push([url,body,init.method]);
  if(url.endsWith('/community/drafts'))return new Response('',{status:404})
  if(url.endsWith('/my-post-list'))return Response.json({code:1,data:{posts:[{id:8,isDraft:'1'},{id:9,isDraft:0}]}})
  if(url.endsWith('/create-draft'))return Response.json({code:1,data:{id:18}})
  if(url.endsWith('/get-draft'))return Response.json({code:1,data:{posts:{id:18,title:'云端草稿'}}})
  return Response.json({code:1})}
 assert.equal(await f.api.baSaveDraft(925,'标题','正文',2,8),18);assert.deepEqual(calls[0][1],{baId:925,title:'标题',content:'正文',contentType:2,draftId:8})
 assert.equal((await f.api.baGetDraft(18,925)).title,'云端草稿');assert.equal((await f.api.baDrafts()).list.length,1);await f.api.baDeleteDraft(18);await f.api.baCreatePost(925,'标题','正文',2,18)
 assert.deepEqual(calls.find(c=>c[0].endsWith('/cancel-draft'))[1],{draftId:18});assert.equal(calls.at(-1)[1].draftId,18)
})

Object.assign(globalThis,original)
