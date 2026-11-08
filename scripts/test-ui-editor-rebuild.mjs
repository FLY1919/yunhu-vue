import assert from 'node:assert/strict'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await createServer({configFile:false,plugins:[vue()],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen()
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const context=await browser.newContext({viewport:{width:1360,height:920}}),page=await context.newPage(),errors=[],base='http://127.0.0.1:'+server.httpServer.address().port
page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)})
const qa=process.env.EDITOR_QA_DIR||'/tmp/yh-editor-qa';await mkdir(qa,{recursive:true})
async function shot(name){await page.screenshot({path:qa+'/'+name+'.png'})}
async function tool(name){let button=page.getByRole('button',{name,exact:true});if(await button.isVisible())await button.click();else {await page.getByRole('button',{name:'更多 Markdown 工具',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}}
try {
 await page.goto(base+'/scripts/ui-fixture/community.html');await page.getByRole('button',{name:'进入板块 笔记 / 随感',exact:true}).click();await page.getByRole('button',{name:'发布文章',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'撰写文章',exact:true}),body=page.getByLabel('文章正文',{exact:true})
 await page.getByLabel('文章标题',{exact:true}).fill('编辑器重构回归')
 await body.fill('需要格式化的文字');await body.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)})
 await tool('加粗');await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content==='**需要格式化的文字**')
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content==='需要格式化的文字')
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content==='**需要格式化的文字**')
 await page.getByRole('button',{name:'源文',exact:true}).click();const source=page.getByLabel('Markdown 源文',{exact:true})
 await source.fill('# 写作测试\n\n```javascript\nconst value = 42\n```\n\n$E=mc^2$\n\n$$\n\\frac{a}{b}\n$$\n\n- [ ] 一个任务\n\n<script>window.editorEvil=true</script>')
 await page.getByRole('button',{name:'双栏',exact:true}).click();await page.locator('.editor-preview .katex').first().waitFor();await page.locator('.editor-preview pre code span').first().waitFor()
 assert.equal(await page.locator('.editor-preview script').count(),0);assert.equal(await page.evaluate(()=>window.editorEvil),undefined)
 const separator=page.getByRole('separator',{name:'调整编辑预览比例'}),r=await separator.boundingBox();await page.mouse.move(r.x+3,r.y+40);await page.mouse.down();await page.mouse.move(r.x+120,r.y+40,{steps:8});await page.mouse.up();assert.ok(Number(await separator.getAttribute('aria-valuenow'))>55)
 await page.locator('.editor-preview input[type=checkbox]').check();await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content.includes('- [x]'))
 await page.locator('.editor-preview').getByRole('button',{name:'代码语言'}).click();await page.getByRole('option',{name:'typescript',exact:true}).click();await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content.includes('```typescript'))
 // Code editing has one stable, visible contentDOM. Test caret placement and literal Markdown.
 await page.getByRole('button',{name:'实时写作',exact:true}).click()
 const code=page.locator('.markdown-canvas .code-input code')
 await code.waitFor()
 await page.locator('.markdown-canvas').getByRole('button',{name:'代码语言'}).click()
 await page.getByLabel('自定义代码语言').fill('custom-lang')
 await page.getByRole('button',{name:'使用',exact:true}).click()
 await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content.includes('```custom-lang'))
 await code.click({position:{x:100,y:10}})
 await page.keyboard.press('Home')
 await page.keyboard.type('  ')
 await page.keyboard.press('End')
 await page.keyboard.press('Enter')
 await page.keyboard.insertText('    # text ** & < >')
 await page.keyboard.press('ArrowLeft')
 await page.keyboard.press('Backspace')
 await page.keyboard.insertText('中')
 await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content.includes('  const value = 42\n    # text ** & <中>'))
 assert.equal(await code.textContent(),'  const value = 42\n    # text ** & <中>')
 assert.notEqual(await code.evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)')
 await page.getByRole('button',{name:'双栏',exact:true}).click()
 await shot('split-dark')
 await page.getByRole('button',{name:'实时写作',exact:true}).click();await page.locator('.markdown-canvas .rich-math .katex').first().waitFor()
 await page.getByRole('button',{name:'源文',exact:true}).click();await source.fill('');await page.getByRole('button',{name:'实时写作',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.markdown-canvas h1'));await body.click();await page.keyboard.type('# ');await page.keyboard.type('真正的标题');assert.equal(await page.locator('.markdown-canvas h1').textContent(),'真正的标题')
 await page.keyboard.press('Enter');await page.keyboard.type('- ');await page.keyboard.type('列表一');await page.keyboard.press('Enter');await page.keyboard.type('列表二');assert.equal(await page.locator('.markdown-canvas ul:not([data-type]) li').count(),2)
 await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('退出列表后的正文');await page.locator('.markdown-canvas .tiptap > p').filter({hasText:'退出列表后的正文'}).waitFor()
 console.log('PHASE table');await tool('插入表格');await page.locator('.markdown-canvas table').waitFor();const rows=await page.locator('.markdown-canvas tr').count();await page.getByRole('button',{name:'下方插入行',exact:true}).click();assert.equal(await page.locator('.markdown-canvas tr').count(),rows+1);await page.getByRole('button',{name:'右侧插入列',exact:true}).click();assert.equal(await page.locator('.markdown-canvas tr').first().locator('th,td').count(),3)
 await page.getByRole('button',{name:'关闭表格工具',exact:true}).click()
 console.log('PHASE formula');await tool('独立公式');await page.getByLabel('数学公式',{exact:true}).fill('\\sqrt{x^2+y^2}');await page.getByRole('button',{name:'插入公式',exact:true}).click();await page.locator('.markdown-canvas .rich-math .katex').last().waitFor()
 await page.getByRole('button',{name:'查找替换',exact:true}).click();await page.getByLabel('查找文字',{exact:true}).fill('正文');await page.getByLabel('替换文字',{exact:true}).fill('文章');await page.getByRole('button',{name:'全部替换',exact:true}).click();await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content.includes('文章'));await page.getByRole('button',{name:'关闭查找',exact:true}).click()
 console.log('PHASE autosave');await page.waitForFunction(()=>window.__community.ctx.community.state.savedAt>0);assert.ok(await page.evaluate(()=>window.__community.calls.some(c=>c[0]==='saveDraft'&&c[1]===925)))
 await shot('rich-dark');await page.evaluate(()=>document.documentElement.dataset.theme='light');await shot('rich-light')
 // Autosave errors retain text and a manual retry uses the same official draft
 // service. Background saves must not repeatedly produce success Toasts.
 await page.getByRole('button',{name:'源文',exact:true}).click();await page.evaluate(()=>window.__community.fail.saveDraft=true);await source.fill('断网后保留的正文');await page.getByRole('alert').filter({hasText:'云端草稿保存失败'}).waitFor();assert.equal(await page.evaluate(()=>window.__community.ctx.community.state.editor.content),'断网后保留的正文');assert.equal(await page.evaluate(()=>window.__community.errors.filter(e=>e==='草稿已保存到云端').length),0)
 await page.evaluate(()=>window.__community.fail.saveDraft=false);await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.waitForFunction(()=>window.__community.ctx.community.state.savedAt>0);assert.equal(await page.evaluate(()=>window.__community.calls.filter(c=>c[0]==='saveDraft').at(-1)[3]),'断网后保留的正文')
 await page.getByRole('button',{name:'源文',exact:true}).click();const long='# 长文档\n\n'+Array.from({length:2500},(_,i)=>'## 记录 '+i+'\n\n这一段记录文档编辑与性能验证，包含一些文字。\n').join('\n');assert.ok(long.length<200000);console.log('SOURCE-BOX',await source.boundingBox(),await source.isVisible(),await source.isEnabled(),await source.isEditable());await source.fill('短文本');console.log('SMALL-FILL-OK');await writeFile(qa+'/large.md',long);await page.getByLabel('导入 Markdown').setInputFiles(qa+'/large.md');await page.waitForFunction(n=>window.__community.ctx.community.state.editor.content.length===n,long.length)
 console.log('PHASE large-input');const latencies=[];for(let i=0;i<8;i++){const started=Date.now();await source.press('End');await source.pressSequentially('测');latencies.push(Date.now()-started)}
 const largeContent=await source.inputValue();for(let i=0;i<3;i++){await page.getByRole('button',{name:'双栏',exact:true}).click();await page.getByRole('button',{name:'源文',exact:true}).click();assert.equal(await source.inputValue(),largeContent)}
 await page.getByRole('button',{name:'双栏',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.editor-preview h2').length===2500);await source.evaluate(el=>el.scrollTop=el.scrollHeight*.7);await page.waitForTimeout(80);const ratios=await page.evaluate(()=>{const a=document.querySelector('.source-input'),b=document.querySelector('.editor-preview');return [a.scrollTop/(a.scrollHeight-a.clientHeight),b.scrollTop/(b.scrollHeight-b.clientHeight)]});assert.ok(Math.abs(ratios[0]-ratios[1])<.05)
 const cdp=await context.newCDPSession(page),heap=await cdp.send('Runtime.getHeapUsage');console.log('PERFORMANCE',JSON.stringify({characters:largeContent.length,keystrokeMaxMs:Math.max(...latencies),keystrokeMedianMs:latencies.sort((a,b)=>a-b)[4],heapMiB:Math.round(heap.usedSize/1048576)}))
 await page.getByRole('button',{name:'源文',exact:true}).click();await source.fill('保存的正文')
 console.log('PHASE popup');const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'在独立窗口编辑',exact:true}).click();const popup=await popupPromise;await popup.getByLabel('文章正文',{exact:true}).waitFor();await popup.getByLabel('文章正文',{exact:true}).fill('独立窗口修改');await page.waitForFunction(()=>window.__community.ctx.community.state.editor.content==='独立窗口修改');await popup.getByRole('button',{name:'返回主窗口编辑',exact:true}).click();await dialog.waitFor();await page.getByRole('button',{name:'源文',exact:true}).click();assert.equal(await source.inputValue(),'独立窗口修改')
 for(const width of [1280,740,390,320]){await page.setViewportSize({width,height:820});await page.waitForTimeout(100);assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await shot('editor-'+width)}
 await page.goto(base+'/scripts/ui-fixture/index.html');await page.waitForFunction(()=>window.__qa);await page.evaluate(async()=>{const {ctx}=window.__qa;await ctx.chat.open(ctx.chat.state.conversations.find(c=>c.id==='normal'));ctx.ws={state:{status:'online',error:''},online:true,sendDraft:(id,text)=>{window.__draftCalls||=[];window.__draftCalls.push([id,text]);return true}}})
 const composer=page.getByLabel('聊天消息',{exact:true});await composer.fill('选中文字');await composer.evaluate(el=>{el.focus();el.setSelectionRange(0,4);el.dispatchEvent(new Event('select'))});await page.getByRole('button',{name:'Markdown 格式工具',exact:true}).click();await tool('加粗');assert.equal(await composer.inputValue(),'**选中文字**');assert.match(await page.getByRole('button',{name:'消息格式'}).textContent(),/Markdown/i)
 await composer.press('Shift+Enter');assert.ok((await composer.inputValue()).includes('\n'));await composer.fill('准备同步的消息');await page.waitForFunction(()=>window.__draftCalls?.some(v=>v[0]==='normal'&&v[1]==='准备同步的消息'))
 await page.evaluate(async()=>{const {ctx}=window.__qa;ctx.chat.setReply({id:'original-id',sender:'发送者',type:1,content:{text:'要引用的文字'}});await ctx.chat.open(ctx.chat.state.conversations.find(c=>c.id==='other'));await ctx.chat.open(ctx.chat.state.conversations.find(c=>c.id==='normal'))});await page.getByLabel('聊天消息').waitFor();assert.equal(await composer.inputValue(),'准备同步的消息');assert.equal(await page.evaluate(()=>window.__qa.ctx.chat.state.reply.id),'original-id')
 await shot('composer-320');await page.setViewportSize({width:1280,height:820});await shot('composer-1280')
 // The general UI fixture deliberately has no sending transport. Supply a fake
 // bot at the protocol boundary, retaining the real chat service and composer.
 await page.evaluate(()=>{window.__sent=[];window.__qa.ctx.bots=[{sendMessage:async(...args)=>{if(window.__sendFails)throw Error('模拟发送失败');window.__sent.push(args);return 'editor-send-'+window.__sent.length}}]})
 await composer.fill('失败时保留草稿');await page.evaluate(()=>window.__sendFails=true);await composer.press('Enter');await page.waitForFunction(()=>!window.__qa.ctx.chat.state.sending);assert.equal(await composer.inputValue(),'失败时保留草稿');assert.equal(await page.evaluate(()=>window.__sent.length),0)
 await page.evaluate(()=>window.__sendFails=false);await composer.fill('输入法确认');await composer.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await composer.inputValue(),'输入法确认');assert.equal(await page.evaluate(()=>window.__sent.length),0)
 await composer.fill('按回车发送');await composer.press('Enter');await page.waitForFunction(()=>document.querySelector('.composer textarea').value==='');assert.equal(await page.evaluate(()=>window.__sent.length),1);assert.equal(await page.evaluate(()=>window.__sent[0][3].quoteId),'original-id')
 assert.deepEqual(errors,[]);console.log('PASS: formatting/selection/history; three modes; real syntax and math; split drag/scroll; task and table edits; Typora lists; autosave; detached round-trip; long-document input; themes/narrow layouts; chat shortcuts/drafts/reply ID/Enter')
} catch(e){console.error('FAILURE',e);try{await page.screenshot({path:qa+'/failure.png',timeout:3000})}catch{};console.error('STATE',await Promise.race([page.evaluate(()=>({text:window.__community?.ctx.community.state.editor?.content?.slice(0,300),html:document.querySelector('.community-editor')?.innerHTML.slice(0,1500)})),new Promise(r=>setTimeout(()=>r('Renderer unresponsive'),2000))]));throw e} finally {await context.close();await browser.close();await server.close()}
