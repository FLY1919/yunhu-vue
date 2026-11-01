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
let failImage=true
try {
  await page.exposeFunction('__wireMessages',()=>records)
  await page.route('**/qa-api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(path.endsWith('/qiniu-token')) return route.fulfill({json:{code:1,data:{token:'offline-upload-token'}}})
    if(path.endsWith('/configure-distribution')) return route.fulfill({json:{code:1,data:{imageUrl:'https://chat-img.jwznb.com'}}})
    if(path.endsWith('/send-message')) {
      const body=pb.decode(request.postDataBuffer()),content=pb.msg(body,5),key=pb.str(content,3)
      assert.equal(pb.num(body,6),2);assert.ok(objects.has(key));assert.ok(pb.num(content,33)>0);assert.ok(pb.num(content,34)>0)
      sent.push({key,width:pb.num(content,33),height:pb.num(content,34)})
      records.push({id:pb.str(body,2),chatId:'normal',chatType:2,type:2,senderId:'me',sender:'Me',right:true,ts:Date.now(),content:{image_url:key,width:pb.num(content,33),height:pb.num(content,34)}})
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
  for(let i=0;i<files.length;i++) {
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(files[i])
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await page.waitForFunction(n=>window.__qa.ctx.chat.state.messages.length>=n,i+1)
    if(i===0){await page.getByRole('button',{name:'图片加载失败 · 点击重试',exact:true}).click()}
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
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'empty.png',mimeType:'image/png',buffer:Buffer.alloc(0)})
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.pend-err').filter({hasText:'文件内容为空'}).waitFor()
  assert.equal(uploads.length,4);assert.equal(sent.length,4);assert.deepEqual(errors,[])
  console.log('PASS: PNG/JPEG/WebP/GIF upload bytes remain exact; real image messages carry key and dimensions, missing MIME is detected, 404 stays visible and retries, empty files do not send, plain/Ctrl wheel both zoom')
}finally{await browser.close();await server.close()}
