/** Real Vue, multipart upload and protobuf send; only virtual accounts and local fixture bytes. */
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as pb from '../src/core/pb.ts'
import { build } from 'esbuild'
const built=await build({stdin:{contents:"export * from './src/core/image-properties'",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false})

const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'))
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})

const page=await browser.newPage({viewport:{width:1280,height:820}}),errors=[],uploads=[],sent=[],saved=[],records=[],objects=new Map()
page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)})
page.setDefaultTimeout(30000)
const shot=async name=>{if(process.env.UI_QA_SCREENSHOTS){await mkdir(process.env.UI_QA_SCREENSHOTS,{recursive:true});await page.screenshot({path:resolve(process.env.UI_QA_SCREENSHOTS,name+'.png')})}}
try {

 await page.exposeFunction('__wireMessages',()=>records)
 await page.route('**/qa-api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname
  if(path.endsWith('/qiniu-token')) return route.fulfill({json:{code:1,data:{token:'offline-upload-token'}}})
  if(path.endsWith('/configure-distribution')) return route.fulfill({json:{code:1,data:{imageUrl:'https://chat-img.jwznb.com'}}})
    if(path.endsWith('/list-message-by-mid-seq') || path.endsWith('/list-message')) {
      const requestBody=pb.decode((typeof request!=='undefined'?request: req).postDataBuffer())
      const mid=pb.str(requestBody,8), hits=records.filter(m=>!mid||m.id===mid)
      return route.fulfill({body:Buffer.from(pb.build(pb.fBytes(1,pb.fNum(2,1)),...hits.map(m=>pb.fBytes(2,pb.build(pb.fStr(1,m.id),pb.fNum(4,2),pb.fBytes(5,pb.build(pb.fStr(3,m.content.image_url),pb.fNum(33,m.content.width),pb.fNum(34,m.content.height))))))))})
    }
  if(path.endsWith('/send-message')) {
   const body=pb.decode(req.postDataBuffer()),content=pb.msg(body,5),key=pb.str(content,3);assert.equal(pb.num(body,6),2);assert.ok(objects.has(key))
   sent.push({key,width:pb.num(content,33),height:pb.num(content,34)})
   records.push({id:pb.str(body,2),chatId:'normal',chatType:2,type:2,senderId:'me',sender:'Me',right:true,ts:Date.now(),content:{image_url:key,width:pb.num(content,33),height:pb.num(content,34)}})
   return route.fulfill({json:{code:1}})
  }
  throw new Error('Unexpected API '+path)
 })
 await page.route('**/up/**',async route=>{
  const req=route.request(),fd=await new Response(req.postDataBuffer(),{headers:await req.allHeaders()}).formData(),key=fd.get('key'),file=fd.get('file'),bytes=Buffer.from(await file.arrayBuffer())
  uploads.push({key,name:file.name,mime:file.type,bytes});objects.set(key,{bytes,mime:file.type});return route.fulfill({json:{key}})
 })
 await page.route('**/local-save-image?*',async route=>{saved.push(route.request().postDataBuffer());return route.fulfill({json:{ok:true,path:'C:\\Offline\\cleaned-copy.png'}})})
 await page.route('**/res/chat-img.jwznb.com/**',route=>{const object=objects.get(new URL(route.request().url()).pathname.split('/').pop());return object?route.fulfill({contentType:object.mime,body:object.bytes}):route.fulfill({status:404})})

 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`, {waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__qa)
 await page.evaluate(async()=>{
  const ctx=window.__qa.ctx;await ctx.chat.open(ctx.chat.state.conversations[0]);ctx.chat.state.messages=[];ctx.chat.state.hasMore=false
  const {apiPlugin}=await import('/src/plugins/api.ts'),wire={set(k,v){this[k]=v}};apiPlugin.apply(wire,{base:'/qa-api'});wire.api.setToken('offline-only')
  for(const k of ['uploadFile','uploadAndUrl','send'])ctx.api[k]=wire.api[k]
  ctx.api.messages=()=>window.__wireMessages();window.__TAURI__={};document.documentElement.dataset.theme='dark'
 })

 for(const [i,ext] of ['jpg','png','webp'].entries()) {

  const original=await readFile(`scripts/image-properties-fixtures/photo.${ext}`)
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:`photo.${ext}`,mimeType:ext==='jpg'?'image/jpeg':`image/${ext}`,buffer:original})
  await page.getByRole('button',{name:'附件图片属性',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'图片属性',exact:true});await dialog.getByText('QA Camera',{exact:true}).waitFor();assert.ok((await dialog.textContent()).includes('GPS 纬度'))
  await dialog.getByLabel('搜索 EXIF',{exact:true}).fill('设备型号');assert.equal(await dialog.locator('.properties-tags dt').count(),1);await dialog.getByLabel('搜索 EXIF',{exact:true}).fill('')
  if(i===0){await dialog.evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))});await shot('image-properties-dark');await page.evaluate(()=>document.documentElement.dataset.theme='light');await shot('image-properties-light');await page.setViewportSize({width:360,height:760});assert.ok(await dialog.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await shot('image-properties-mobile');await page.setViewportSize({width:1280,height:820})}
  assert.equal(await dialog.getByRole('button',{name:'清除 EXIF',exact:true}).count(),0)
  assert.match(await dialog.locator('.properties-tags dt').first().textContent(),/设备型号/)
  await dialog.getByRole('button',{name:'关闭属性',exact:true}).click()
  await page.locator('.pend img').click();const edit=page.getByRole('dialog',{name:'编辑图片',exact:true});await edit.getByRole('button',{name:'EXIF 隐私',exact:true}).click()
  await edit.getByRole('button',{name:'清除 EXIF',exact:true}).click();await edit.getByRole('button',{name:'保存副本',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.ied-metadata-status')?.textContent.includes('副本已保存'))
  await edit.getByRole('button',{name:'应用到附件',exact:true}).click();await edit.waitFor({state:'detached'})
  const pending=await page.evaluate(async()=>{const ctx=window.__qa.ctx,p=ctx.chat.drafts.get(ctx.chat.state.current).pending[0];return {name:p.file.name,hasElements:!!p.elements,bytes:Array.from(new Uint8Array(await p.file.arrayBuffer()))}})
  assert.match(pending.name,/_no-exif/);assert.equal(pending.hasElements,false);assert.deepEqual(Buffer.from(pending.bytes),Buffer.from(core.stripExifBytes(original)))
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(n=>window.__qa.ctx.chat.state.messages.length>=n,i+1)
  assert.deepEqual(uploads[i].bytes,Buffer.from(pending.bytes));assert.deepEqual(saved[i],uploads[i].bytes);assert.equal(sent[i].width,48);assert.equal(sent[i].height,32)
 }
 // Rotated JPEG: bake the browser-visible orientation into PNG with exactly the same visible pixels.
 const oriented=await readFile('scripts/image-properties-fixtures/oriented.jpg')
 await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'oriented.jpg',mimeType:'image/jpeg',buffer:oriented})
 const before=await page.evaluate(async()=>{const ctx=window.__qa.ctx,p=ctx.chat.drafts.get(ctx.chat.state.current).pending[0],img=new Image();img.src=p.url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {w:c.width,h:c.height,pixels:Array.from(x.getImageData(0,0,c.width,c.height).data)}})
 await page.locator('.pend img').click();let edit=page.getByRole('dialog',{name:'编辑图片',exact:true});await edit.getByRole('button',{name:'EXIF 隐私',exact:true}).click()
 await edit.getByRole('button',{name:'清除 EXIF',exact:true}).click();await edit.getByRole('button',{name:'应用到附件',exact:true}).click();await edit.waitFor({state:'detached'})
 const dialog=page.getByRole('dialog',{name:'图片属性',exact:true})
 const after=await page.evaluate(async()=>{const ctx=window.__qa.ctx,p=ctx.chat.drafts.get(ctx.chat.state.current).pending[0],img=new Image();img.src=p.url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {w:c.width,h:c.height,pixels:Array.from(x.getImageData(0,0,c.width,c.height).data),name:p.file.name}})
 assert.equal(after.name,'oriented_no-exif.png');assert.deepEqual({w:before.w,h:before.h},{w:32,h:48});assert.deepEqual(after.pixels,before.pixels)
 await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__qa.ctx.chat.state.messages.length>=4);assert.equal(sent[3].width,32);assert.equal(sent[3].height,48)
 // Open the actual message toolbar; cleaning and queuing is separate from sending.
 const viewerSource=await readFile('scripts/image-properties-fixtures/photo.jpg');objects.set('viewer-photo.jpg',{bytes:viewerSource,mime:'image/jpeg'})
 await page.evaluate(()=>{const ctx=window.__qa.ctx;ctx.chat.state.messages.push({id:'viewer-photo',chatId:'normal',chatType:2,type:2,senderId:'me',sender:'Me',ts:Date.now(),content:{image_url:'viewer-photo.jpg',width:48,height:32}})})
 await page.locator('img.media').last().click()
 // Left-drag works at 100%, remains open on release, and clicking the image no longer closes it.
 const viewerImage=page.locator('.viewer-img'), box=await viewerImage.boundingBox()
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+65,box.y+box.height/2+35,{steps:8});await page.mouse.up()
 assert.equal(await page.locator('.viewer-mask').count(),1)
 assert.ok((await viewerImage.boundingBox()).x-box.x>=64)
 await viewerImage.click();assert.equal(await page.locator('.viewer-mask').count(),1)
 await page.getByRole('button',{name:'图片属性',exact:true}).click();await dialog.getByText('QA Camera',{exact:true}).waitFor()
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await page.locator('.viewer-mask').waitFor()
 await page.getByRole('button',{name:'编辑图片',exact:true}).click();edit=page.getByRole('dialog',{name:'编辑图片',exact:true});await edit.getByRole('button',{name:'EXIF 隐私',exact:true}).click();await edit.getByRole('button',{name:'清除 EXIF',exact:true}).click()
 await edit.getByRole('button',{name:'加入待发送附件',exact:true}).click();await edit.waitFor({state:'detached'});assert.equal(uploads.length,4)
 await page.locator('.viewer-bar button[title="关闭"]').click();assert.equal(await page.getByRole('button',{name:'附件图片属性',exact:true}).count(),1)
 // The property panel stays read-only; cleaning without EXIF is allowed in the editor.
 await page.locator('.pend-x').click()
 await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'animation.gif',mimeType:'image/gif',buffer:await readFile('scripts/ui-fixture/animated.gif')})
 await page.getByRole('button',{name:'附件图片属性',exact:true}).click();await dialog.getByText('EXIF：无',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'清除 EXIF',exact:true}).count(),0)
 await page.getByRole('button',{name:'关闭属性',exact:true}).click()
 await page.locator('.pend img').click();edit=page.getByRole('dialog',{name:'编辑图片',exact:true});await edit.getByRole('button',{name:'EXIF 隐私',exact:true}).click();await edit.getByRole('button',{name:'清除 EXIF',exact:true}).click();await edit.getByRole('button',{name:'应用到附件',exact:true}).click();await edit.waitFor({state:'detached'})
 const gifBytes=await page.evaluate(async()=>{const {ctx}=window.__qa,p=ctx.chat.drafts.get(ctx.chat.state.current).pending[0];return Array.from(new Uint8Array(await p.file.arrayBuffer()))})
 assert.deepEqual(Buffer.from(gifBytes),await readFile('scripts/ui-fixture/animated.gif'))
 for (const damaged of [false,true]) {
  await page.locator('.pend-x').click()
  const bytes=damaged?Buffer.from(await readFile('scripts/image-properties-fixtures/photo.jpg')):Buffer.from(core.stripExifBytes(await readFile('scripts/image-properties-fixtures/photo.png')))
  if(damaged) { const tiff=bytes.indexOf(Buffer.from('Exif\0\0'))+6;bytes[tiff]=0;bytes[tiff+1]=0 }
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:damaged?'damaged.jpg':'empty.png',mimeType:damaged?'image/jpeg':'image/png',buffer:bytes})
  await page.getByRole('button',{name:'附件图片属性',exact:true}).click();await dialog.getByText('EXIF：无',{exact:true}).waitFor();assert.equal(await dialog.locator('.properties-error').count(),0)
  await page.getByRole('button',{name:'关闭属性',exact:true}).click()
  await page.locator('.pend img').click();edit=page.getByRole('dialog',{name:'编辑图片',exact:true});await edit.getByRole('button',{name:'EXIF 隐私',exact:true}).click()
  const cleanButton=edit.getByRole('button',{name:'清除 EXIF',exact:true});await cleanButton.waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="EXIF 隐私设置"] button').disabled);assert.equal(await cleanButton.isEnabled(),true)
  await cleanButton.click();await edit.getByText('EXIF 已清除并校验。可保存副本，或使用下方按钮应用到待发送附件。',{exact:true}).waitFor()
  await edit.getByRole('button',{name:'应用到附件',exact:true}).click();await edit.waitFor({state:'detached'})
  const data=await page.evaluate(async()=>{const {readImageProperties}=await import('/src/core/image-properties.ts'),p=window.__qa.ctx.chat.drafts.get(window.__qa.ctx.chat.state.current).pending[0];const info=await readImageProperties(p.file);return {hasExif:info.hasExif,w:info.width,h:info.height}})
  assert.deepEqual(data,{hasExif:false,w:48,h:32})
 }
 assert.deepEqual(errors,[])
 console.log('PASS: read-only EXIF/GPS panel, model-first sorting, editor-only cleaning, search, dark/light/mobile, saved bytes == replacement == multipart upload, protobuf dimensions, Orientation 6 pixel equality, message toolbar queuing without auto-send, Escape and GIF states')
} finally {await browser.close();await server.close()}
