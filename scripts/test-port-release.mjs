/** The built Node sidecar must release the desktop default port after process exit. */
import assert from 'node:assert/strict'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const bind=async()=>{const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(8902,'127.0.0.1',r)});await new Promise(r=>s.close(r))}
await bind()
const temp=await mkdtemp(join(tmpdir(),'yh-port-')),child=spawn(process.execPath,[resolve('src-tauri/resources/server-bundle.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:'8902',HTTPS_PORT:'0',YH_ROOT:temp,YH_DATA_DIR:join(temp,'data')},stdio:'ignore'})
try {
  let ready=false
  for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:8902/data/session')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,40))}
  assert.ok(ready)
}finally{
  const ended=new Promise(r=>child.once('exit',r));if(child.exitCode===null&&!child.signalCode){child.kill();await ended}
  await rm(temp,{recursive:true,force:true})
}
await bind();console.log('PASS: production sidecar starts on 8902 and the same address can be rebound after exit')
