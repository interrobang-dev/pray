import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

const RESTART_DELAY_MS = 3000
const MAX_RESTARTS_PER_MINUTE = 5

export interface ChildSpec {
  name: string
  cwd: string
  args: string[]
}

/**
 * 호스트·서버 자식 프로세스 하나. 죽으면 3초 뒤 다시 띄우고, 1분에 5번 넘게 죽으면 포기한다.
 * `node --import tsx` 로 단일 프로세스로 띄운다 (tsx CLI 는 자식 node 를 하나 더 만들어 kill 때 고아가 남는다).
 * 이벤트: change(), gaveUp(name)
 */
export class Child extends EventEmitter {
  private process: ChildProcess | null = null
  private isStopping = false
  private restartTimes: number[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly spec: ChildSpec,
    private readonly nodePath: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {
    super()
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null
  }

  start(): void {
    if (this.isRunning) return
    this.isStopping = false
    const child = spawn(this.nodePath, ['--import', 'tsx', 'src/index.ts', ...this.spec.args], {
      cwd: this.spec.cwd,
      env: this.env,
      stdio: 'ignore',
      windowsHide: true,
    })
    this.process = child
    child.once('exit', (code) => {
      this.process = null
      this.emit('change')
      if (this.isStopping || code === 0) return
      const now = Date.now()
      this.restartTimes = this.restartTimes.filter((t) => now - t < 60_000)
      this.restartTimes.push(now)
      if (this.restartTimes.length > MAX_RESTARTS_PER_MINUTE) {
        this.emit('gaveUp', this.spec.name)
        return
      }
      this.timer = setTimeout(() => this.start(), RESTART_DELAY_MS)
    })
    this.emit('change')
  }

  stop(): Promise<void> {
    this.isStopping = true
    if (this.timer) clearTimeout(this.timer)
    const child = this.process
    if (!child || child.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    this.restartTimes = []
    this.start()
  }
}
