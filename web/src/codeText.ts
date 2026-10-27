/** react-markdown 이 components 에 넘기는 hast 노드 중 글을 모으는 데 필요한 꼴 (text·element·root) */
export interface HastNode {
  type: string
  value?: string
  children?: HastNode[]
}

/** hast 노드 밑의 글자를 순서대로 모은다. 문법 강조가 코드를 `<span>` 으로 쪼개도 글자는 그대로 이어진다 */
export function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/** 코드 블록 글은 끝에 줄바꿈이 하나 붙어 있다 (마크다운 파서 규칙). 하나만 뗀다 — 코드 자체의 빈 줄은 남긴다 */
export function stripOneTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '')
}

/** `<pre>` hast 노드 → 복사할 코드 글자 */
export function codeBlockText(preNode: HastNode | undefined): string {
  return stripOneTrailingNewline(hastText(preNode))
}
