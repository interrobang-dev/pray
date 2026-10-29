import { connect } from 'node:net'

/** 이 시간 안에 붙지도 실패하지도 않으면 떠 있지 않은 것으로 본다 (named pipe 는 보통 바로 답한다) */
const CONNECT_TIMEOUT_MS = 2000

/**
 * 그 pipe 에 붙을 수 있는지. 붙으면 아무것도 보내지 않고 바로 끊는다.
 * 옛 호스트 막이용 호환 코드다 (pipe 이름이 바뀌어 옛·새 호스트가 서로를 못 본다). 트레이(desktop/src/legacyHost.ts)에 같은 것이 따로 있다
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
