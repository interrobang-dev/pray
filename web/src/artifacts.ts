import type { ChatMessage, ToolUse } from './types'

/**
 * 세션이 만든 claude.ai Artifact 알아보기. 순수 함수. 길이 둘이다:
 * - Claude Code 의 `Artifact` 도구 (HTML 페이지를 올리거나 연다)
 * - Claude Docs 커넥터 (`mcp__<서버>Claude_Docs__batch` 의 `container.create` 로 문서를 만든다. 문서도 claude.ai/artifact 주소다)
 * 대화 탭은 올리기·열기·문서 만들기 호출을 작업 묶음에 넣지 않고 카드로 두고, 세션 패널 버튼은 이 세션이 다룬 것을 모아 보인다.
 * 주소는 서버가 결과 전문에서 찾아 준 `artifactUrl`(결과 글은 2000자에서 잘린다) → 결과 글 → 입력에서 찾는다
 */

export const ARTIFACT_TOOL = 'Artifact'

/** claude.ai/artifact/{id} · claude.ai/code/artifact/{uuid} (서버 messages.ts 와 같은 꼴) */
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/

/** Claude Docs 커넥터의 도구 이름 (`mcp__claude_ai_Claude_Docs__read` → `read`). 아니면 null */
export function docsToolOf(name: string): string | null {
  return name.match(/^mcp__.*Claude_Docs__(\w+)$/)?.[1] ?? null
}

/** publish·open = Artifact 도구, create = Claude Docs 로 문서 만들기 */
export type ArtifactAction = 'publish' | 'open' | 'create'

export interface ArtifactRef {
  toolId: string
  action: ArtifactAction
  /** 결과(없으면 입력 url)에서 찾은 주소. 아직 결과가 없거나 결과에 주소가 없으면 null */
  url: string | null
  /** 입력 title → 올린 파일 이름·문서 이름 → null (화면이 주소·"Artifact" 로 채운다) */
  title: string | null
  description: string | null
  /** running = 결과 전, done = 됐음 (옛 서버의 잘린 문서 결과면 주소가 null 일 수 있다), failed = 거절·오류 */
  state: 'running' | 'done' | 'failed'
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** 이 도구 호출의 결과에서 찾은 Artifact 주소 (서버가 전문에서 찾은 것 먼저) */
function resultUrlOf(toolUse: ToolUse): string | null {
  return toolUse.artifactUrl ?? toolUse.result?.match(ARTIFACT_URL)?.[0] ?? null
}

/** Claude Docs 결과가 받아들여졌는지 (`{"verdict":"allow"…`) */
function isDocsAllowed(result: string): boolean {
  return /^\s*\{\s*"verdict"\s*:\s*"allow"/.test(result)
}

/** Claude Docs 로 문서를 만드는 호출(`batch` + `container.create`)이면 카드 정보 */
function docsCreateOf(toolUse: ToolUse): ArtifactRef | null {
  if (docsToolOf(toolUse.name) !== 'batch') return null
  const create = objectOf(objectOf(objectOf(toolUse.input).container).create)
  if (Object.keys(create).length === 0) return null
  const url = resultUrlOf(toolUse)
  return {
    toolId: toolUse.id,
    action: 'create',
    url,
    title: stringField(create, 'name'),
    description: null,
    state: toolUse.result === null ? 'running' : url || isDocsAllowed(toolUse.result) ? 'done' : 'failed',
  }
}

/** Claude Docs 읽기 결과 맨 앞의 문서 이름 (`{"verdict":"allow","value":{"name":"…"`). 없으면 null */
function docsNameOf(result: string): string | null {
  const raw = result.match(/^\s*\{"verdict":"allow","value":\{"name":"((?:[^"\\]|\\.)*)"/)?.[1]
  if (raw === undefined) return null
  try {
    return (JSON.parse(`"${raw}"`) as string).trim() || null
  } catch {
    return null
  }
}

/**
 * 카드로 보일 호출이면 그 정보, 아니면 null. Artifact 도구는 페이지를 올리거나(publish, action 을 안 주면 publish) 여는(open) 것만 —
 * 읽기·목록·지우기·고정·asset 올리기(`asset: true`)·quickstart 는 작업 묶음에 그대로 둔다. Claude Docs 는 문서 만들기만
 * (읽기·고치기는 한 문서에 수십 번이라 묶음에 두고 세션 목록에만 든다)
 */
export function artifactOf(toolUse: ToolUse): ArtifactRef | null {
  if (toolUse.name !== ARTIFACT_TOOL) return docsCreateOf(toolUse)
  const input = objectOf(toolUse.input)
  const rawAction = stringField(input, 'action') ?? 'publish'
  if (rawAction !== 'publish' && rawAction !== 'open') return null
  if (input.asset === true) return null
  const filePath = stringField(input, 'file_path')
  const inputUrl = stringField(input, 'url')
  const resultUrl = resultUrlOf(toolUse)
  const url = resultUrl ?? (toolUse.result !== null ? (inputUrl?.match(ARTIFACT_URL)?.[0] ?? null) : null)
  return {
    toolId: toolUse.id,
    action: rawAction,
    url,
    title: stringField(input, 'title') ?? (filePath ? fileNameOf(filePath) : null),
    description: stringField(input, 'description'),
    state: toolUse.result === null ? 'running' : url ? 'done' : 'failed',
  }
}

/** 세션 패널 목록의 한 줄 = 주소 하나 */
export interface SessionArtifact {
  url: string
  title: string | null
  description: string | null
  /** 이 주소를 마지막으로 다룬 시각 (올리기·열기·문서 만들기·읽기) */
  at: string
  /** 대화에서 갈 카드의 도구 호출 (가장 최근 카드). 카드가 없으면 null — 다른 세션이 만든 문서를 읽고 고치기만 한 경우 */
  cardToolId: string | null
}

/**
 * 이 세션이 다룬 Artifact, 주소마다 하나씩 최근순: 카드가 되는 호출(올리기·열기·문서 만들기)과, 결과에 주소가 있는 Claude Docs 호출
 * (읽기 등 — 다른 세션이 만든 문서를 이어 고치는 세션에도 목록이 뜨게). 제목·설명은 그 주소의 가장 최근 올리기·만들기 것,
 * 없으면 Docs 읽기 결과의 문서 이름 (open 은 제목이 없다)
 */
export function sessionArtifacts(messages: readonly ChatMessage[]): SessionArtifact[] {
  const byUrl = new Map<string, SessionArtifact>()
  for (const message of messages) {
    for (const toolUse of message.toolUses) {
      const ref = artifactOf(toolUse)
      const url = ref ? ref.url : docsToolOf(toolUse.name) ? resultUrlOf(toolUse) : null
      if (!url) continue
      const previous = byUrl.get(url)
      const isNamed = ref !== null && ref.action !== 'open'
      const readName = ref === null && toolUse.result ? docsNameOf(toolUse.result) : null
      byUrl.set(url, {
        url,
        title: (isNamed ? ref.title : null) ?? previous?.title ?? readName ?? ref?.title ?? null,
        description: (isNamed ? ref.description : null) ?? previous?.description ?? null,
        at: message.timestamp,
        cardToolId: ref?.toolId ?? previous?.cardToolId ?? null,
      })
    }
  }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** 주소 → 제목 (제목 없는 열기 카드에 같은 세션이 만든·읽은 문서 이름을 붙이려고) */
export function artifactTitles(messages: readonly ChatMessage[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const artifact of sessionArtifacts(messages)) if (artifact.title) titles.set(artifact.url, artifact.title)
  return titles
}

/** 화면에 쓸 이름: 제목 → 주소 끝 ID 앞 8자리 */
export function artifactLabel(artifact: { title: string | null; url: string | null }): string {
  if (artifact.title) return artifact.title
  const id = artifact.url?.split('/').at(-1)
  return id ? `Artifact ${id.slice(0, 8)}` : 'Artifact'
}
