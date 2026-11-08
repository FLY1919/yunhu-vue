import { Marked } from 'marked'
import { sanitizeHtml } from '../render'
import { escapeHtml } from './core'
import { readableColor } from '../theme-colors'
const parser=new Marked({gfm:true,breaks:true,extensions:[{name:'footnoteDefinition',level:'block',start(src:string){return src.indexOf('[^')},tokenizer(src:string){const m=/^\[\^([\w-]+)\]:[ \t]*(.+)(?:\n|$)/.exec(src);if(m)return {type:'footnoteDefinition',raw:m[0],label:m[1],text:m[2]}},renderer(token:any){return '<aside id="fn-'+escapeHtml(token.label)+'" class="editor-footnote"><sup>'+escapeHtml(token.label)+'</sup> '+parser.parseInline(token.text)+'</aside>'}},{name:'footnoteRef',level:'inline',start(src:string){return src.indexOf('[^')},tokenizer(src:string){const m=/^\[\^([\w-]+)\]/.exec(src);if(m)return {type:'footnoteRef',raw:m[0],label:m[1]}},renderer(token:any){return '<sup><a href="#fn-'+escapeHtml(token.label)+'">'+escapeHtml(token.label)+'</a></sup>'}},{
 name:'mathBlock',level:'block',start(src:string){return src.indexOf('$$')},tokenizer(src:string){const m=/^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/.exec(src);if(m)return {type:'mathBlock',raw:m[0],text:m[1]}},renderer(token:any){return '<div class="editor-math" data-display="true" data-latex="'+escapeHtml(token.text)+'">'+escapeHtml(token.text)+'</div>'}
},{name:'mathInline',level:'inline',start(src:string){return src.indexOf('$')},tokenizer(src:string){const m=/^\$(?!\$)([^$\n]+?)\$/.exec(src);if(m)return {type:'mathInline',raw:m[0],text:m[1]}},renderer(token:any){return '<span class="editor-math" data-latex="'+escapeHtml(token.text)+'">'+escapeHtml(token.text)+'</span>'}}] as any})
export function previewBlocks(text:string){let offset=0;return parser.lexer(text).map((token:any)=>{const start=offset;offset+=token.raw.length;return {start,end:offset,html:sanitizeHtml(parser.parser([token])),key:start+':'+token.raw,code:token.type==='code'&&/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(token.raw)?{text:String(token.text||''),language:String(token.lang||'text')}:undefined}})}
let mathLoad:Promise<any>,codeLoad:Promise<any>
export function mathRenderer(){return mathLoad ||= Promise.all([import('katex'),import('katex/dist/katex.min.css')]).then(([module])=>module.default)}
export async function renderMath(el:HTMLElement,latex:string,display=false){try{const katex=await mathRenderer();if(el.isConnected)katex.render(latex,el,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxExpand:500})}catch{el.textContent=latex}}
const loaders: Record<string, () => Promise<any>> = {
  'javascript': () => import('shiki/langs/javascript.mjs'),
  'typescript': () => import('shiki/langs/typescript.mjs'),
  'json': () => import('shiki/langs/json.mjs'),
  'python': () => import('shiki/langs/python.mjs'),
  'css': () => import('shiki/langs/css.mjs'),
  'html': () => import('shiki/langs/html.mjs'),
  'bash': () => import('shiki/langs/bash.mjs'),
  'markdown': () => import('shiki/langs/markdown.mjs'),
  'c': () => import('shiki/langs/c.mjs'),
  'cpp': () => import('shiki/langs/cpp.mjs'),
  'csharp': () => import('shiki/langs/csharp.mjs'),
  'rust': () => import('shiki/langs/rust.mjs'),
  'go': () => import('shiki/langs/go.mjs'),
  'java': () => import('shiki/langs/java.mjs'),
  'kotlin': () => import('shiki/langs/kotlin.mjs'),
  'swift': () => import('shiki/langs/swift.mjs'),
  'sql': () => import('shiki/langs/sql.mjs'),
  'yaml': () => import('shiki/langs/yaml.mjs'),
  'toml': () => import('shiki/langs/toml.mjs'),
  'powershell': () => import('shiki/langs/powershell.mjs'),
  'dockerfile': () => import('shiki/langs/dockerfile.mjs'),
  'vue': () => import('shiki/langs/vue.mjs'),
  'xml': () => import('shiki/langs/xml.mjs'),
  'lua': () => import('shiki/langs/lua.mjs'),
  'ini': () => import('shiki/langs/ini.mjs'),
  'php': () => import('shiki/langs/php.mjs'),
  'ruby': () => import('shiki/langs/ruby.mjs'),
  'dart': () => import('shiki/langs/dart.mjs'),
  'diff': () => import('shiki/langs/diff.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  'graphql': () => import('shiki/langs/graphql.mjs'),
  'make': () => import('shiki/langs/make.mjs'),
  'r': () => import('shiki/langs/r.mjs'),
  'zig': () => import('shiki/langs/zig.mjs'),
  'tsx': () => import('shiki/langs/tsx.mjs'),
  'jsx': () => import('shiki/langs/jsx.mjs'),
}
export const codeLanguageOptions = ['text', ...Object.keys(loaders)].map(value => ({ value, label: value === 'text' ? '纯文本' : value }))
const aliases: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', md: 'markdown',
  'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rs: 'rust', ps1: 'powershell', yml: 'yaml',
  kt: 'kotlin', objc: 'objective-c', docker: 'dockerfile', plaintext: 'text',
}
export async function highlighter(language:string){language=language.toLowerCase();language=Object.hasOwn(aliases,language)?aliases[language]:language;if(!Object.hasOwn(loaders,language))return null;codeLoad ||= Promise.all([import('shiki/core'),import('shiki/engine/javascript'),import('shiki/themes/github-dark.mjs'),import('shiki/themes/github-light.mjs')]).then(([core,engine,dark,light])=>core.createHighlighterCore({themes:[dark.default,light.default],langs:[],engine:engine.createJavaScriptRegexEngine()}));const h=await codeLoad;if(!h.getLoadedLanguages().includes(language))await h.loadLanguage((await loaders[language]()).default);return {h,language}}
export async function highlightCode(code:string,language:string){if(code.length>20000)return escapeHtml(code);try{const loaded=await highlighter(language);if(!loaded)return escapeHtml(code);const style=getComputedStyle(document.documentElement),dark=document.documentElement.dataset.theme!=='light',bg=style.getPropertyValue('--card').trim();return loaded.h.codeToTokens(code,{lang:loaded.language,theme:dark?'github-dark':'github-light'}).tokens.map((line:any[])=>line.map(t=>{const color=/^#[\da-f]{3,6}$/i.test(bg)?readableColor(t.color||'#888888',[bg]):style.getPropertyValue('--fg').trim();return '<span style="color:'+color+'">'+escapeHtml(t.content)+'</span>'}).join('')).join('\n')}catch{return escapeHtml(code)}}
/** Safe export: formulas use native MathML so a saved HTML file does not depend on local font URLs. */
export async function renderExportBody(text:string){const container=document.createElement('div');container.innerHTML=previewBlocks(text).map(block=>block.html).join('');const formulas=container.querySelectorAll<HTMLElement>('[data-latex]');if(formulas.length){const katex=await mathRenderer();for(const el of formulas)el.innerHTML=katex.renderToString(el.dataset.latex||'',{displayMode:el.dataset.display==='true',throwOnError:false,trust:false,output:'mathml',maxExpand:500})}for(const image of container.querySelectorAll('img')){try{const raw=image.getAttribute('src')||'';if(raw.startsWith('/'))image.src=new URL(raw,location.origin).href}catch{}}return container.innerHTML}
