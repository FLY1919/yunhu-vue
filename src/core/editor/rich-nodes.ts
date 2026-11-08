import { Node, nodeInputRule, textblockTypeInputRule } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import EditorCodeBlockView from '../../components/EditorCodeBlock.vue'
import { renderMath } from './render'
function mathNode(block:boolean){const name=block?'mathBlock':'mathInline',tag=block?'div':'span';return Node.create({
 name,group:block?'block':'inline',inline:!block,atom:true,selectable:true,
 addAttributes(){return {latex:{default:'',parseHTML:el=>el.getAttribute('data-latex')}}},
 parseHTML(){return [{tag:tag+'[data-math="'+name+'"]'}]},renderHTML({HTMLAttributes}){return [tag,{...HTMLAttributes,'data-math':name,'data-latex':HTMLAttributes.latex,class:'rich-math'},HTMLAttributes.latex]},
 markdownTokenName:name,markdownTokenizer:{name,level:block?'block':'inline',start:'$',tokenize(src:string){const match=(block?/^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/:/^\$(?!\$)([^$\n]+?)\$/).exec(src);if(match)return {type:name,raw:match[0],text:match[1]}}},
 parseMarkdown(token:any){return {type:name,attrs:{latex:token.text}}},renderMarkdown(node:any){return block?'$$\n'+node.attrs.latex+'\n$$':'$'+node.attrs.latex+'$'},
 addInputRules(){return [nodeInputRule({find:block?/^\$\$\s([^$]+)\$\$$/:/\$([^$\n]+)\$$/,type:this.type,getAttributes:m=>({latex:m[1]})})]},
 addNodeView(){return ({node,editor,getPos})=>{let current=node;const dom=document.createElement(tag),output=document.createElement('span');dom.className='rich-math';dom.setAttribute('data-math',name);dom.append(output);const render=()=>{output.textContent=current.attrs.latex;void renderMath(output,current.attrs.latex,block)};render();dom.ondblclick=e=>{e.preventDefault();if(!editor.isEditable)return;const input=document.createElement('input');input.value=current.attrs.latex;input.setAttribute('aria-label','编辑公式');output.hidden=true;dom.append(input);let finished=false;const finish=(save:boolean)=>{if(finished)return;finished=true;if(save&&typeof getPos==='function'){const pos=getPos();if(typeof pos==='number')editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{latex:input.value}))}input.remove();output.hidden=false;editor.commands.focus()};input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true)}if(e.key==='Escape')finish(false)};input.onblur=()=>finish(true);input.focus()};return {dom,update(next){if(next.type!==current.type)return false;current=next;render();return true},stopEvent:e=>e.target instanceof HTMLInputElement,ignoreMutation:()=>true,destroy(){dom.ondblclick=null}}}}
})}
export const MathInline=mathNode(false),MathBlock=mathNode(true)
export const EditorCodeBlock = CodeBlock.extend({
  addNodeView() { return VueNodeViewRenderer(EditorCodeBlockView) },
  addInputRules() {
    return [/^```([A-Za-z0-9_+.#-]+)?[ \n]$/, /^~~~([A-Za-z0-9_+.#-]+)?[ \n]$/].map(find =>
      textblockTypeInputRule({ find, type: this.type, getAttributes: match => ({ language: match[1] || null }) }))
  },
  renderMarkdown(node) {
    const code: string = node.content?.map(child => child.text || '').join('') || ''
    const language = node.attrs?.language || ''
    let fenceLength = 3
    for (const run of code.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run[0].length + 1)
    const fence = '`'.repeat(fenceLength)
    return fence + language + '\n' + code + '\n' + fence
  },
}).configure({ exitOnTripleEnter: false })
