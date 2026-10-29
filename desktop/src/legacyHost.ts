import { connect } from 'node:net'

/** 옛 이름(jk-corp) 호스트의 pipe. 옛 트레이(또는 스케줄러 호스트)가 떠 있다는 뜻이다 */
export const LEGACY_PIPE_PATH = '\\\\.\\pipe\\jk-corp-host'

/** 이 시간 안에 붙지도 실패하지도 않으면 떠 있지 않은 것으로 본다 (named pipe 는 보통 바로 답한다) */
const CONNECT_TIMEOUT_MS = 2000

/**
 * 그 pipe 에 붙을 수 있는지. 붙으면 아무것도 보내지 않고 바로 끊는다.
 * 옛 트레이 막이용 호환 코드다. 호스트의 `host/src/legacyHost.ts` 와 같다 (트레이는 CommonJS 빌드라 따로 둔다)
 */
export function isPipeAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const finish = (isAlive: boolean) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(isAlive)
    }
    const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
