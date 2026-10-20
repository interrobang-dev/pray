import { createServer, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { PIPE_PATH, LineDecoder, encode, type ClientMessage, type HostMessage } from './protocol.js'
import { PtyPool } from './ptyPool.js'
import { listWebSessions, removeWebSession } from './hq.js'
import { setupFileLog } from './runtime.js'

setupFileLog()
const pool = new PtyPool()
const clients = new Set<Socket>()

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

/** 지난번 호스트가 살려 두던 웹 세션을 --resume 으로 되살린다 */
function resumeWebSessions(): void {
  for (const record of listWebSessions()) {
    if (!existsSync(record.cwd)) {
      console.log(`resume 건너뜀 (폴더 없음) ${record.sessionId} ${record.cwd}`)
      removeWebSession(record.sessionId)
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

server.listen(PIPE_PATH, () => {
  console.log(`jk-corp host listening on ${PIPE_PATH}`)
  resumeWebSessions()
})
