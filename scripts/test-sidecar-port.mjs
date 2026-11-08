/** Start/terminate/restart the actual bundled sidecar on the desktop's preferred port. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const folder=await mkdtemp(join(tmpdir(),'yh-8902-')),bundle=resolve(process.env.SIDECAR_BUNDLE || 'src-tauri/resources/server-bundle.mjs')
let child
async function free() { const s=createServer();await new Promise((ok,fail)=>{s.once('error',fail);s.listen(8902,'127.0.0.1',ok)});await new Promise(ok=>s.close(ok)) }
try {
 await free()
 for(let pass=0;pass<2;pass++) {
  child=spawn(process.execPath,[bundle],{env:{...process.env,HOST:'127.0.0.1',PORT:'8902',HTTPS_PORT:'0',YH_ROOT:folder,YH_DATA_DIR:join(folder,'data'),YH_FILE_DIR:join(folder,'files')},stdio:'ignore'})
  let ready=false
  for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:8902/data/session',{signal:AbortSignal.timeout(300)});if(r.ok){ready=true;break}}catch{}await new Promise(ok=>setTimeout(ok,50))}
  assert.ok(ready,'bundled sidecar must start on 8902')
  const stopped=once(child,'exit');child.kill('SIGTERM');await Promise.race([stopped,new Promise((_,fail)=>setTimeout(()=>fail(Error('sidecar failed to terminate')),3000).unref())]);child=null
  await free()
 }
 console.log('PASS: bundled sidecar started twice on 8902; each exit released the listener immediately')
} finally { if(child){child.kill('SIGKILL');await once(child,'exit').catch(()=>{})}await rm(folder,{recursive:true,force:true}) }
