import { seatPlaceOf } from './dotState'
import { nameOf } from './sessionPosition'
import { attendanceOf, type Office, type Session } from './types'

/**
 * 사무실 캔버스(Office.tsx redraw)가 세션에서 읽는 값만 뽑은 것 (순수). 세션 목록 SSE 는 몇 초마다 새 배열을 주지만
 * 그리기에 안 쓰는 값(lastAt·문맥 크기·shells·마지막 말·승인 도구 등 — 마지막 말·도구는 HTML 자리 카드가 props 로 바로 그린다)만 바뀌면 같다.
 * 시간이 흘러 바뀌는 곳(책상·라운지·라운지 졸기, 거리 장소, 시간대)은 여기 없다 — Office.tsx 가 seatPlaceKey·streetPlaceKey·시간대를 붙인다
 */
export function sessionSceneOf(session: Session, now: number): unknown[] {
  const attendance = attendanceOf(session)
  const character = session.character ? [session.character.id, session.character.hair, session.character.top] : null
  return [
    session.id,
    // 배치(팀 섬·파트·Focus Zone)·명패(팀장 금·파트장 은·외부 회색)·외부 책상 소품·인물이 없을 때의 기본 인물
    session.teamId,
    session.partId,
    session.role,
    session.kind,
    // 인물 그림·상태 아이콘·모니터·승인 대기 화살표
    session.status,
    attendance,
    // 승인 대기 화살표 툴팁·라운지 "+N" 카드의 이름 목록 (그때 그린 것)
    nameOf(session),
    // 인물·색 (dotLookOf)
    character,
    session.gender ?? null,
    // 라운지에 앉는 순서 (라운지에 간 세션만. 작업 중에는 대화 줄마다 바뀌는데 그때는 늘 책상이다)
    seatPlaceOf(session, now) !== 'desk' ? (session.turnEndedAt ?? null) : null,
    // 거리 장소·앉는 순서 (퇴근 세션만. Office.tsx 의 offDutyMinutesOf 와 같은 값)
    attendance === 'off' ? (session.offDuty?.endedAt ?? session.lastAt ?? null) : null,
  ]
}

/**
 * 사무실 장면 키: 이 글이 그대로면 다시 그려도 그림이 같다. 세션은 서버 순서(생성순 = 자리 순서) 그대로 잇는다.
 * office 는 통째로 넣는다 — 바뀔 때만 오고(SSE office), 그리기가 팀 객체를 그대로 쥐는 곳(섬 더블클릭 이름 변경의 폴더 경로)이 있어서다
 */
export function officeSceneKey(office: Office, sessions: Session[], selectedId: string | null, now: number): string {
  return JSON.stringify([office, selectedId, sessions.map((session) => sessionSceneOf(session, now))])
}
