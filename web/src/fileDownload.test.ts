import { describe, expect, it } from 'vitest'
import { absoluteDownloadUrl, downloadUrl } from './fileDownload'

const SESSION = '11111111-2222-4333-8444-555555555555'

describe('downloadUrl', () => {
  it('세션의 file/download 에 path 를 쿼리로', () => {
    expect(downloadUrl(SESSION, 'web/src/App.tsx')).toBe(`/api/sessions/${SESSION}/file/download?path=web%2Fsrc%2FApp.tsx`)
  })

  it('한글·공백·#·& 가 든 이름도 쿼리 안에 그대로 남는다', () => {
    const url = new URL(downloadUrl(SESSION, '한글 폴더/a #b&c.hwp'), 'http://127.0.0.1:4710')
    expect(url.pathname).toBe(`/api/sessions/${SESSION}/file/download`)
    expect(url.searchParams.get('path')).toBe('한글 폴더/a #b&c.hwp')
    expect(url.hash).toBe('')
  })
})

describe('absoluteDownloadUrl', () => {
  it('페이지 출처를 붙인 절대 주소', () => {
    expect(absoluteDownloadUrl('http://100.64.0.1:4710', SESSION, 'a.pdf')).toBe(`http://100.64.0.1:4710/api/sessions/${SESSION}/file/download?path=a.pdf`)
    expect(absoluteDownloadUrl('http://office.tailda52be.ts.net:4710', SESSION, 'docs/보고서.hwp')).toBe(
      `http://office.tailda52be.ts.net:4710/api/sessions/${SESSION}/file/download?path=docs%2F%EB%B3%B4%EA%B3%A0%EC%84%9C.hwp`,
    )
  })
})
