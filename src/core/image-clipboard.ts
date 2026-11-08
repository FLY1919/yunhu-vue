async function imageAsPng(url: string): Promise<Blob> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('图片加载失败（HTTP ' + response.status + '）')
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob

  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取图片像素')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(png => png ? resolve(png) : reject(new Error('图片转码失败')), 'image/png')
    })
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}

export function copyImage(url: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持图片剪贴板')
  }
  // Start the write within the menu click, before loading or decoding the image.
  const png = imageAsPng(url)
  void png.catch(() => {})
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
