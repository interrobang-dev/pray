/** 세션 알림의 Windows 토스트 XML (Electron Notification 의 toastXml). Electron 을 쓰지 않는 순수 함수 */

export interface ToastContent {
  title: string
  /** 본문. 한 줄로 보이려면 부른 쪽이 잘라서 넣는다 (맨 위 text 의 hint-maxLines 는 Windows 가 무시한다 — 실측) */
  body: string
  /** 아래 작은 회색 줄. 빈 글이면 없음 */
  attribution: string
  /** 왼쪽 원 그림 (file:// URL). null 이면 없음 (앱 아이콘) */
  iconUrl: string | null
}

/**
 * 토스트(본문) 클릭의 launch arguments. Electron 44 는 Activated 의 arguments 에 "type=action"·"type=reply" 가 들어 있으면
 * click 이 아니라 action·reply 로 보내고, COM 활성화 쪽은 "tag=" 로 알림을 찾는다 — 그래서 그런 글자가 없는 값을 쓴다
 */
export const TOAST_OPEN_ARGUMENT = 'open'

/** XML 1.0 에 넣을 수 없는 문자 (탭·줄바꿈·CR 밖의 제어 문자, 짝 없는 서로게이트, U+FFFE·U+FFFF) */
const INVALID_XML_CHARS = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu

/** 글 내용용: 넣을 수 없는 문자를 지우고 & < > " ' 를 바꾼다 */
export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** 속성 값용: 줄바꿈·탭은 파서가 공백으로 바꾸므로 미리 공백으로 */
function escapeAttribute(text: string): string {
  return escapeXml(text.replace(/[\t\n\r]+/g, ' '))
}

function text(content: string, placement?: string): string {
  return `<text${placement ? ` placement="${placement}"` : ''}>${escapeXml(content)}</text>`
}

/** ToastGeneric 한 장: 제목 · 본문 · 작은 회색 줄 · 왼쪽 원 그림. 버튼·머리줄은 없고 누르면 launch 로 click 이 온다 */
export function toastXml(content: ToastContent): string {
  const parts = [`<toast launch="${escapeAttribute(TOAST_OPEN_ARGUMENT)}" activationType="foreground">`]
  parts.push('<visual><binding template="ToastGeneric">', text(content.title))
  if (content.body) parts.push(text(content.body))
  if (content.attribution) parts.push(text(content.attribution, 'attribution'))
  if (content.iconUrl) parts.push(`<image placement="appLogoOverride" hint-crop="circle" src="${escapeAttribute(content.iconUrl)}"/>`)
  parts.push('</binding></visual>', '</toast>')
  return parts.join('')
}
