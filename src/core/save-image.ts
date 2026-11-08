/** Exporting an edited image is explicit; it never uploads or sends a message. */
export async function saveImageCopy(file: File, token: string): Promise<string | undefined | null> {
  if ((window as any).__TAURI__) {
    const response = await fetch('/local-save-image?name=' + encodeURIComponent(file.name), {
      method: 'POST', headers: { 'content-type': file.type, token }, body: file,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) throw new Error(result?.msg || 'HTTP ' + response.status)
    return result.cancelled ? null : result.path
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url; link.download = file.name; link.style.display = 'none'
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
