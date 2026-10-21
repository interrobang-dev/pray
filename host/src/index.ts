import { createServer, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { PIPE_PATH, LineDecoder, encode, type ClientMessage, type HostMessage } from './protocol.js'
import { PtyPool } from './ptyPool.js'
import { listOffDuty, listWebSessions, pruneOffDuty, removeOffDuty, removeWebSession, returnFromOffDuty } from './hq.js'
import { setupFileLog } from './runtime.js'

setupFileLog()
const pool = new PtyPool()
const clients = new Set<Socket>()
/** restart 요청 때의 종료 코드. 0 은 "의도한 중지" 라 트레이가 다시 띄우지 않는다 */
const RESTART_EXIT_CODE = 2

function send(socket: Socket, message: HostMessage): void {
  if (!socket.destroyed) socket.write(encode(message))
}

function broadcast(message: HostMessage): void {
  for (const client of clients) send(client, message)
}

pool.on('output', (sessionId: string, data: string) => broadcast({ type: 'output', sessionId, data }))
pool.on('exit', (sessionId: string, exitCode: number) => {
  console.log(`exit ${sessionId} code=${exitCode}`)
  broadcast({ type: 'exit', sessionId, exitCode })
})
pool.on('change', () => broadcast({ type: 'sessions', sessions: pool.list() }))

function handle(socket: Socket, message: ClientMessage): void {
  switch (message.type) {
    case 'list':
      send(socket, { type: 'sessions', sessions: pool.list() })
      return
    case 'spawn':
      try {
        pool.spawn(message)
        console.log(`spawn ${message.sessionId} cwd=${message.cwd}`)
      } catch (error) {
        console.error(`spawn 실패 ${message.sessionId}`, error)
        send(socket, { type: 'error', sessionId: message.sessionId, message: String(error) })
      }
      return
    case 'attach': {
      const data = pool.snapshot(message.sessionId)
      if (data === null) {
        send(socket, { type: 'error', sessionId: message.sessionId, message: '세션 없음' })
        return
      }
      send(socket, { type: 'snapshot', sessionId: message.sessionId, data })
      return
    }
    case 'input':
      pool.write(message.sessionId, message.data)
      return
    case 'resize':
      pool.resize(message.sessionId, message.cols, message.rows)
      return
    case 'kill':
      pool.kill(message.sessionId)
      return
    case 'resume':
      resumeOffDuty(socket, message.sessionId)
      return
    case 'forget':
      try {
        if (removeOffDuty(message.sessionId)) console.log(`퇴근 기록 지움 ${message.sessionId}`)
      } catch (error) {
        console.error(`hq.json 기록 실패 (퇴근 기록 지우기 ${message.sessionId})`, error)
        send(socket, { type: 'error', sessionId: message.sessionId, message: String(error) })
      }
      // 서버는 sessions 를 받으면 hq.json 을 다시 읽어 목록을 보낸다
      broadcast({ type: 'sessions', sessions: pool.list() })
      return
    case 'restart':
      // 웹 세션은 호스트와 함께 끊기고, 다시 뜰 때 webSessions 를 --resume 한다
      console.log(`restart 요청 → 종료 코드 ${RESTART_EXIT_CODE} 로 나감 (트레이 앱이 다시 띄움)`)
      setTimeout(() => process.exit(RESTART_EXIT_CODE), 100)
      return
  }
}

const server = createServer((socket) => {
  clients.add(socket)
  const decoder = new LineDecoder()
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    for (const message of decoder.push(chunk)) handle(socket, message as ClientMessage)
  })
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => clients.delete(socket))
  send(socket, { type: 'sessions', sessions: pool.list() })
})

/** 퇴근 기록의 cwd·extraArgs 그대로 --resume 하고 기록을 webSessions 로 되돌린다. 폴더·팀장 확인은 서버가 한다 */
function resumeOffDuty(socket: Socket, sessionId: string): void {
  try {
    const record = listOffDuty().find((r) => r.sessionId === sessionId)
    if (!record) throw new Error('퇴근 기록 없음')
    pool.spawn({ sessionId, cwd: record.cwd, resume: true, extraArgs: record.extraArgs })
    console.log(`resume (퇴근 기록) ${sessionId} cwd=${record.cwd}`)
  } catch (error) {
    console.error(`resume 실패 ${sessionId}`, error)
    send(socket, { type: 'error', sessionId, message: String(error) })
    return
  }
  // 띄운 뒤에 옮긴다. 실패하면 세션은 돌지만 기록이 퇴근에 남는다 (끝날 때 webSessions 에 없어 그대로)
  try {
    returnFromOffDuty(sessionId)
  } catch (error) {
    console.error(`hq.json 기록 실패 (퇴근 → webSessions ${sessionId})`, error)
  }
}

/** 지난번 호스트가 살려 두던 웹 세션을 --resume 으로 되살린다 */
function resumeWebSessions(): void {
  // hq.json 이 깨져 있으면 던진다. 호스트는 살려 두고 기록은 건드리지 않는다
  let records
  try {
    records = listWebSessions()
  } catch (error) {
    console.error('resume 전부 건너뜀 (hq.json 을 읽을 수 없음)', error)
    return
  }
  for (const record of records) {
    if (!existsSync(record.cwd)) {
      console.log(`resume 건너뜀 (폴더 없음) ${record.sessionId} ${record.cwd}`)
      try {
        removeWebSession(record.sessionId)
      } catch (error) {
        console.error(`hq.json 기록 실패 (삭제 ${record.sessionId})`, error)
      }
      continue
    }
    try {
      pool.spawn({ sessionId: record.sessionId, cwd: record.cwd, resume: true, extraArgs: record.extraArgs })
      console.log(`resume ${record.sessionId} cwd=${record.cwd}`)
    } catch (error) {
      console.error(`resume 실패 ${record.sessionId}`, error)
    }
  }
}

/** 보관 기간이 지난 퇴근 기록을 지운다 (세션이 끝날 때도 ptyPool 이 한다) */
function pruneOffDutyOnStart(): void {
  try {
    const expired = pruneOffDuty()
    if (expired.length) console.log(`퇴근 기록 보관 기간 지남, 지움: ${expired.join(', ')}`)
  } catch (error) {
    console.error('hq.json 기록 실패 (퇴근 기록 정리)', error)
  }
}

server.listen(PIPE_PATH, () => {
  console.log(`jk-corp host listening on ${PIPE_PATH}`)
  pruneOffDutyOnStart()
  resumeWebSessions()
})
