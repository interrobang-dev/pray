import { EventEmitter } from 'node:events'
import { watch } from 'node:fs'
import { basename } from 'node:path'

const DEBOUNCE_MS = 300

/** `~/.claude/projects` 아래 jsonl 변경을 세션 ID 단위로 알린다. 이벤트: change(sessionId) */
export class TranscriptWatcher extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(projectsDir: string) {
    super()
    try {
      watch(projectsDir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.toString().endsWith('.jsonl')) return
        const sessionId = basename(filename.toString(), '.jsonl')
        clearTimeout(this.timers.get(sessionId))
        this.timers.set(
          sessionId,
          setTimeout(() => {
            this.timers.delete(sessionId)
            this.emit('change', sessionId)
          }, DEBOUNCE_MS),
        )
      })
    } catch (error) {
      console.error('transcript watch 실패', error)
    }
  }
}
