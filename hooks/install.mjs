// ~/.claude/settings.json 에 jk-corp http 훅을 추가한다. 기존 훅은 건드리지 않는다.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOOK_URL = 'http://127.0.0.1:4710/api/hook'
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd']

const settingsPath = join(homedir(), '.claude', 'settings.json')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
settings.hooks ??= {}

let addedCount = 0
for (const event of EVENTS) {
  const groups = (settings.hooks[event] ??= [])
  const hasHook = groups.some((group) => group.hooks?.some((hook) => hook.type === 'http' && hook.url === HOOK_URL))
  if (hasHook) continue
  groups.push({ hooks: [{ type: 'http', url: HOOK_URL, timeout: 2 }] })
  addedCount += 1
}

if (addedCount === 0) {
  console.log('이미 설치됨')
} else {
  copyFileSync(settingsPath, `${settingsPath}.bak`)
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`훅 ${addedCount}개 추가 (백업: settings.json.bak)`)
}
