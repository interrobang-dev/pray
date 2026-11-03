import { chatImageTarget, decodeSafely, imageDestinationOf } from './chatImageUrl'

/**
 * 대화 마크다운 링크의 원문 주소 (ChatLink.tsx). 그림처럼 원문에서 그 링크 자리(start·end 오프셋)를 잘라 꺼낸다 —
 * 파서는 `\` 뒤 문장 부호를 이스케이프로 먹고(`D:\workspace\@private` → `D:\workspace@private`) 주소를 퍼센트 인코딩한다.
 * 링크 글에 그림·`](` 가 들어갈 수 있어(`[![a](x.png)](C:\r.html)`) 마지막 `](` 부터 본다. 못 꺼내면(참조 링크·자동 링크) 파서가 준 주소(웹 주소가 아니면 인코딩을 풀어서)
 */
export function rawLinkUrl(markdown: string | null, start: number | undefined, end: number | undefined, parsed: string): string {
  if (markdown !== null && start !== undefined && end !== undefined) {
    const source = markdown.slice(start, end)
    const destination = imageDestinationOf(source.slice(Math.max(0, source.lastIndexOf(']('))))
    if (destination !== null) return destination
  }
  return /^(https?|mailto):/i.test(parsed) ? parsed : decodeSafely(parsed)
}

/**
 * 원문 주소가 이 PC 의 .html·.htm 파일이면 그 경로, 아니면 null (순수). 경로 꼴은 대화 속 그림과 같다:
 * 드라이브 문자 절대 경로·`file:///C:/…`(인코딩을 푼다)·세션 작업 폴더 기준 상대 경로. `#`·`?` 가 붙은 것(`a.html#x`)은 그대로 보통 링크
 */
export function localHtmlPath(raw: string): string | null {
  const path = chatImageTarget(raw, null).path
  return path !== null && !/^[#?]/.test(path) && /\.html?$/i.test(path) ? path : null
}
