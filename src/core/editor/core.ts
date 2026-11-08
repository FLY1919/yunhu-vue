/** Shared, DOM-independent editing primitives. Raw Markdown remains the wire/storage format. */
export type EditAction = 'bold'|'italic'|'strike'|'underline'|'highlight'|'link'|'image'|'quote'|'bullet'|'ordered'|'task'|'code'|'codeblock'|'table'|'rule'|'math'|'mathblock'|'footnote'|`h${number}`
export interface TextSelection { start: number; end: number }
export function markdownAction(text: string, selection: TextSelection, action: EditAction, data = '') {
  const start=Math.max(0,Math.min(text.length,selection.start)),end=Math.max(start,Math.min(text.length,selection.end)), selected=text.slice(start,end)
  let before='',after='',placeholder='文字'
  const wrappers:Record<string,[string,string]>={bold:['**','**'],italic:['*','*'],strike:['~~','~~'],underline:['<u>','</u>'],highlight:['<mark>','</mark>'],code:['`','`'],link:['[','](https://)'],image:['![','](https://)'],math:['$','$'],mathblock:['\n$$\n','\n$$\n'],codeblock:['\n```'+(data||'text')+'\n','\n```\n']}
  if(wrappers[action]) [before,after]=wrappers[action]
  else if(action==='table') {before='\n| 列一 | 列二 |\n| --- | --- |\n| ';after=' | 内容 |\n| 内容 | 内容 |\n'}
  else if(action==='rule'){before='\n\n---\n\n';placeholder=''}
  else if(action==='footnote'){before='[^note]\n\n[^note]: ';placeholder='脚注内容'}
  else {
    const prefix=action==='quote'?'> ':action==='bullet'?'- ':action==='ordered'?'1. ':action==='task'?'- [ ] ':/^h[1-6]$/.test(action)?'#'.repeat(Number(action.slice(1)))+' ':''
    const lineStart=text.lastIndexOf('\n',start-1)+1, lineEnd=text.indexOf('\n',end),until=lineEnd<0?text.length:lineEnd
    const original=text.slice(lineStart,until),replacement=original.split('\n').map((line,i)=>(action==='ordered'?`${i+1}. `:prefix)+line).join('\n')
    return {text:text.slice(0,lineStart)+replacement+text.slice(until),start:start+prefix.length,end:end+replacement.length-original.length}
  }
  if(action==='math'||action==='mathblock')placeholder='a^2 + b^2 = c^2'
  if(action==='codeblock')placeholder='代码'
  const value=selected||placeholder,insert=before+value+after
  return {text:text.slice(0,start)+insert+text.slice(end),start:start+before.length,end:start+before.length+value.length}
}
export function markdownEnter(text:string,{start,end}:TextSelection) {
  const lineStart=text.lastIndexOf('\n',start-1)+1,line=text.slice(lineStart,start)
  const match=/^(\s*)(?:(- \[[ xX]\] )|([-+*] )|(\d+)[.)] |(> ))(.*)$/.exec(line)
  if(!match)return {text:text.slice(0,start)+'\n'+(/^\s*/.exec(line)?.[0]||'')+text.slice(end),start:start+1+(/^\s*/.exec(line)?.[0].length||0)}
  if(!match[6].trim())return {text:text.slice(0,lineStart)+text.slice(end),start:lineStart}
  const prefix=match[1]+(match[2]?'- [ ] ':match[3]|| (match[4]?`${Number(match[4])+1}. `:match[5])),insert='\n'+prefix
  return {text:text.slice(0,start)+insert+text.slice(end),start:start+insert.length}
}
export function indentMarkdown(text:string,{start,end}:TextSelection,outdent=false) {
  const from=text.lastIndexOf('\n',start-1)+1, lineEnd=text.indexOf('\n',end),until=lineEnd<0?text.length:lineEnd
  const old=text.slice(from,until),lines=old.split('\n'),firstDelta=outdent?-Math.min(2,/^ */.exec(lines[0])![0].length):2
  const value=lines.map(l=>outdent?l.replace(/^ {1,2}|^\t/,''):'  '+l).join('\n')
  return {text:text.slice(0,from)+value+text.slice(until),start:Math.max(from,start+firstDelta),end:Math.max(from,end+value.length-old.length)}
}
/** Group adjacent typing; bound retained undo data rather than retaining a document per key. */
export function createTextHistory(initial:string,maxBytes=4*1024*1024) {
  let values=[initial],cursor=0,last=0
  return {
    record(value:string,group=true){if(value===values[cursor]){if(!group)last=0;return;}const now=Date.now();values=values.slice(0,cursor+1);if(group&&cursor>0&&now-last<400)values[cursor]=value;else{values.push(value);cursor++}last=now;while(values.length>2&&(values.length>60||values.reduce((n,v)=>n+v.length*2,0)>maxBytes)){values.shift();cursor--}},
    undo(){last=0;if(cursor>0)cursor--;return values[cursor]},redo(){last=0;if(cursor<values.length-1)cursor++;return values[cursor]},
    get canUndo(){return cursor>0},get canRedo(){return cursor<values.length-1},get bytes(){return values.reduce((n,v)=>n+v.length*2,0)},
  }
}
export const editorStats=(text:string)=>{const chars=Array.from(text).length,words=(text.match(/[\u3400-\u9fff]|[a-z0-9]+(?:['’-][a-z0-9]+)*/gi)||[]).length;return {chars,words,lines:text.split('\n').length,minutes:Math.max(1,Math.ceil(words/300))}}
export const escapeHtml=(value:string)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function downloadDocument(title:string,content:string,type:string,extension:string){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=(title||'未命名文档').replace(/[\\/:*?"<>|]/g,'_')+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
