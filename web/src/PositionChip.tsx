/** 이름 앞 작은 회색 역할 칩. 역할이 없으면 아무것도 그리지 않는다 */
export function PositionChip({ position }: { position: string | null }) {
  if (!position) return null
  return <span className="position-chip">{position}</span>
}
