/**
 * 옛 localStorage 키(jk-corp.*)를 새 키(pray.*)로 한 번 복사한다 (legacyStorage.ts). main.tsx 가 맨 먼저 불러온다 —
 * theme.ts 는 불러올 때 저장값을 읽고 App 을 불러오면 theme.ts 도 같이 불려서 main.tsx 본문(렌더 전)에서 하면 늦다
 */
import { copyLegacyKeys } from './legacyStorage'

try {
  copyLegacyKeys(localStorage)
} catch {
  // 저장소가 막힌 브라우저: 읽는 곳도 기본값으로 본다
}
