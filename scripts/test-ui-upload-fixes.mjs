/** Real Composer -> multipart upload -> protobuf send -> image renderer, offline only. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as pb from '../src/core/pb.ts'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const page=await browser.newPage({viewport:{width:1280,height:820}}), errors=[], uploads=[], sent=[], objects=new Map(), records=[]
page.on('pageerror',e=>errors.push(e.message))
let failImage=true, loseAck=false, omitRecord=false
try {
  await page.exposeFunction('__wireMessages',()=>records)
  await page.route('**/qa-api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(path.endsWith('/qiniu-token')) return route.fulfill({json:{code:1,data:{token:'offline-upload-token'}}})
    if(path.endsWith('/configure-distribution')) return route.fulfill({json:{code:1,data:{imageUrl:'https://chat-img.jwznb.com'}}})
    if(path.endsWith('/list-message-by-mid-seq') || path.endsWith('/list-message')) {
      const requestBody=pb.decode((typeof request!=='undefined'?request: req).postDataBuffer())
      const mid=pb.str(requestBody,8), hits=records.filter(m=>!mid||m.id===mid)
      return route.fulfill({body:Buffer.from(pb.build(pb.fBytes(1,pb.fNum(2,1)),...hits.map(m=>pb.fBytes(2,pb.build(pb.fStr(1,m.id),pb.fNum(4,2),pb.fBytes(5,pb.build(pb.fStr(3,m.content.image_url),pb.fNum(33,m.content.width),pb.fNum(34,m.content.height))))))))})
    }
    if(path.endsWith('/send-message')) {
      const body=pb.decode(request.postDataBuffer()),content=pb.msg(body,5),key=pb.str(content,3)
      assert.equal(pb.num(body,6),2);assert.ok(objects.has(key));assert.ok(pb.num(content,33)>0);assert.ok(pb.num(content,34)>0)
      sent.push({id:pb.str(body,2),key,width:pb.num(content,33),height:pb.num(content,34)})
      if(!omitRecord) records.push({id:pb.str(body,2),chatId:'normal',chatType:2,type:2,senderId:'me',sender:'Me',right:true,ts:Date.now(),content:{image_url:key,width:pb.num(content,33),height:pb.num(content,34)}})
      if(loseAck){loseAck=false;return route.fulfill({body:Buffer.alloc(0)})}
      omitRecord=false
      return route.fulfill({json:{code:1}})
    }
    throw new Error('Unexpected API '+path)
  })
  await page.route('**/up/**',async route=>{
    const req=route.request(), fd=await new Response(req.postDataBuffer(),{headers:await req.allHeaders()}).formData()
    const key=fd.get('key'),file=fd.get('file'),bytes=Buffer.from(await file.arrayBuffer())
    uploads.push({key,bytes});objects.set(key,{bytes,mime:file.type})
    return route.fulfill({json:{key}})
  })
  await page.route('**/res/chat-img.jwznb.com/**',route=>{
    const key=new URL(route.request().url()).pathname.split('/').pop(),object=objects.get(key)
    if(failImage){failImage=false;return route.fulfill({status:404,headers:{'cache-control':'no-store'},body:'not ready'})}
    return object ? route.fulfill({contentType:object.mime,body:object.bytes}) : route.fulfill({status:404,body:'missing'})
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`);await page.waitForFunction(()=>window.__qa)
  await page.evaluate(async()=>{
    const ctx=window.__qa.ctx;await ctx.chat.open(ctx.chat.state.conversations[0]);ctx.chat.state.messages=[];ctx.chat.state.hasMore=false
    const {apiPlugin}=await import('/src/plugins/api.ts'), wire={set(k,v){this[k]=v}};apiPlugin.apply(wire,{base:'/qa-api'});wire.api.setToken('offline-only')
    for(const k of ['uploadFile','uploadAndUrl','send'])ctx.api[k]=wire.api[k]
    ctx.api.messages=()=>window.__wireMessages()
  })
  const images=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#c34';x.fillRect(0,0,48,64);x.fillStyle='#48a';x.fillRect(48,0,48,64)
    return ['image/png','image/jpeg','image/webp'].map(type=>({mime:type,base64:c.toDataURL(type).split(',')[1]}))
  })
  const gif=await readFile('scripts/ui-fixture/animated.gif')
  const files=images.map((m,i)=>({name:'upload.'+['png','jpg','webp'][i],mimeType:i===2?'':m.mime,buffer:Buffer.from(m.base64,'base64')}));files.push({name:'upload.gif',mimeType:'image/gif',buffer:gif})
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(files)
  const pending = page.locator('.pending')
  await pending.waitFor()
  assert.equal(await pending.locator('.pend').count(), files.length)
  assert.equal(await pending.locator('input').count(), 0)
  assert.ok((await pending.boundingBox()).height < 70, 'staged images share one compact row')
  assert.equal(await pending.getByRole('button', { name: '附件图片属性' }).count(), files.length)
  for (let i = 0; i < files.length; i++) await pending.getByRole('button', { name: '移除附件' }).first().click()
  for(let i=0;i<files.length;i++) {
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(files[i])
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await page.waitForFunction(n=>window.__qa.ctx.chat.state.messages.length>=n,i+1)
    await page.waitForFunction(n=>[...document.querySelectorAll('img.media')].filter(e=>e.complete&&e.naturalWidth>0&&e.dataset.mediaState!=='released').length>=n,i+1)
    assert.deepEqual(uploads[i].bytes,files[i].buffer)
    assert.equal(sent[i].key,uploads[i].key)
  }
  assert.equal(uploads.length,4);assert.equal(sent.length,4)
  const img=page.locator('img.media').last();await img.click();await page.locator('.viewer-mask').waitFor()
  await page.locator('.viewer-img').hover();await page.mouse.wheel(0,-30)
  await page.waitForFunction(()=>parseInt(document.querySelector('.viewer-zoom').textContent)>100)
  const plain=await page.locator('.viewer-zoom').textContent()
  await page.keyboard.down('Control');await page.mouse.wheel(0,-20);await page.keyboard.up('Control')
  await page.waitForFunction(old=>parseInt(document.querySelector('.viewer-zoom').textContent)>parseInt(old),plain)
  await page.locator('.viewer-bar button[title="关闭"]').click()
  // A lost send response keeps the original attachment; retry finds the accepted server ID.
  loseAck=true;const uploadStart=uploads.length,sendStart=sent.length
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(files[0]);await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.pend-err').filter({hasText:'未确认发送结果'}).waitFor()
  assert.equal(uploads.length,uploadStart+1);assert.equal(sent.length,sendStart+1)
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.pend'))
  assert.equal(uploads.length,uploadStart+1);assert.equal(sent.length,sendStart+1)
  // An HTTP-success phantom never clears the attachment. Manual retry uses the same ID/key.
  omitRecord=true;await page.locator('input[type=file][accept="image/*"]').setInputFiles(files[0]);await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.pend-err').filter({hasText:'尚未确认图片已入库'}).waitFor()
  const attempt=sent.at(-1),beforeRetry=uploads.length
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.pend'))
  assert.equal(sent.at(-1).id,attempt.id);assert.equal(sent.at(-1).key,attempt.key);assert.equal(uploads.length,beforeRetry)
  const finalUploads=uploads.length,finalSends=sent.length
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'empty.png',mimeType:'image/png',buffer:Buffer.alloc(0)})
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.pend-err').filter({hasText:'文件内容为空'}).waitFor()
  assert.equal(uploads.length,finalUploads);assert.equal(sent.length,finalSends);assert.deepEqual(errors,[])
  console.log('PASS: PNG/JPEG/WebP/GIF upload bytes remain exact; real image messages carry key and dimensions, missing MIME is detected, 404 stays visible and retries, lost acknowledgement and phantom-success preserve originals; retry reuses ID/key without another upload; empty files do not send; plain/Ctrl wheel both zoom')
}finally{await browser.close();await server.close()}
