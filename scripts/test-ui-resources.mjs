import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import gifenc from 'gifenc'
const { GIFEncoder } = gifenc
const encoder=GIFEncoder(), size=512
for(let frame=0;frame<6;frame++) {
  const pixels=new Uint8Array(size*size)
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) pixels[y*size+x]=((x+frame*24)%128<64?1:0)
  encoder.writeFrame(pixels,size,size,{palette:[[45,66,88],[230,120,60]],delay:100,repeat:0})
}
encoder.finish();const animation=Buffer.from(encoder.bytes())
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({root:process.cwd(),configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const page=await browser.newPage({viewport:{width:1280,height:820}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/qa-gif/*.gif',route=>route.fulfill({status:200,contentType:'image/gif',body:animation}))
await page.route('**/qa-video/*.mp4',route=>route.abort())
const counts=()=>page.locator('.sticker').evaluateAll(imgs=>({total:imgs.length,source:imgs.filter(i=>i.dataset.mediaState==='source').length,preview:imgs.filter(i=>i.dataset.mediaState==='preview').length,released:imgs.filter(i=>i.dataset.mediaState==='released').length}))
try{
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`)
 await page.waitForFunction(()=>window.__qa)
 await page.evaluate(async()=>{
  const {ctx}=window.__qa,resource=await import('/src/core/resource-mode.ts');window.__resources=resource
  resource.setResourceMode(false)
  await ctx.chat.open(ctx.chat.state.conversations.find(c=>c.id==='normal'))
  ctx.chat.state.hasMore=false
  ctx.chat.state.messages=Array.from({length:48},(_,i)=>({id:'pressure-'+i,type:7,ts:Date.now()+i,senderId:'other',sender:'测试',content:{},elements:[{type:'sticker',attrs:{src:'/qa-gif/'+i+'.gif',packId:5,itemId:i}}]}))
 })
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=source]').length===48)
 const before=await counts()
 await page.evaluate(()=>window.__resources.setResourceMode(true))
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=released]').length>35)
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=preview]').length>0)
 const after=await counts();assert.ok(after.source<5);assert.ok(after.released>35)
 // This fixture stays under the long-history threshold to measure media release separately.
 // No independent observers per image: the registry shares a root observer and no animation timer.
 const near=page.locator('img.sticker[data-media-state=preview]').last();await near.scrollIntoViewIfNeeded();await near.hover()
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=source]').length===1)
 await page.mouse.move(1,1);await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=source]').length===0)
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:true})))
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=released]').length===48)
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:false})))
 await page.waitForFunction(()=>document.querySelectorAll('img.sticker[data-media-state=preview]').length>0)
 const area=page.locator('.messages');await area.evaluate(el=>el.scrollTop=0)
 await page.locator('[data-mid=pressure-0] img.sticker').waitFor()
 await page.waitForFunction(()=>document.querySelector('[data-mid=pressure-0] img.sticker')?.dataset.mediaState==='preview')
 await page.evaluate(()=>{const ctx=window.__qa.ctx;ctx.chat.state.messages.push({id:'video-resource',type:10,ts:Date.now()+999,senderId:'other',sender:'测试',content:{},elements:[{type:'video',attrs:{src:'/qa-video/test.mp4'}}]})})
 const video = page.locator('[data-mid=video-resource]')
 await video.getByRole('button',{name:'播放视频'}).waitFor()
 assert.equal(await video.locator('video').count(),0)
 // Real message rendering must fit original pixels, including stale metadata and released stills.
 await page.evaluate(()=>{
   window.__resources.setResourceMode(false)
   const svg=(w,h)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#69a"/></svg>`)
   window.__qa.ctx.chat.state.messages=[
     [1600,900,1200,2400],[600,2400,600,2400],[800,800,0,0],[80,40,80,40],
   ].map(([w,h,mw,mh],i)=>({id:'fit-'+i,type:2,ts:Date.now()+i,senderId:'other',sender:'测试',content:{},elements:[{type:'img',attrs:{src:svg(w,h),width:mw,height:mh}}]}))
 })
 const verifyImages=async()=>{
   const boxes=await page.locator('img.media').evaluateAll(imgs=>imgs.map(img=>({w:img.clientWidth,h:img.clientHeight,nw:img.naturalWidth,nh:img.naturalHeight})))
   for(const b of boxes){assert.ok(b.w>0&&b.h>0&&b.w<=320&&b.h<=461,JSON.stringify(b));assert.ok(Math.abs(b.w/b.h-b.nw/b.nh)<.025,JSON.stringify(b))}
   return boxes
 }
 await page.waitForFunction(()=>document.querySelectorAll('img.media').length===4&&[...document.querySelectorAll('img.media')].every(img=>img.complete&&img.naturalWidth&&img.dataset.mediaState==='source'))
 const fitted=await verifyImages()
 assert.ok(fitted[0].h<190,'landscape image must not use a tall metadata frame')
 assert.equal(fitted[3].w,80,'small images should keep their own size')
 await page.setViewportSize({width:720,height:820});await page.waitForTimeout(100);await verifyImages()
 await page.evaluate(()=>window.__resources.setResourceMode(true))
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:true})))
 await page.waitForFunction(()=>[...document.querySelectorAll('img.media')].every(img=>img.dataset.mediaState==='released'))
 const released=await page.locator('img.media').evaluateAll(imgs=>imgs.map(img=>({w:img.clientWidth,h:img.clientHeight})))
 for(let i=0;i<released.length;i++) assert.ok(Math.abs(released[i].w/released[i].h-fitted[i].w/fitted[i].h)<.025)
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:false})))
 await page.setViewportSize({width:1280,height:820})
 console.log('PASS: actual image ratios override stale dimensions, landscape/portrait/square/small images fit without letterboxing; viewport resize and released placeholders preserve proportions')
 const cdp=await page.context().newCDPSession(page);const heap=await cdp.send('Runtime.getHeapUsage')
 console.log(JSON.stringify({before,after,jsHeapMiB:Number((heap.usedSize/1048576).toFixed(2)),note:'JS heap only; excludes WebView/Node/GPU/native memory'},null,2))
 assert.deepEqual(errors,[])
 console.log('PASS: 48 animated stickers become bounded viewport stills, hover resumes one, minimize releases all, scrolling restores images and video does not preload')
}finally{await browser.close();await server.close()}
