import { confirmDialog } from './Dialog'

/**
 * Files 탭에 저장 안 한 편집이 있는지 (화면 전체에 하나 — 편집기는 한 번에 하나다). FilesTab 이 적고 App 이 탭·세션·패널을 바꾸기 전에 묻는다.
 * Files 탭이 언마운트되면 편집기 글이 사라지기 때문이다
 */
let unsavedPath: string | null = null

export function setUnsavedEdit(path: string | null): void {
  unsavedPath = path
}

export function hasUnsavedEdit(): boolean {
  return unsavedPath !== null
}

/** 저장 안 한 편집을 버려도 되는지 묻는다 (없으면 바로 true). 버리면 기록을 지운다 */
export async function confirmDiscardUnsaved(): Promise<boolean> {
  if (unsavedPath === null) return true
  const isDiscarded = await confirmDialog(`${unsavedPath} has unsaved changes. Discard them?`, {
    title: 'Unsaved changes',
    confirmLabel: 'Discard',
    isDanger: true,
  })
  if (isDiscarded) unsavedPath = null
  return isDiscarded
}

/** 저장 안 한 편집이 없으면 바로 run, 있으면 버리기로 한 뒤에만 run (없을 때는 동기 그대로 — 한 번에 바꾸는 state 순서를 지킨다) */
export function whenLeavingAllowed(run: () => void): void {
  if (unsavedPath === null) {
    run()
    return
  }
  void confirmDiscardUnsaved().then((isAllowed) => isAllowed && run())
}
