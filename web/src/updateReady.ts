/**
 * 트레이 창의 업데이트 띠 (UpdateBand.tsx) 순수 함수. 이름이 updateBand.ts 가 아닌 것은 Windows 가 대소문자를 가리지 않아 ./UpdateBand 와 겹쳐서다. 트레이(desktop/src/main.ts)가 업데이트를 다 받으면 `<html data-update-ready="x.y.z">` 를 건다
 */

/** `data-update-ready` 값 → 띄울 버전. 없거나 이상한 값이면 null */
export function readUpdateVersion(value: string | undefined): string | null {
  const version = value?.trim() ?? ''
  return version !== '' && version.length <= 40 ? version : null
}

export function updateBandText(version: string): string {
  return `Pray ${version} is ready · Refresh to update`
}
