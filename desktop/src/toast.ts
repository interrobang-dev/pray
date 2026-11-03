/** 세션 알림의 Windows 토스트 XML (Electron Notification 의 toastXml). Electron 을 쓰지 않는 순수 함수 */

export interface ToastContent {
  title: string
  body: string
  /** 머리줄. id 가 같은 알림은 알림 센터에서 한 묶음이다. null 이면 머리줄 없음 */
  header: { id: string; title: string } | null
  /** 아래 작은 회색 줄. 빈 글이면 없음 */
  attribution: string
  /** 왼쪽 원 그림 (file:// URL). null 이면 없음 (앱 아이콘) */
  iconUrl: string | null
  /** 여는 버튼 글자 (승인 대기는 Review) */
  openLabel: string
}

/**
 * 본문 클릭·[Open]·머리줄의 arguments. Electron 44 는 Activated 의 arguments 에 "type=action"·"type=reply" 가 들어 있으면
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

/**
 * ToastGeneric 한 장: [머리줄] · 제목 · 본문 · 작은 회색 줄 · 왼쪽 원 그림 · [Open|Review] [Dismiss].
 * Dismiss 는 activationType="system" arguments="dismiss" 로 Windows 가 닫는다 (앱에 Activated 가 오지 않는다)
 */
export function toastXml(content: ToastContent): string {
  const open = escapeAttribute(TOAST_OPEN_ARGUMENT)
  const parts = [`<toast launch="${open}" activationType="foreground">`]
  if (content.header) {
    parts.push(
      `<header id="${escapeAttribute(content.header.id)}" title="${escapeAttribute(content.header.title)}" arguments="${open}" activationType="foreground"/>`,
    )
  }
  parts.push('<visual><binding template="ToastGeneric">', text(content.title))
  if (content.body) parts.push(text(content.body))
  if (content.attribution) parts.push(text(content.attribution, 'attribution'))
  if (content.iconUrl) parts.push(`<image placement="appLogoOverride" hint-crop="circle" src="${escapeAttribute(content.iconUrl)}"/>`)
  parts.push(
    '</binding></visual>',
    '<actions>',
    `<action content="${escapeAttribute(content.openLabel)}" activationType="foreground" arguments="${open}"/>`,
    '<action content="Dismiss" activationType="system" arguments="dismiss"/>',
    '</actions>',
    '</toast>',
  )
  return parts.join('')
}
