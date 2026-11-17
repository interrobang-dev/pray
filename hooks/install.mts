// ~/.claude/settings.json 에 Pray http 훅을 추가한다. 기존 훅은 건드리지 않는다.
// 서버도 시작할 때와 1분마다 같은 함수로 빠진 훅을 더하므로 보통은 돌릴 일이 없다 (서버를 띄우기 전에 미리 넣을 때).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureHooks } from '../server/src/hookInstall.ts'

const status = ensureHooks(join(homedir(), '.claude', 'settings.json'))
if (status.state === 'ok') console.log('이미 설치됨')
else if (status.state === 'installed') console.log(`훅 ${status.added.length}개 추가 (${status.added.join(', ')}. 원래 파일: settings.json.bak)`)
else {
  console.error(status.message)
  process.exitCode = 1
}
