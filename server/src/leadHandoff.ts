import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { isInterruptText } from './interrupt.js'
import { unwrapPastes } from './messages.js'

/**
 * 새 팀장·파트장이 이어받을 직전 지시자의 히스토리 (인계 글).
 * 직전 지시자 jsonl 의 마지막 압축 요약 + 그 뒤 주 대화 차례마다 "사람 지시" 와 "그 차례 마지막 claude 글" 만 남긴다.
 * 도구 호출·도구 결과·사이드체인·메타·`<` 로 시작하는 글(백그라운드 알림·슬래시 명령)·중지 줄·Claude Code 자체 응답은 뺀다 (transcript.ts 의 차례 규칙과 같다).
 * 글은 새 지시자 claude 가 읽는 입력이라 한국어다
 */

/** 인계 글 전체(머리말 포함) 상한. 넘으면 오래된 차례부터 뺀다 */
export const HANDOFF_LIMIT = 40_000
/** 차례 글 하나의 상한. 붙여 넣은 긴 로그 하나가 상한을 다 쓰지 않게 앞부분만 남긴다 */
export const HANDOFF_ITEM_LIMIT = 4_000

/** 사람 지시(human) 또는 그 차례의 마지막 claude 글(lead) */
export interface HandoffItem {
  role: 'human' | 'lead'
  text: string
  /** 이 글을 준 jsonl 줄의 uuid (압축 때 남긴 메시지 preservedMessages 를 고르는 데 쓴다) */
  uuid: string | null
}

export interface HandoffSource {
  /** 마지막 압축 요약 (꼬리의 "Continue the conversation…" 지시는 뗐다). 없으면 null */
  summary: string | null
  /** 요약 뒤(요약이 없으면 처음부터)의 차례 글, 오래된 것 먼저 */
  items: HandoffItem[]
}

/** 지시자 종류: 팀장 또는 파트장 */
export type LeadKind = 'lead' | 'part-lead'

const LEAD_TITLE: Record<LeadKind, string> = { lead: '팀장', 'part-lead': '파트장' }

/** 인계 메시지 첫 줄. 이 꼴로 시작하는 사람 글은 앞선 인계라 다음 인계에서 요약으로 쓴다 */
const HANDOFF_HEAD = /^아래는 이전 (팀장|파트장)\(/

/** Claude Code 요약의 꼬리: 같은 세션이 이어 가라는 지시라 새 지시자에게는 맞지 않는다 */
const SUMMARY_TAIL = '\nContinue the conversation from where it left off'

interface ContentBlock {
  type?: string
  text?: string
}

/** 사람 쪽 user 줄의 글: 문자열 그대로이거나 `<` 로 시작하지 않는 text 블록들. 글이 없으면 null */
function humanText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = (content as ContentBlock[])
    .filter((block) => block.type === 'text' && block.text && !block.text.startsWith('<'))
    .map((block) => block.text as string)
  return texts.length > 0 ? texts.join('\n') : null
}

function summaryTextOf(content: unknown): string {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? (content as ContentBlock[]).map((block) => block.text ?? '').join('\n') : ''
  const tail = text.indexOf(SUMMARY_TAIL)
  return (tail < 0 ? text : text.slice(0, tail)).trim()
}

/** 판정에 쓰는 줄만 JSON.parse 한다 (200MB jsonl 의 대부분은 api-request·도구 결과·첨부 줄이다) */
const RELEVANT_MARKERS = ['"type":"user"', '"type":"assistant"', '"compact_boundary"', '"queued_command"']

/** jsonl 줄을 하나씩 넣어 인계 재료를 모은다 (순수. 파일 읽기는 readHandoffSource) */
export class HandoffCollector {
  private summary: string | null = null
  private items: HandoffItem[] = []
  /** 직전 압축 경계가 남긴 메시지 uuid (다음 요약 줄에서 쓴다) */
  private preserved = new Set<string>()
  /** 지금 차례가 앞선 인계 메시지의 차례면 그 답("인계받음")은 뺀다 */
  private isHandoffTurn = false

  push(line: string): void {
    if (!RELEVANT_MARKERS.some((marker) => line.includes(marker))) return
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      return
    }
    if (record.isSidechain || record.isMeta) return
    const uuid = typeof record.uuid === 'string' ? record.uuid : null
    const message = record.message as { content?: unknown; model?: unknown } | undefined
    if (record.type === 'system' && record.subtype === 'compact_boundary') {
      const uuids = (record.compactMetadata as { preservedMessages?: { uuids?: unknown } } | undefined)?.preservedMessages?.uuids
      this.preserved = new Set(Array.isArray(uuids) ? uuids.filter((id): id is string => typeof id === 'string') : [])
      return
    }
    if (record.type === 'attachment') {
      const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
      if (attachment?.type === 'queued_command') this.pushHuman(humanText(attachment.prompt), uuid)
      return
    }
    if (record.type === 'user') {
      if (record.isCompactSummary === true) {
        this.summary = summaryTextOf(message?.content)
        // 압축 때 요약 대신 그대로 남긴 최근 메시지는 jsonl 에서 경계 앞에 있다
        this.items = this.items.filter((item) => item.uuid !== null && this.preserved.has(item.uuid))
        this.preserved = new Set()
        this.isHandoffTurn = false
        return
      }
      const text = humanText(message?.content)
      if (text === null) return
      // 문자열 글이 `<` 로 시작하면 백그라운드 알림·슬래시 명령이라 차례를 바꾸지 않는다
      if (typeof message?.content === 'string' && text.startsWith('<')) return
      this.pushHuman(text, uuid)
      return
    }
    if (record.type === 'assistant') {
      if (message?.model === '<synthetic>' || this.isHandoffTurn) return
      const blocks = Array.isArray(message?.content) ? (message.content as ContentBlock[]) : []
      const text = blocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => (block.text ?? '').trim())
        .join('\n')
        .trim()
      if (!text) return
      const last = this.items.at(-1)
      // 한 차례의 마지막 글만 남긴다: 바로 앞이 claude 글이면 같은 차례라 바꿔 끼운다
      if (last?.role === 'lead') this.items[this.items.length - 1] = { role: 'lead', text, uuid }
      else this.items.push({ role: 'lead', text, uuid })
    }
  }

  private pushHuman(rawText: string | null, uuid: string | null): void {
    if (rawText === null || rawText.startsWith('<') || isInterruptText(rawText)) return
    const text = unwrapPastes(rawText).trim()
    if (!text) return
    this.isHandoffTurn = false
    if (HANDOFF_HEAD.test(text)) {
      // 압축 없이 이어진 앞선 인계: 그 글이 그 이전 히스토리를 담고 있어 요약으로 쓴다
      this.summary = text
      this.items = []
      this.isHandoffTurn = true
      return
    }
    this.items.push({ role: 'human', text, uuid })
  }

  result(): HandoffSource {
    return { summary: this.summary, items: [...this.items] }
  }
}

/** jsonl 을 줄 단위 스트림으로 읽는다 (큰 팀장 jsonl 은 200MB 를 넘어 한 문자열로 읽지 않는다). 파일이 없거나 못 읽으면 null */
export async function readHandoffSource(path: string): Promise<HandoffSource | null> {
  const collector = new HandoffCollector()
  try {
    const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) collector.push(line)
  } catch {
    return null
  }
  return collector.result()
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…(이하 ${text.length - limit}자 생략)`
}

const ITEM_LABEL: Record<HandoffItem['role'], string> = { human: '[사람]', lead: '[이전 지시자]' }

/**
 * 인계 본문. 요약을 먼저 다 넣고(요약만으로 상한을 넘으면 요약 앞부분만), 남은 자리에 최근 차례부터 거꾸로 채운다.
 * 빠진 앞 차례가 있으면 그 수를 적는다. 요약도 차례도 없으면 null
 */
export function formatHandoff(source: HandoffSource, limit: number): string | null {
  const parts: string[] = []
  if (source.summary) parts.push(`## 압축 요약 (이전 세션이 마지막으로 압축될 때 Claude Code 가 쓴 것)\n\n${clip(source.summary, limit)}`)
  const head = parts.join('')
  const turns: string[] = []
  // 아래 차례 머리줄·생략 안내 자리
  let used = head.length + 100
  for (let index = source.items.length - 1; index >= 0; index--) {
    const item = source.items[index]
    const block = `${ITEM_LABEL[item.role]}\n${clip(item.text, HANDOFF_ITEM_LIMIT)}`
    if (used + block.length + 2 > limit) break
    turns.unshift(block)
    used += block.length + 2
  }
  if (!head && turns.length === 0) return null
  const skipped = source.items.length - turns.length
  if (turns.length > 0) {
    const title = source.summary ? '## 요약 뒤의 대화' : '## 이전 대화'
    const note = skipped > 0 ? ` (상한 때문에 앞 글 ${skipped}개 생략)` : ''
    parts.push(`${title} — 사람 지시와 그 차례의 마지막 답만${note}\n\n${turns.join('\n\n')}`)
  }
  return parts.join('\n\n')
}

/** 새 지시자의 첫 메시지 */
export function handoffMessage(kind: LeadKind, previousName: string, body: string): string {
  const title = LEAD_TITLE[kind]
  return `아래는 이전 ${title}(${previousName}) 세션의 요약이다. 숙지하고 '인계받음' 한 줄로만 답하라\n\n${body}`
}

/** Claude Code 의 프로젝트 폴더 이름: cwd 의 영문·숫자 밖 글자를 `-` 로 (예 `D:\workspace\@private\jk-corp` → `D--workspace--private-jk-corp`) */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** 지시자 jsonl 이 있을 자리 (지시자는 팀·파트 폴더에서 떴으므로 그 폴더의 프로젝트 폴더). 긴 경로의 줄인 이름은 따르지 않는다 */
export function leadTranscriptPath(projectsDir: string, cwd: string, sessionId: string): string {
  return join(projectsDir, projectSlug(cwd), `${sessionId}.jsonl`)
}
