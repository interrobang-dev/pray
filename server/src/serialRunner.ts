/**
 * 비동기 작업을 한 번에 하나만 돌리는 실행 함수를 만든다. 도는 중에 요청이 오면 표시만 해 두고 끝난 뒤 한 번 더 돈다
 * (여러 요청은 한 번으로 합친다). 겹쳐 돌면 먼저 시작한 작업이 나중에 끝나 옛 결과로 새 결과를 덮어쓸 수 있어서다.
 * 반환한 함수는 던지지 않는다 (작업이 던지면 onError 로 넘기고 다음 요청은 그대로 돈다). 돌려주는 Promise 는 이어 도는 회차까지 끝나면 풀린다
 */
export function serialRunner(task: () => Promise<void>, onError: (error: unknown) => void): () => Promise<void> {
  let running: Promise<void> | null = null
  let isRequested = false

  async function loop(): Promise<void> {
    do {
      isRequested = false
      try {
        await task()
      } catch (error) {
        onError(error)
      }
    } while (isRequested)
    running = null
  }

  return () => {
    if (running) {
      isRequested = true
      return running
    }
    running = loop()
    return running
  }
}
