package dev.interrobang.pray

/**
 * 화면 맨 위에서 당겨 새로고침할지 (SwipeRefreshLayout.setOnChildScrollUpCallback).
 *
 * Pray 웹은 document 가 아니라 안쪽 요소(대화·목록·xterm·모달 본문)가 스크롤돼서 WebView.canScrollVertically(-1) 이 늘 false 다.
 * 그래서 페이지에 넣은 touchstart 리스너([SCRIPT])가 손가락 밑에 위로 스크롤할 수 있는 조상이 있는지(또는 창이 떠 있는지)
 * 계산해 브리지([BRIDGE_NAME].report)로 알린다. 그 값이 오기 전에는 막는다.
 */
object PullRefresh {
    const val BRIDGE_NAME = "PrayPull"

    /**
     * true 면 막는다 (= 자식이 위로 스크롤할 수 있다).
     * ACTION_DOWN 을 넘기는 동안은 막지 않는다 — SwipeRefreshLayout 은 DOWN 때 막히면 시작 위치를 안 잡아 그 손짓 전체에서 당기기가 안 된다.
     * 당기기는 MOVE 에서 시작하므로, 그때 이번 손짓의 페이지 답(pageBlocks)을 본다. 아직 안 왔으면(null) 막고 다음 MOVE 에서 다시 본다.
     */
    fun isBlocked(isWebVisible: Boolean, isDispatchingDown: Boolean, pageBlocks: Boolean?, webCanScrollUp: Boolean): Boolean {
        if (!isWebVisible) return true
        if (isDispatchingDown) return false
        return webCanScrollUp || (pageBlocks ?: true)
    }

    /**
     * 페이지가 뜰 때마다 넣는다 (같은 문서에 두 번 넣어도 한 번만 건다). 손가락이 둘 이상·Pray 창(.modal-overlay, 확인 창 .dialog-overlay 포함)이 떠 있음·
     * 손가락 밑에서 위로 올라가며 overflow-y 가 auto/scroll/overlay 이고 scrollTop > 0 인 조상이 있음·document 가 내려가 있음·
     * touch-action: none 인 요소(웹이 손짓을 직접 받는 곳 — 목록 ⠿ 끌기 손잡이. 맨 위 목록에서 아래로 끌면 새로고침됐다)·그 조상 → 막는다
     */
    const val SCRIPT = """
(function () {
  if (window.__prayPull || !window.$BRIDGE_NAME) return;
  window.__prayPull = true;
  function blocks(event) {
    if (event.touches.length > 1) return true;
    if (document.querySelector('.modal-overlay')) return true;
    var scroller = document.scrollingElement || document.documentElement;
    if (scroller && scroller.scrollTop > 0) return true;
    for (var el = event.target; el && el.nodeType === 1; el = el.parentElement) {
      var style = getComputedStyle(el);
      if (style.touchAction === 'none') return true;
      if (el.scrollTop > 0) {
        var overflow = style.overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return true;
      }
    }
    return false;
  }
  document.addEventListener('touchstart', function (event) {
    var blocked = true;
    try { blocked = blocks(event); } catch (error) {}
    window.$BRIDGE_NAME.report(blocked);
  }, { capture: true, passive: true });
})();
"""
}
