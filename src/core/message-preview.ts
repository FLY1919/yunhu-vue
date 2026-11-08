import { parse, toText } from '../satori/element'

/** 用于会话、通知和引用的摘要；媒体地址不是可读的消息内容。 */
export function messagePreview(message: any): string {
  if (message.recalled) return '[已撤回]'
  const elements = message.elements?.length ? message.elements : parse(message.content || {}, message.type)
  return elements.map((el: any) => {
    switch (el.type) {
      case 'img': return '[图片]'
      case 'sticker': return '[表情]'
      case 'video': return '[视频]'
      case 'audio': return '[语音]'
      case 'file': return '[文件]' + (el.attrs.name ? ' ' + el.attrs.name : '')
      case 'post': return '[文章]' + (el.attrs.title ? ' ' + el.attrs.title : '')
      case 'form': return '[表单]'
      default: return toText([el])
    }
  }).join('').slice(0, 80)
}

export function messageQuote(message: any) {
  const elements = message.elements?.length ? message.elements : parse(message.content || {}, message.type)
  const image = !message.recalled && elements.find((el: any) => el.type === 'img' || el.type === 'sticker')
  return { kind: elements.find((el:any)=>['video','audio','file'].includes(el.type))?.type || 'text', id: message.id, sender: message.sender || '', preview: messagePreview(message), image: image?.attrs.src || '' }
}
