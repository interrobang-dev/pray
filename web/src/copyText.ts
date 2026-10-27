/**
 * 클립보드에 글을 넣는다. 성공하면 true.
 * `navigator.clipboard` 는 secure context(https·localhost)에서만 있어, 다른 PC 에서 http://<IP>:4710 으로 열면 없다 —
 * 그때(또는 실패하면) 숨긴 textarea 를 선택해 `document.execCommand('copy')` 로 넣는다
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 등 — 예비 경로로
    }
  }
  return copyWithTextarea(text)
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  // 화면 밖이 아니라 구석에 투명하게 둔다 (일부 브라우저는 화면 밖 요소를 선택하지 못한다). 16px = 아이폰 포커스 확대 방지
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px'
  const previousFocus = document.activeElement
  const selection = document.getSelection()
  const previousRanges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : []
  document.body.appendChild(textarea)
  let isCopied = false
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    isCopied = document.execCommand('copy')
  } catch {
    isCopied = false
  } finally {
    textarea.remove()
    // 사용자가 잡아 둔 선택·포커스를 돌려 놓는다
    if (selection) {
      selection.removeAllRanges()
      previousRanges.forEach((range) => selection.addRange(range))
    }
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
  }
  return isCopied
}
