/** Browser regressions for distant quote navigation and contrast on arbitrary wallpapers. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mkdir } from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const page=await browser.newPage({viewport:{width:1280,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
const base='http://127.0.0.1:'+server.httpServer.address().port
try {
 await page.goto(base+'/scripts/ui-fixture/index.html');await page.waitForFunction(()=>window.__qa)
 await page.evaluate(async()=>{
   const {ctx}=window.__qa;await ctx.chat.open(ctx.chat.state.conversations[0])
   const ref={id:'remote-reference',chatId:'normal',chatType:2,type:1,ts:Date.now(),senderId:'other',sender:'Future Tasks',quoteId:'month-old',content:{text:'引用旧消息',quote_msg_text:'Future Tasks: 一个月以前的消息'}}
   ctx.api.messages=async()=>[ref];ctx.chat.state.messages=[ref];ctx.chat.state.hasMore=false
   ctx.api.messagesAround=async(_id,_type,mid,count)=>{await new Promise(r=>setTimeout(r,180));return count===1?[{id:mid,type:1,seq:41,ts:Date.now()-30*86400000,sender:'Future Tasks',senderId:'other',content:{text:'一个月以前的消息'}}]:[]}
 })
 await page.locator('.quote.clickable').click();await page.getByRole('status').filter({hasText:'正在定位引用消息'}).waitFor()
 await page.locator('[data-mid="month-old"].flash').waitFor();assert.equal(await page.evaluate(()=>window.__qa.ctx.chat.state.locateId),'month-old')
 for(const mode of ['light','dark']) {
  const scores=await page.evaluate(async mode=>{
   const {themePalette,contrast}=await import('/src/core/theme-colors.ts'),palette=themePalette({id:'kobe',mode,accent:'#fff4fa'},mode,'#fff4fa')
   for(const [key,value]of Object.entries(palette))if(typeof value==='string')document.documentElement.style.setProperty('--'+({accent:'acc',onAccent:'on-acc'}[key]||key),value)
   document.documentElement.dataset.theme=mode;document.querySelector('.messages').style.background='linear-gradient(120deg,#eaf6dd,#ffb7be)'
   const hex=v=>'#'+v.match(/\d+/g).slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('')
   const q=document.querySelector('.quote'),bg=getComputedStyle(q).backgroundColor
   return [contrast(hex(bg),hex(getComputedStyle(q.querySelector('.q-text')).color)),contrast(hex(bg),hex(getComputedStyle(q.querySelector('.q-name')).color))]
  },mode)
  assert.ok(scores.every(x=>x>=4.5),'both quote sender and content must remain legible')
 }
 await page.evaluate(()=>{const{ctx}=window.__qa;ctx.api.messagesAround=async()=>[];ctx.api.messagesBefore=async()=>ctx.chat.state.messages.filter(m=>m.id==='remote-reference');ctx.chat.state.messages=ctx.chat.state.messages.filter(m=>m.id==='remote-reference');ctx.chat.state.messages[0].quoteId='missing';ctx.chat.state.messages[0].content.quote_msg_text='Future Tasks: 未返回的消息'})
 await page.locator('.quote.clickable').click();await page.waitForFunction(()=>window.__qa.ctx.ui.state.toasts.some(t=>t.text.includes('暂未返回')))
 assert.ok(await page.evaluate(()=>window.__qa.ctx.ui.state.toasts.every(t=>!t.text.includes('已删除'))))
 await page.goto(base+'/scripts/ui-fixture/features.html');await page.waitForFunction(()=>window.__qa?.featuresReady)
 await page.route('**/sticker-directory?*',r=>r.fulfill({json:{data:[],total:0}}))
 await page.evaluate(()=>{const {ctx}=window.__qa;ctx.api.getUser=async id=>({id,name:'MAX',onlineDay:537,continuousOnlineDay:14,medalCount:2,registerTime:'2024-08-02',ipGeo:'江苏',profile:{introduction:'记录想法，分享日常。'}});ctx.api.baListByCreate=async()=>[{id:925,name:'笔记 / 随感'},{id:926,name:'生活碎片'}]})
 await page.getByRole('button',{name:'通讯录',exact:true}).click();await page.getByRole('button',{name:'查看 MAX 的资料',exact:true}).first().click();await page.locator('.pf-highlights').waitFor();await page.locator('.pf-mask').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))})
 if(process.env.UI_QA_SCREENSHOTS){await mkdir(process.env.UI_QA_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.UI_QA_SCREENSHOTS+'/profile-1280.png'})}
 const compact=await page.locator('.pf-highlights').evaluate(el=>({h:el.getBoundingClientRect().height,ratio:el.getBoundingClientRect().width/el.parentElement.clientWidth}));assert.ok(compact.h<90);assert.ok(compact.ratio>.85)
 await page.setViewportSize({width:320,height:760});assert.ok(await page.locator('.pf').evaluate(el=>el.scrollWidth<=el.clientWidth+1));if(process.env.UI_QA_SCREENSHOTS)await page.screenshot({path:process.env.UI_QA_SCREENSHOTS+'/profile-320.png'});assert.deepEqual(errors,[])
 console.log('PASS: distant quote loads/highlights; no false deletion warning; sender/body contrast >= 4.5 with pale custom accents over bright wallpaper in both themes; compact statistics at 1280/320px')
} finally {await browser.close();await server.close()}
