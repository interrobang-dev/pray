/**
 * 트레이 창(Electron)인지: Windows 기본 제목 표시줄 대신 − □ × 만 오버레이로 남긴 창이면 Window Controls Overlay 가 보인다 (desktop/src/titleBar.ts).
 * 그 창에서만 `<html data-titlebar>` 를 걸고 맨 위에 띠를 그린다 — 브라우저(이 PC·다른 PC·폰)에서는 아무것도 바뀌지 않는다.
 * 페이지 첫 스크립트 때 이미 visible 이다 (Electron 44 시험 앱으로 실측). main.tsx 가 그리기 전에 불러온다
 */
export const hasTitleBar = (() => {
  try {
    return (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible === true
  } catch {
    return false
  }
})()

if (hasTitleBar) document.documentElement.dataset.titlebar = ''

/**
 * 트레이 창 맨 위 띠: 로고 마크 + "Pray" 와, 사이드바 열 오른쪽 끝의 버튼 자리(`.titlebar-actions`).
 * 버튼(Appearance·사무실 보이기/숨기기)은 App 이 그 자리에 portal 로 그린다 — 상태·동작이 App 에 있어서. 로그인·로딩 화면은 자리만 비어 있다.
 * 띠 전체가 창 끌기 자리이고(더블클릭 최대화는 Windows 가 한다) 오른쪽 − □ × 자리는 비워 둔다.
 * 바탕은 `--panel` 한 색(style.css `.titlebar`), 글자색 `--muted` 는 트레이가 읽어 버튼 기호 색으로 쓴다
 */
export function TitleBar({ actionsRef }: { actionsRef: (element: HTMLDivElement | null) => void }) {
  return (
    <div className="titlebar">
      <div className="titlebar-title">
        {/* 목록 헤더와 같은 마크: 배율 100% 는 손으로 맞춘 16px 판, 그보다 큰 배율은 벡터판 */}
        <img className="logo" src="/favicon.svg" srcSet="/favicon.svg 1x, /logo.svg 2x" width={16} height={16} alt="" draggable={false} />
        <span className="titlebar-name">Pray</span>
      </div>
      <div className="titlebar-actions" ref={actionsRef} />
    </div>
  )
}
