import { splitFileName } from './workspaceTree'

/**
 * 좁은 칸의 파일 이름: 앞부분만 말줄임하고 꼬리(".test.ts")는 남긴다 (style.css `.file-name`).
 * 부모가 줄 수 있어야 한다 (flex 자식이면 min-width: 0)
 */
export function FileName({ name, className }: { name: string; className?: string }) {
  const [stem, ext] = splitFileName(name)
  return (
    <span className={`file-name${className ? ` ${className}` : ''}`}>
      <span className="file-stem">{stem}</span>
      {ext && <span className="file-ext">{ext}</span>}
    </span>
  )
}
