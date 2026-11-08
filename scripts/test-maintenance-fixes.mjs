/** Focused menu dispatch and server download regressions; all network stays local. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import http from 'node:http'
const temp=await mkdtemp(join(process.cwd(),'node_modules','.maintenance-'))
await build({stdin:{contents:"export {messageActionsPlugin} from './src/plugins/message-actions';",resolveDir:process.cwd()},outfile:join(temp,'menus.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'sfc',setup(b){b.onLoad({filter:/\.vue$/},()=>({contents:'export default {}',loader:'js'}))}}]})
const {messageActionsPlugin}=await import(pathToFileURL(join(temp,'menus.mjs')))
after(()=>rm(temp,{recursive:true,force:true}))
await test('reveal uses the system-file endpoint rather than group files or the save picker; clipboard denial reports once',async()=>{
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldDocument=globalThis.document
  const actions=new Map(),requests=[],toasts=[]
  globalThis.window={showSaveFilePicker(){throw new Error('reveal must not show a picker')}}
  globalThis.document=new EventTarget()
  globalThis.fetch=async url=>{requests.push(String(url));return Response.json({ok:true,path:'fixture'})}
  const ctx={chat:{menu(){},action(id,a){actions.set(id,a.action)},slot(){return ()=>{}}},ui:{toast(...args){toasts.push(args)}},group:{setDockTab(){throw new Error('must not navigate to group files')},locateFile(){throw new Error('must not navigate')}},set(k,v){this[k]=v},effect(fn){fn()},inject(){}}
  try {
    messageActionsPlugin.apply(ctx)
    await actions.get('msg.locate')({msg:{elements:[{type:'file',attrs:{src:'file.pdf',name:'文件.pdf'}}]}})
    assert.equal(requests.length,1)
    const url=new URL(requests[0],'http://local')
    assert.equal(url.pathname,'/local-open');assert.equal(url.searchParams.get('url'),'/res/chat-file.jwznb.com/file.pdf');assert.equal(url.searchParams.get('name'),'文件.pdf')
    await actions.get('msg.copy')({msg:{content:{text:'copy me'}}})
    assert.equal(toasts.length,1);assert.match(toasts[0][0],/剪贴板/)
  } finally {globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.document=oldDocument}
})
await test('failed resources are not cached; reveal preserves files and remains asynchronous; sidecar termination releases its port',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'yh-reveal-')),hits=new Map()
  let child
  const upstream=http.createServer((req,res)=>{
    hits.set(req.url,(hits.get(req.url)||0)+1)
    assert.equal(req.headers.referer,'http://myapp.jwznb.com')
    if(req.url==='/missing')res.writeHead(404).end('not ready')
    else if(req.url==='/stream'){
      res.writeHead(200,{'content-length':6})
      res.write('abc')
      setTimeout(()=>res.end('def'),220)
    } else if(req.url==='/broken'){
      res.writeHead(200,{'content-length':20})
      res.write('short')
      setTimeout(()=>res.destroy(),30)
    } else res.writeHead(200,{'content-type':'application/octet-stream'}).end(req.url==='/second'?'second bytes':'first bytes')
  });await new Promise(r=>upstream.listen(0,'127.0.0.1',r))
  const finder=http.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r))
  try {
    await mkdir(join(folder,'bin'))
    await writeFile(join(folder,'bin','xdg-open'),'#!/usr/bin/env node\nsetTimeout(()=>process.exit(0),300)\n',{mode:0o755})
    await writeFile(join(folder, 'bin', 'zenity'), String.raw`#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs')
appendFileSync(process.env.TEST_PICK_LOG, JSON.stringify(process.argv.slice(2)) + '\n')
const selected = readFileSync(process.env.TEST_PICK_RESULT, 'utf8')
if (selected) console.log(selected)
else process.exitCode = 1
`, { mode: 0o755 })
    const pickLog = join(folder, 'picker.log'), pickResult = join(folder, 'selected.txt')
    await writeFile(pickLog, '')
    await writeFile(pickResult, '')
    await writeFile(join(folder,'preload.mjs'),`import https from 'node:https';import http from 'node:http';https.request=(options,cb)=>http.request({...options,host:'127.0.0.1',hostname:'127.0.0.1',port:${upstream.address().port}},cb);`)
    child=spawn(process.execPath,['--import',join(folder,'preload.mjs'),resolve('src-tauri/resources/server-bundle.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HTTPS_PORT:'0',YH_ROOT:folder,YH_DATA_DIR:join(folder,'data'),YH_FILE_DIR:join(folder,'files'),PATH:join(folder,'bin')+':'+process.env.PATH,TEST_PICK_LOG:pickLog,TEST_PICK_RESULT:pickResult},stdio:'ignore'})
    const root=`http://127.0.0.1:${port}`
    let ready=false
    for(let i=0;i<100;i++){try{ready=(await fetch(root+'/data/session')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,40))}
    assert.ok(ready)
    const missing=await fetch(root+'/res/chat-img.jwznb.com/missing');assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store')
    const reveal=path=>fetch(root+'/local-open?url='+encodeURIComponent('/res/chat-file.jwznb.com/'+path)+'&name=same.pdf').then(r=>r.json())
    const opening=reveal('first'),start=Date.now();assert.equal((await fetch(root+'/data/session')).status,200);assert.ok(Date.now()-start<250)
    const first=await opening;assert.equal(first.ok,true);assert.equal(await readFile(first.path,'utf8'),'first bytes')
    const repeated=await reveal('first');assert.equal(repeated.path,first.path);assert.equal(hits.get('/first'),1)
    const second=await reveal('second');assert.equal(second.ok,true);assert.notEqual(second.path,first.path);assert.equal(await readFile(first.path,'utf8'),'first bytes');assert.equal(await readFile(second.path,'utf8'),'second bytes')
    const download=(target,name='same.pdf',headers={token:'test-only',origin:root})=>fetch(root+'/local-download?'+new URLSearchParams({url:target,name}),{method:'POST',headers})
    const streamed=await download('/res/chat-file.jwznb.com/stream')
    assert.match(streamed.headers.get('content-type'),/x-ndjson/)
    const updates=(await streamed.text()).trim().split('\n').map(line=>JSON.parse(line))
    assert.deepEqual(updates[0],{received:0,total:6})
    assert.ok(updates.some(update=>update.received===6&&update.total===6))
    assert.equal(await readFile(updates.at(-1).path,'utf8'),'abcdef')
    assert.notEqual(updates.at(-1).path,first.path)
    assert.equal((await reveal('stream')).path,updates.at(-1).path)
    const broken=(await (await download('/res/chat-file.jwznb.com/broken','incomplete.pdf')).text()).trim().split('\n').map(line=>JSON.parse(line))
    assert.equal(broken.at(-1).ok,false)
    assert.ok(!(await readdir(join(folder,'files'))).some(name=>name==='incomplete.pdf'||name.startsWith('.yh-download-')))
    assert.equal((await download('https://invalid.example/res/chat-file.jwznb.com/file')).status,403)
    assert.equal((await download('/res/chat-file.jwznb.com/stream','same.pdf',{token:'test-only',origin:'https://invalid.example'})).status,403)
    const fileSettings = () => fetch(root + '/file-dir').then(response => response.json())
    const setMode = mode => fetch(root + '/file-dir', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
    })
    const updatesFor = async (resource, name) => (await (await download('/res/chat-file.jwznb.com/' + resource, name)).text())
      .trim().split('\n').map(line => JSON.parse(line))
    assert.equal((await fileSettings()).mode, 'direct')
    assert.equal(await readFile(pickLog, 'utf8'), '')
    assert.equal((await setMode('unsupported')).status, 400)
    assert.equal((await (await setMode('ask')).json()).mode, 'ask')
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'data', 'download-settings.json'), 'utf8')), { mode: 'ask' })
    const selected = join(folder, '保存位置')
    await mkdir(selected)
    await writeFile(pickResult, selected)
    const chosen = await updatesFor('chosen')
    assert.deepEqual(chosen[0], { choosing: true })
    assert.equal(dirname(chosen.at(-1).path), selected)
    assert.equal(await readFile(chosen.at(-1).path, 'utf8'), 'first bytes')
    const [pickerArgs] = (await readFile(pickLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.ok(pickerArgs.includes('--filename=' + join(folder, 'files') + '/'))
    await writeFile(pickResult, '')
    assert.equal((await reveal('chosen')).path, chosen.at(-1).path)
    assert.deepEqual((await updatesFor('cancelled')).at(-1), { ok: true, cancelled: true })
    assert.ok(!hits.has('/cancelled'))
    const image = await fetch(root + '/local-save-image?name=cancelled.gif', {
      method: 'POST', headers: { token: 'test-only', origin: root, 'content-type': 'image/gif' },
      body: await readFile('scripts/ui-fixture/animated.gif'),
    })
    assert.deepEqual(await image.json(), { ok: true, cancelled: true })
    assert.equal((await (await setMode('direct')).json()).mode, 'direct')
    const direct = await updatesFor('direct')
    assert.equal(dirname(direct.at(-1).path), join(folder, 'files'))
    assert.equal((await fileSettings()).dir, join(folder, 'files'))
    assert.equal((await readFile(pickLog, 'utf8')).trim().split('\n').length, 3)

    const ended=new Promise(r=>child.once('exit',r));child.kill();await ended
    const available=http.createServer();await new Promise((r,j)=>{available.once('error',j);available.listen(port,'127.0.0.1',r)});await new Promise(r=>available.close(r))
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}
    await new Promise(r=>upstream.close(r));await rm(folder,{recursive:true,force:true})
  }
})
