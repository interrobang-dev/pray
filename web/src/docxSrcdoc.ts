/** docx 미리보기가 받는 파일 크기 상한. mammoth 가 메인 스레드에서 zip·XML 을 풀어 그보다 크면 화면이 오래 멈춘다 */
export const DOCX_PREVIEW_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * 문서 밖으로 나가는 링크의 href 를 떼고 주소는 title 로 남긴다 (`#` 로 시작하는 문서 안 링크·각주는 그대로).
 * 미리보기 iframe 안에서 누르면 그 자리가 다른 사이트로 바뀌기만 해서다. mammoth 는 속성을 늘 큰따옴표로 이스케이프해 쓴다
 */
export function withoutExternalLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)\shref="([^"]*)"/g, (whole, before: string, href: string) =>
    href.startsWith('#') ? whole : `<a${before} title="${href}"`,
  )
}

/**
 * mammoth 가 만든 본문 HTML → iframe srcdoc 문서. 흰 바탕·검은 글자(문서는 흰 바탕을 전제 — HTML 미리보기와 같은 테마 예외),
 * CSP 로 그림은 data: 만(mammoth 는 문서 속 그림을 data URI 로 넣는다), 스타일은 이 안의 것만 — 바깥 주소는 아무것도 부르지 않는다.
 * 스크립트는 iframe sandbox(allow-scripts 없음)가 막는다
 */
export function docxSrcdoc(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html { background: #fff; color: #1f2328; }
body { margin: 0 auto; max-width: 860px; padding: 24px 32px 48px; font: 15px/1.6 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif; overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 12px 0; max-width: 100%; }
td, th { border: 1px solid #c8ccd1; padding: 4px 8px; vertical-align: top; }
th { background: #f3f4f6; }
td > p, th > p { margin: 0; }
a { color: #0b57d0; }
a:not([href]) { text-decoration: underline; }
@media (max-width: 600px) { body { padding: 16px; font-size: 14px; } }
</style></head><body>${withoutExternalLinks(bodyHtml)}</body></html>`
}
