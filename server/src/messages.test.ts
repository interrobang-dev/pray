import { describe, expect, it } from 'vitest'
import {
  attachInstructions,
  parseInstructionLog,
  parseMessages,
  queuedPrompts,
  type ChatMessage,
  type InstructionRecord,
} from './messages.js'

const line = (record: unknown) => JSON.stringify(record)

describe('parseMessages', () => {
  it('builds user/assistant turns, merges assistant blocks by message id, attaches tool results', () => {
    const jsonl = [
      line({ type: 'user', uuid: 'u1', timestamp: 't1', message: { role: 'user', content: '안녕' } }),
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't2',
        message: { id: 'm1', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '확인할게요' }] },
      }),
      line({
        type: 'assistant',
        uuid: 'a2',
        timestamp: 't3',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
      }),
      line({
        type: 'user',
        uuid: 'u2',
        timestamp: 't4',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] },
      }),
      line({ type: 'user', uuid: 'u3', timestamp: 't5', isMeta: true, message: { role: 'user', content: 'meta' } }),
      line({ type: 'user', uuid: 'u4', timestamp: 't6', isSidechain: true, message: { role: 'user', content: 'side' } }),
      line({ type: 'user', uuid: 'u5', timestamp: 't7', message: { role: 'user', content: '<local-command-caveat>x' } }),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '안녕'],
      ['assistant', '확인할게요'],
      ['system', '<local-command-caveat>x'],
    ])
    expect(messages[1].toolUses).toEqual([{ id: 'tu1', name: 'Bash', input: { command: 'ls' }, result: 'a.txt' }])
  })

  it('keeps long jk-corp tool results whole and cuts other long results at 2000 chars', () => {
    const longText = 'x'.repeat(5000)
    const jsonl = [
      line({
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'jk', name: 'mcp__jk-corp__jk_wait', input: {} },
            { type: 'tool_use', id: 'bash', name: 'Bash', input: {} },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'u1',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'jk', content: [{ type: 'text', text: longText }] },
            { type: 'tool_result', tool_use_id: 'bash', content: longText },
          ],
        },
      }),
    ].join('\n')

    const [message] = parseMessages(jsonl)
    expect(message.toolUses.map((t) => t.result?.length)).toEqual([5000, 2000])
  })

  it('puts toolUseResult.answers on AskUserQuestion tool uses only', () => {
    const questions = [{ question: '어디서?', header: 'H', options: [{ label: 'main', description: '' }], multiSelect: false }]
    const jsonl = [
      line({
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'ask', name: 'AskUserQuestion', input: { questions } },
            { type: 'tool_use', id: 'ask2', name: 'AskUserQuestion', input: { questions } },
            { type: 'tool_use', id: 'bash', name: 'Bash', input: {} },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'tool_result', tool_use_id: 'ask', content: 'Your questions have been answered: ...' }] },
        toolUseResult: { questions, answers: { '어디서?': 'main', 깨진: 3 }, annotations: {} },
      }),
      line({
        type: 'user',
        uuid: 'u2',
        message: { content: [{ type: 'tool_result', tool_use_id: 'ask2', content: 'User declined', is_error: true }] },
        toolUseResult: 'Error: User declined',
      }),
      line({
        type: 'user',
        uuid: 'u3',
        message: { content: [{ type: 'tool_result', tool_use_id: 'bash', content: 'ok' }] },
        toolUseResult: { answers: { x: 'y' } },
      }),
    ].join('\n')

    const [message] = parseMessages(jsonl)
    expect(message.toolUses.map((t) => t.answers)).toEqual([{ '어디서?': 'main' }, undefined, undefined])
  })

  it('turns the compact summary (a user line) into a system message with the text as is, outside instructions and the queue', () => {
    // 실제 jsonl 의 꼴: compact_boundary system 줄 다음에 isCompactSummary user 줄. 요약 안의 붙여넣기 태그도 풀지 않는다
    const summary = 'This session is being continued from a previous conversation that ran out of context.\n\n<pasted_content id="ab12">\n인용\n</pasted_content id="ab12">\n'
    const jsonl = [
      line({ type: 'user', uuid: 'u1', timestamp: 't1', message: { role: 'user', content: '일 해 줘' } }),
      line({ type: 'queue-operation', operation: 'enqueue', timestamp: 't2', content: '이것도 해 줘' }),
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: 't3', compactMetadata: { trigger: 'auto' } }),
      line({ type: 'user', uuid: 'c1', timestamp: 't4', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: summary } }),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(messages.map((m) => [m.role, m.text, m.isCompactSummary ?? false, m.isQueued ?? false])).toEqual([
      ['user', '일 해 줘', false, false],
      ['system', summary, true, false],
      ['user', '이것도 해 줘', false, true],
    ])
    expect(messages[1]).toMatchObject({ id: 'c1', timestamp: 't4' })
    const record: InstructionRecord = { sessionId: 'member', fromSessionId: 'lead-1', text: summary, at: '' }
    expect(attachInstructions(messages, [record], () => '팀장')[1].from).toBeUndefined()
  })
})

describe('parseMessages: messages sent while claude is working', () => {
  // 실제 jsonl 의 꼴: 보낼 때 enqueue (uuid 없음), 받아들일 때 remove + queued_command 첨부 (첨부의 timestamp 는 보낸 시각)
  const enqueue = (content: string | undefined, timestamp = 't-enq') =>
    line({ type: 'queue-operation', operation: 'enqueue', timestamp, sessionId: 's', ...(content !== undefined && { content }) })
  const remove = (content: string, reason = 'absorbed_mid_turn') =>
    line({ type: 'queue-operation', operation: 'remove', timestamp: 't-rm', sessionId: 's', content, reason, commandUuid: 'c', deliveryId: 'd' })
  const dequeue = () => line({ type: 'queue-operation', operation: 'dequeue', timestamp: 't-deq', sessionId: 's' })
  const queuedCommand = (uuid: string, prompt: unknown, commandMode = 'prompt') =>
    line({
      parentUuid: 'p',
      isSidechain: false,
      type: 'attachment',
      uuid,
      timestamp: 't-sent',
      attachment: { type: 'queued_command', prompt, source_uuid: 'c', commandMode, origin: { kind: 'human' }, timestamp: 't-sent', humanTurn: true },
    })
  const assistant = (uuid: string, text: string) =>
    line({ type: 'assistant', uuid, timestamp: 't', message: { id: `m-${uuid}`, content: [{ type: 'text', text }] } })
  const user = (uuid: string, content: string) => line({ type: 'user', uuid, timestamp: 't', message: { role: 'user', content } })
  const view = (messages: ChatMessage[]) => messages.map((m) => [m.role, m.text, m.isQueued ?? false])

  it('puts an absorbed message where its queued_command attachment is, as user (task notifications as system)', () => {
    const jsonl = [
      user('u1', '일 해 줘'),
      enqueue('스크롤 고쳐 줘'),
      assistant('a1', '작업 중'),
      remove('스크롤 고쳐 줘'),
      queuedCommand('q1', '스크롤 고쳐 줘'),
      enqueue('<task-notification>\n<task-id>b1</task-id>'),
      remove('<task-notification>\n<task-id>b1</task-id>'),
      queuedCommand('q2', '<task-notification>\n<task-id>b1</task-id>', 'task-notification'),
      queuedCommand('q3', [{ type: 'image' }, { type: 'text', text: '그림 보고 고쳐' }]),
      assistant('a2', '반영함'),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(view(messages)).toEqual([
      ['user', '일 해 줘', false],
      ['assistant', '작업 중', false],
      ['user', '스크롤 고쳐 줘', false],
      ['system', '<task-notification>\n<task-id>b1</task-id>', false],
      ['user', '그림 보고 고쳐', false],
      ['assistant', '반영함', false],
    ])
    expect(messages[2]).toMatchObject({ id: 'q1', timestamp: 't-sent' })
  })

  it('appends messages still in the queue at the end with isQueued and a line-based id', () => {
    const jsonl = [user('u1', '일 해 줘'), enqueue('이것도 해 줘', 't-queued'), enqueue(undefined), assistant('a1', '작업 중')].join('\n')

    const messages = parseMessages(jsonl)
    expect(view(messages)).toEqual([
      ['user', '일 해 줘', false],
      ['assistant', '작업 중', false],
      ['user', '이것도 해 줘', true],
    ])
    expect(messages[2]).toMatchObject({ id: 'queued-1', timestamp: 't-queued' })
  })

  it('shows nothing for a message removed without an attachment (cancelled)', () => {
    const jsonl = [user('u1', '일 해 줘'), enqueue('취소할 말'), remove('취소할 말', 'cleared_on_cancel'), assistant('a1', '중단함')].join('\n')

    expect(view(parseMessages(jsonl))).toEqual([
      ['user', '일 해 줘', false],
      ['assistant', '중단함', false],
    ])
  })

  it('pairs the same text sent twice in order: one absorbed, one still queued', () => {
    const jsonl = [enqueue('진행'), enqueue('진행'), remove('진행'), queuedCommand('q1', '진행'), assistant('a1', '진행 중')].join('\n')

    const messages = parseMessages(jsonl)
    expect(view(messages)).toEqual([
      ['user', '진행', false],
      ['assistant', '진행 중', false],
      ['user', '진행', true],
    ])
    expect(messages[2].id).toBe('queued-1')
    expect(view(parseMessages([enqueue('진행'), enqueue('진행')].join('\n')))).toEqual([
      ['user', '진행', true],
      ['user', '진행', true],
    ])
    expect(parseMessages([enqueue('진행'), enqueue('진행')].join('\n')).map((m) => m.id)).toEqual(['queued-0', 'queued-1'])
  })

  it('takes popAll (↑ pulled them into the prompt box) out of the queue, and shows the ones entered again at the end', () => {
    // 실제 jsonl 의 꼴 (Claude Code 2.1.306): 꺼낸 것마다 popAll 한 줄 (reason 없음), 다시 넣으면 새 enqueue
    const popAll = (content: string) => line({ type: 'queue-operation', operation: 'popAll', timestamp: 't-pop', sessionId: 's', content })
    const jsonl = [
      user('u1', '일 해 줘'),
      enqueue('대기1', 't1'),
      enqueue('대기2', 't2'),
      enqueue('대기3', 't3'),
      popAll('대기1'),
      popAll('대기2'),
      popAll('대기3'),
      enqueue('대기1', 't4'),
      enqueue('대기2', 't5'),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(view(messages)).toEqual([
      ['user', '일 해 줘', false],
      ['user', '대기1', true],
      ['user', '대기2', true],
    ])
    expect(messages.slice(1).map((m) => [m.id, m.timestamp])).toEqual([
      ['queued-7', 't4'],
      ['queued-8', 't5'],
    ])
  })

  it('takes popOne like remove: the first queued message with the same text', () => {
    const popOne = (content: string) => line({ type: 'queue-operation', operation: 'popOne', timestamp: 't-pop', sessionId: 's', content })
    const jsonl = [enqueue('같은 말', 't1'), enqueue('다른 말', 't2'), enqueue('같은 말', 't3'), popOne('같은 말')].join('\n')

    const messages = parseMessages(jsonl)
    expect(view(messages)).toEqual([
      ['user', '다른 말', true],
      ['user', '같은 말', true],
    ])
    expect(messages.map((m) => m.id)).toEqual(['queued-1', 'queued-2'])
  })

  it('takes a dequeue (delivered after the turn, no content) from the front of the queue', () => {
    // 차례가 끝난 뒤 전달되면 remove 가 아니라 글 없는 dequeue 와 일반 user 줄이 남는다
    const jsonl = [enqueue(undefined), enqueue('<task-notification>\n<task-id>b2</task-id>'), enqueue('다음 일'), dequeue(), dequeue(), user('u1', '<task-notification>\n<task-id>b2</task-id>')].join('\n')

    expect(view(parseMessages(jsonl))).toEqual([
      ['system', '<task-notification>\n<task-id>b2</task-id>', false],
      ['user', '다음 일', true],
    ])
  })

  it('starts the queue over where a claude process left the session (cost-state): what it left queued is not queued', () => {
    // 실제 jsonl 의 꼴 (Claude Code 2.1.306 → 2.1.307, 호스트 재시작): 죽기 직전에 넣은 알림·말은 dequeue 가 없고,
    // 나가며 cost-state · last-prompt · cost-state 를 남긴다. 다시 뜬 프로세스는 못 받은 알림을 stopped 알림으로 새로 넣고 꺼낸다
    const costState = line({ type: 'cost-state', sessionId: 's', totalCostUSD: 1 })
    const completed = '<task-notification>\n<task-id>b4</task-id>\n<status>completed</status>\n</task-notification>'
    const stopped = '<task-notification>\n<task-id>b4</task-id>\n<status>stopped</status>\n</task-notification>'
    const jsonl = [
      user('u1', '재시작 진행'),
      enqueue(completed),
      enqueue('못 받은 말'),
      costState,
      line({ type: 'last-prompt', lastPrompt: '재시작 진행', sessionId: 's' }),
      costState,
      enqueue(stopped),
      dequeue(),
      assistant('a1', 'No response requested.'),
      user('u2', stopped),
      enqueue('다음 일'),
      dequeue(),
      user('u3', '다음 일'),
    ].join('\n')

    expect(view(parseMessages(jsonl))).toEqual([
      ['user', '재시작 진행', false],
      ['assistant', 'No response requested.', false],
      ['system', stopped, false],
      ['user', '다음 일', false],
    ])
    expect(queuedPrompts(jsonl)).toEqual([])
  })

  it('takes a dequeue by the text claude received right after it, so a leftover without cost-state does not shift later ones', () => {
    // 강제 종료로 cost-state 없이 남은 것은 알 수 없어 그대로 남지만, 그 뒤 dequeue 가 한 칸씩 밀려 받은 말이 대기 중으로 보이지는 않는다
    const jsonl = [
      enqueue('남은 말', 't1'),
      enqueue('다음 일', 't2'),
      dequeue(),
      user('u1', '다음 일'),
      enqueue('또 다른 일', 't3'),
      dequeue(),
      user('u2', '또 다른 일'),
      enqueue('대기 중인 말', 't4'),
    ].join('\n')

    expect(view(parseMessages(jsonl))).toEqual([
      ['user', '다음 일', false],
      ['user', '또 다른 일', false],
      ['user', '남은 말', true],
      ['user', '대기 중인 말', true],
    ])
    expect(queuedPrompts(jsonl).map((prompt) => prompt.text)).toEqual(['남은 말', '대기 중인 말'])
    // 뒤에 같은 글이 없으면(슬래시 명령·글 없는 enqueue) 맨 앞을 뺀다
    const command = [enqueue(undefined), enqueue('대기 중인 말'), dequeue(), user('u1', '<command-name>/ledger</command-name>')].join('\n')
    expect(queuedPrompts(command)).toEqual([{ raw: '대기 중인 말', text: '대기 중인 말' }])
  })

  it('queuedPrompts: the queued user messages in order, raw content and unwrapped text, without content-less or system ones', () => {
    const pasted = '\n\n<pasted_content id="ab12">\n긴 지시\n</pasted_content id="ab12">\n'
    const jsonl = [
      enqueue('먼저 온 말'),
      enqueue(undefined),
      enqueue('<task-notification>\n<task-id>b3</task-id>'),
      enqueue(pasted),
      enqueue('받아들여진 말'),
      remove('받아들여진 말'),
      line({ type: 'queue-operation', operation: 'popAll', sessionId: 's', content: '먼저 온 말' }),
      enqueue('먼저 온 말'),
    ].join('\n')

    expect(queuedPrompts(jsonl)).toEqual([
      { raw: pasted, text: '긴 지시' },
      { raw: '먼저 온 말', text: '먼저 온 말' },
    ])
    expect(queuedPrompts('')).toEqual([])
  })
})

describe('parseMessages: pasted input', () => {
  const open = (id: string) => `<pasted_content id="${id}">`
  const close = (id: string) => `</pasted_content id="${id}">`
  const textOf = (content: string) => parseMessages(line({ type: 'user', uuid: 'u1', message: { role: 'user', content } }))[0]

  it('restores the sent text exactly, dropping only the newlines added around the tags', () => {
    // 한 조각을 통째로 감싼 꼴 (실제 jsonl: 앞 "\n\n", 태그 안쪽 "\n", 끝 "\n")
    expect(textOf(`\n\n${open('8184')}\n첫 문단.\n\n둘째 문단.\n${close('8184')}\n`).text).toBe('첫 문단.\n\n둘째 문단.')
    // 4096바이트 조각 경계가 낱말 중간("열거|나")이고 나머지는 태그 밖에 남은 꼴
    expect(textOf(`\n\n${open('d70d')}\n금지: 설정 파일은 열거\n${close('d70d')}\n\n나 출력하지 마라.`).text).toBe('금지: 설정 파일은 열거나 출력하지 마라.')
    // 태그 앞에 직접 친 글이 있는 꼴, 조각 둘이 각각 감싸진 꼴
    expect(textOf(`아래를 보고 해 줘. \n\n${open('f63e')}\n붙인 글\n${close('f63e')}\n`).text).toBe('아래를 보고 해 줘. 붙인 글')
    expect(textOf(`\n\n${open('8989')}\n앞 조각\n${close('8989')}\n\n\n${open('8989')}\n뒤 조각\n${close('8989')}\n`).text).toBe('앞 조각뒤 조각')
  })

  it('keeps newlines that belong to the text next to the tags', () => {
    // 글이 빈 줄로 시작·끝나고 태그 뒤 글도 줄바꿈으로 시작 → 감싼 줄바꿈 바깥은 남는다
    expect(textOf(`\n\n\n${open('ab12')}\n\n가운데\n\n${close('ab12')}\n\n\n끝`).text).toBe('\n\n가운데\n\n끝')
  })

  it('decides system by the stored text and leaves look-alike tags alone', () => {
    expect(textOf(`\n\n${open('ab12')}\n<div>붙인 HTML</div>\n${close('ab12')}\n`)).toMatchObject({ role: 'user', text: '<div>붙인 HTML</div>' })
    const lookAlike = `${open('not-hex')}\n글\n${close('not-hex')}`
    expect(textOf(`설명: ${lookAlike}`).text).toBe(`설명: ${lookAlike}`)
    expect(textOf(`설명: ${open('ab12')}\n닫는 태그 없음`).text).toBe(`설명: ${open('ab12')}\n닫는 태그 없음`)
  })

  it('unwraps absorbed and queued messages too, and attachInstructions still matches the unwrapped text', () => {
    const stored = `\n\n${open('ab12')}\n지시 앞부분\n${close('ab12')}\n\n이어진 뒷부분`
    const jsonl = [
      line({ type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt: stored, commandMode: 'prompt' } }),
      line({ type: 'queue-operation', operation: 'enqueue', timestamp: 't', content: stored }),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(messages.map((m) => m.text)).toEqual(['지시 앞부분이어진 뒷부분', '지시 앞부분이어진 뒷부분'])
    const record: InstructionRecord = { sessionId: 'member', fromSessionId: 'lead-1', text: '지시 앞부분이어진 뒷부분', at: '' }
    expect(attachInstructions(messages, [record], () => '팀장')[0].from).toEqual({ sessionId: 'lead-1', name: '팀장' })
  })
})

describe('parseInstructionLog', () => {
  it('keeps only well-formed records of the session and skips broken lines', () => {
    const log = [
      line({ sessionId: 's1', fromSessionId: 'lead', text: '지시 A', at: 't1' }),
      '{깨진 줄',
      'null',
      line({ sessionId: 's2', fromSessionId: 'lead', text: '다른 팀원', at: 't2' }),
      line({ sessionId: 's1', fromSessionId: null, at: 't3' }),
      line({ sessionId: 's1', fromSessionId: null, text: '지시자 없음', at: 't4' }),
      '',
    ].join('\n')

    expect(parseInstructionLog(log, 's1')).toEqual([
      { sessionId: 's1', fromSessionId: 'lead', text: '지시 A', at: 't1' },
      { sessionId: 's1', fromSessionId: null, text: '지시자 없음', at: 't4' },
    ])
  })
})

describe('attachInstructions', () => {
  const message = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
    id,
    role,
    timestamp: '',
    text,
    toolUses: [],
  })
  const record = (text: string, fromSessionId: string | null = 'lead-1'): InstructionRecord => ({
    sessionId: 'member',
    fromSessionId,
    text,
    at: '',
  })
  const nameOf = (sessionId: string | null) => (sessionId ? `이름:${sessionId}` : '지시자 없음')

  it('matches the stored paste form (tags, 4096-byte chunk breaks inside a word) and restores the sent text', () => {
    const sent = '배경: 첫 문단.\n\n금지: 설정 파일은 열거나 출력하지 마라.'
    // Claude Code 가 jsonl 에 남기는 꼴: 붙여넣기 조각을 태그로 감싸고 조각 경계("열거|나")에 줄바꿈을 넣는다
    const stored = '\n\n<pasted_content id="d70d">\n배경: 첫 문단.\n\n금지: 설정 파일은 열거\n</pasted_content id="d70d">\n\n나 출력하지 마라.'
    const [attached] = attachInstructions([message('u1', 'user', stored)], [record(sent)], nameOf)

    expect(attached.text).toBe(sent)
    expect(attached.from).toEqual({ sessionId: 'lead-1', name: '이름:lead-1' })
  })

  it('ignores CRLF and surrounding whitespace differences', () => {
    const [attached] = attachInstructions([message('u1', 'user', '  첫 줄\n둘째 줄\n')], [record('첫 줄\r\n둘째 줄')], nameOf)
    expect(attached.from?.name).toBe('이름:lead-1')
  })

  it('leaves human and assistant messages alone and uses each record once', () => {
    const messages = [
      message('u1', 'user', '사람이 쓴 말'),
      message('a1', 'assistant', '같은 지시'),
      message('u2', 'user', '같은 지시'),
      message('u3', 'user', '같은 지시'),
    ]
    const attached = attachInstructions(messages, [record('같은 지시', null)], nameOf)

    expect(attached.map((m) => m.from ?? null)).toEqual([null, null, { sessionId: null, name: '지시자 없음' }, null])
    expect(attached[0]).toBe(messages[0])
  })
})
