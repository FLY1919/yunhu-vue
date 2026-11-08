import { reactive, watch } from 'vue'
export interface PendingAttachment {
  id: number
  file: File
  url: string
  kind: 'image' | 'video' | 'audio' | 'file'
  error: string
  progress: number
  speed: number
  /** 重试时复用上传结果和消息 ID。 */
  elements?: any[]
  sent?: boolean
  messageId?: string
}

export interface ComposerMention { id: string; start: number; end: number }

export function moveComposerMentions(mentions: ComposerMention[], start: number, end: number, length: number) {
  const shift = length - (end - start)
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention]
    if (mention.start >= end) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }]
    return []
  })
}

function reconcileMentions(mentions: ComposerMention[], before: string, after: string) {
  const commonLength = Math.min(before.length, after.length)
  let prefix = 0, suffix = 0
  while (prefix < commonLength && before[prefix] === after[prefix]) prefix++
  while (suffix < commonLength && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  // Drop ranges touched by an ambiguous edit, including repeated identical nicknames.
  const start = Math.min(prefix, commonLength - suffix)
  const tail = Math.min(suffix, commonLength - prefix)
  return moveComposerMentions(mentions, start, before.length - tail, after.length - start - tail)
}

function restoredMentions(value: unknown, text: string): ComposerMention[] {
  if (!Array.isArray(value)) return []
  return value.filter(m => m && typeof m.id === 'string' && m.id
    && Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start
    && m.end <= text.length && text[m.start] === '@')
}

interface Options { owner?:()=>string; send?:(channel:{id:string;type:number},text:string)=>boolean; delay?:number }
/** Per-account/per-conversation drafts. Files stay in memory; only text and its formatting, reply and mention metadata are persisted. */
export function createComposerDrafts(options:Options={}) {
 const drafts=new Map<string,any>(),remote=new Map<string,string>(),owner=()=>String(options.owner?.()||''),key=(account:string,c:{id:string;type:number})=>account+':'+c.type+':'+c.id
 let disposed=false
 function read(account:string){try{const raw=JSON.parse(localStorage.getItem('yh.composer.drafts.v2:'+account)||'[]');return Array.isArray(raw)?raw.filter(d=>typeof d.text==='string'&&d.text.length<=200000&&d.updatedAt>Date.now()-7*86400000):[]}catch{return []}}
 function persist(entry:any){if(!entry.account)return;try{let values=read(entry.account).filter(d=>d.id!==entry.channel.id||d.type!==entry.channel.type);if(entry.draft.text||entry.draft.reply||entry.dirty)values.unshift({id:entry.channel.id,type:entry.channel.type,text:entry.draft.text,kind:entry.draft.kind,reply:entry.draft.reply,mentions:entry.draft.mentions,dirty:entry.dirty||entry.sent!==undefined,updatedAt:Date.now()});values=values.slice(0,20);while(values.length>1&&JSON.stringify(values).length>1000000)values.pop();localStorage.setItem('yh.composer.drafts.v2:'+entry.account,JSON.stringify(values));entry.draft.localSavedAt=Date.now()}catch{entry.draft.syncError='本地暂存失败，请保留当前窗口'}}
 function flushEntry(entry:any){clearTimeout(entry.timer);persist(entry);if((!entry.dirty&&entry.sent===undefined)||entry.account!==owner()||disposed)return;try{const text=entry.draft.text;if(options.send?.(entry.channel,text)){entry.sent=text;entry.dirty=false;entry.draft.syncStatus='已提交云端同步';entry.draft.syncError='';persist(entry)}else entry.draft.syncStatus='已暂存本机 · 等待联网'}catch(e:any){entry.draft.syncStatus='已暂存本机 · 同步待重试';entry.draft.syncError=e.message||'云端同步失败'}}
 function entryFor(channel:{id:string;type:number}){const account=owner(),id=key(account,channel);if(drafts.has(id))return drafts.get(id);const stored=read(account).find(d=>d.id===channel.id&&d.type===channel.type),received=remote.get(account+':'+channel.id);const draft=reactive({text:stored?.text||received||'',kind:[1,3,8].includes(stored?.kind)?stored.kind:1,reply:stored?.reply||null,mentions:restoredMentions(stored?.mentions,stored?.text||''),pending:[] as PendingAttachment[],uploading:false,localSavedAt:stored?.updatedAt||0,syncStatus:stored?'已恢复本机草稿':received?'已同步云端草稿':'',syncError:'',remoteText:null as string|null});const entry={account,channel:{...channel},draft,dirty:!!stored?.dirty,sent:undefined as string|undefined,receiving:false,timer:undefined as ReturnType<typeof setTimeout>,stop:()=>{}};drafts.set(id,entry);entry.stop=watch(()=>[draft.text,draft.kind,draft.reply],([text],[before])=>{if(text!==before&&draft.mentions.length)draft.mentions=reconcileMentions(draft.mentions,before,text);if(entry.receiving)return;entry.dirty=true;draft.syncStatus='等待同步';clearTimeout(entry.timer);entry.timer=setTimeout(()=>flushEntry(entry),options.delay??800)},{deep:true,flush:'sync'});return entry}
 function receive(chatId: string, input: string) {
   const account = owner()
   if (!account || typeof input !== 'string' || input.length > 200000) return
   const remoteKey = account + ':' + chatId
   if (input) remote.set(remoteKey, input)
   else remote.delete(remoteKey)
   const matches = [...drafts.values()].filter(entry => entry.account === account && entry.channel.id === chatId)
   if (matches.length !== 1) return
   const entry = matches[0], draft = entry.draft
   if ((entry.dirty || entry.sent !== undefined) && draft.text !== input) {
     draft.remoteText = input
     draft.syncStatus = '云端另有草稿'
     return
   }
   entry.receiving = true
   draft.text = input
   draft.syncStatus = '已同步云端草稿'
   draft.remoteText = null
   entry.dirty = false
   entry.sent = undefined
   entry.receiving = false
   persist(entry)
 }
 function releaseIdle(channel:{id:string;type:number}) {
   const id = key(owner(), channel)
   const entry = drafts.get(id)
   if (!entry) return
   const { draft } = entry
   if (entry.dirty || entry.sent !== undefined || draft.text || draft.kind !== 1 || draft.reply || draft.pending.length
     || draft.uploading || draft.remoteText !== null) return
   clearTimeout(entry.timer)
   entry.stop()
   drafts.delete(id)
 }
 return {get(channel:{id:string;type:number}){return entryFor(channel).draft},flush(channel?:{id:string;type:number}){if(channel)flushEntry(entryFor(channel));else for(const e of drafts.values())flushEntry(e)},receive,
 releaseIdle,
 useRemote(channel:{id:string;type:number}){const e=entryFor(channel);if(e.draft.remoteText==null)return;e.receiving=true;e.draft.text=e.draft.remoteText;e.draft.remoteText=null;e.dirty=false;e.sent=undefined;e.draft.syncStatus='已同步云端草稿';e.receiving=false;persist(e)},
 keepLocal(channel:{id:string;type:number}){const e=entryFor(channel);e.draft.remoteText=null;e.dirty=true;flushEntry(e)},
 clear(){for(const e of drafts.values()){clearTimeout(e.timer);persist(e);e.stop();for(const p of e.draft.pending)if(p.url)URL.revokeObjectURL(p.url);e.draft.pending=[];e.draft.text=''}drafts.clear();remote.clear()},dispose(){this.clear();disposed=true},}
}
