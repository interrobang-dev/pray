import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import {
  PIPE_PATH,
  LineDecoder,
  encode,
  type ClientMessage,
  type HostMessage,
  type HostSession,
} from '@pray/host/protocol'

const RECONNECT_MS = 3000

/** 이벤트: message(HostMessage), reachable(boolean) */
export class HostClient extends EventEmitter {
  private socket: Socket | null = null
  isReachable = false
  sessions: HostSession[] = []

  start(): void {
    this.connectOnce()
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.destroyed) return false
    this.socket.write(encode(message))
    return true
  }

  private connectOnce(): void {
    const decoder = new LineDecoder()
    const socket = connect(PIPE_PATH)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      this.socket = socket
      this.setReachable(true)
    })
    socket.on('data', (chunk: string) => {
      for (const raw of decoder.push(chunk)) {
        const message = raw as HostMessage
        if (message.type === 'sessions') this.sessions = message.sessions
        this.emit('message', message)
      }
    })
    let isDown = false
    const onDown = () => {
      if (isDown) return
      isDown = true
      if (this.socket === socket) this.socket = null
      this.sessions = []
      this.setReachable(false)
      socket.destroy()
      setTimeout(() => this.connectOnce(), RECONNECT_MS)
    }
    socket.once('error', onDown)
    socket.once('close', onDown)
  }

  private setReachable(value: boolean): void {
    if (this.isReachable === value) return
    this.isReachable = value
    this.emit('reachable', value)
  }
}
