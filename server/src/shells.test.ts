import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseShells, readTail, runningShells } from './shells.js'

const TASKS = 'C:\\Users\\me\\AppData\\Local\\Temp\\claude\\D--x\\a56abbde-182b-475e-ab39-c3cf9c7933a7\\tasks'

const jsonl = (...records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

/** 백그라운드 shell 시작 두 줄: claude 의 tool_use 와 Claude Code 의 tool_result (실측 꼴) */
function start(
  toolUseId: string,
  id: string,
  options: { tool?: string; command?: string; description?: string; at?: string; isTimedOut?: boolean } = {},
) {
  const { tool = 'Bash', command = 'npm run dev', description, at = '2026-10-22T01:00:00.000Z', isTimedOut = false } = options
  const input: Record<string, unknown> = { command, ...(description ? { description } : {}) }
  if (!isTimedOut) input.run_in_background = true
  const path = `${TASKS}\\${id}.output`
  const text = isTimedOut
    ? `Command did not complete within its 120s timeout and was moved to the background (ID: ${id}). Output is being written to: ${path}. You will be notified when it completes. `
    : `Command running in background with ID: ${id}. Output is being written to: ${path}. You will be notified when it completes — do not poll that file or sleep while waiting.`
  return [
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: toolUseId, name: tool, input }] } },
    {
      type: 'user',
      timestamp: at,
      message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
      toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id },
    },
  ]
}

function notification(id: string, status: string | null) {
  return [
    '<task-notification>',
    `<task-id>${id}</task-id>`,
    `<output-file>${TASKS}\\${id}.output</output-file>`,
    status ? `<status>${status}</status>` : '',
    `<summary>Background command "x" ${status ?? 'event'}</summary>`,
    '</task-notification>',
  ].join('\n')
}

describe('background shells from jsonl', () => {
  it('a started shell is running with command, description, start time and output path', () => {
    const shells = parseShells(jsonl(...start('t1', 'bx2ec6656', { description: 'Start Vite', at: '2026-10-22T01:02:03.000Z' })))
    expect(shells).toEqual([
      {
        id: 'bx2ec6656',
        command: 'npm run dev',
        description: 'Start Vite',
        startedAt: '2026-10-22T01:02:03.000Z',
        outputPath: `${TASKS}\\bx2ec6656.output`,
        isRunning: true,
      },
    ])
    expect(runningShells(jsonl(...start('t1', 'bx2ec6656')))).toEqual([
      { id: 'bx2ec6656', command: 'npm run dev', description: null, startedAt: '2026-10-22T01:00:00.000Z' },
    ])
  })

  it('ends on a task-notification with a status wherever it is delivered: enqueue, queued_command, user text', () => {
    const records = [
      ...start('t1', 'b1'),
      ...start('t2', 'b2'),
      ...start('t3', 'b3'),
      ...start('t4', 'b4'),
      { type: 'queue-operation', operation: 'enqueue', content: notification('b1', 'completed') },
      { type: 'attachment', attachment: { type: 'queued_command', prompt: notification('b2', 'failed') } },
      { type: 'user', message: { content: notification('b3', 'killed') } },
      { type: 'user', message: { content: [{ type: 'text', text: `앞 글\n${notification('b4', 'stopped')}` }] } },
    ]
    expect(parseShells(jsonl(...records)).map((s) => [s.id, s.isRunning])).toEqual([
      ['b1', false],
      ['b2', false],
      ['b3', false],
      ['b4', false],
    ])
  })

  it('does not end on a status-less monitor event, copies in api-request lines, quotes by claude or sidechains', () => {
    const records = [
      ...start('t1', 'b1'),
      { type: 'user', message: { content: notification('b1', null) } },
      { type: 'api-request-blob', message: { content: [{ type: 'text', text: notification('b1', 'completed') }] } },
      { type: 'attachment', attachment: { type: 'prompt_snapshot', prompt: notification('b1', 'completed') } },
      { type: 'assistant', message: { content: [{ type: 'text', text: notification('b1', 'completed') }] } },
      { type: 'user', isSidechain: true, message: { content: notification('b1', 'completed') } },
    ]
    expect(runningShells(jsonl(...records)).map((s) => s.id)).toEqual(['b1'])
  })

  it('a successful TaskStop ends it (no notification follows), a failed one does not', () => {
    const stop = (toolUseId: string, taskId: string, result: string, isError = false) => [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: toolUseId, name: 'TaskStop', input: { task_id: taskId } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result, ...(isError ? { is_error: true } : {}) }] } },
    ]
    const records = [
      ...start('t1', 'b1'),
      ...start('t2', 'b2'),
      ...start('t3', 'b3'),
      ...stop('s1', 'b1', JSON.stringify({ message: 'Successfully stopped task: b1 (npm run dev)', task_id: 'b1', task_type: 'local_bash' })),
      ...stop('s2', 'b2', 'No task found with ID: b2', true),
      ...stop('s3', 'b3', '<tool_use_error>Task b3 is not running</tool_use_error>'),
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's4', name: 'KillShell', input: { shell_id: 'b3' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's4', content: 'Successfully killed shell: b3' }] } },
    ]
    expect(parseShells(jsonl(...records)).map((s) => [s.id, s.isRunning])).toEqual([
      ['b1', false],
      ['b2', true],
      ['b3', false],
    ])
  })

  it('a process boundary (cost-state) ends every shell started before it', () => {
    const records = [
      ...start('t1', 'b1'),
      { type: 'cost-state' },
      { type: 'last-prompt' },
      { type: 'cost-state' },
      // 다시 뜬 프로세스는 못 받은 알림을 stopped 로 다시 넣는다
      { type: 'queue-operation', operation: 'enqueue', content: notification('b1', 'stopped') },
      ...start('t2', 'b2', { at: '2026-10-22T02:00:00.000Z' }),
    ]
    expect(runningShells(jsonl(...records)).map((s) => s.id)).toEqual(['b2'])
  })

  it('a tool result that arrives after a process boundary does not start a shell', () => {
    const [call, result] = start('t1', 'b1')
    expect(runningShells(jsonl(call, { type: 'cost-state' }, result))).toEqual([])
  })

  it('counts PowerShell and commands moved to the background on timeout, keeps several in start order', () => {
    const records = [
      ...start('t1', 'b1', { tool: 'PowerShell', command: 'Start-Sleep 60' }),
      ...start('t2', 'b2', { isTimedOut: true, command: 'node t.cjs' }),
      ...start('t3', 'b3', { command: 'npx vite' }),
      { type: 'user', message: { content: notification('b2', 'completed') } },
    ]
    const shells = parseShells(jsonl(...records))
    expect(shells.map((s) => [s.id, s.command, s.isRunning])).toEqual([
      ['b1', 'Start-Sleep 60', true],
      ['b2', 'node t.cjs', false],
      ['b3', 'npx vite', true],
    ])
    expect(shells[1].outputPath).toBe(`${TASKS}\\b2.output`)
  })

  it('ignores foreground results, results whose id is not in the text, other tools and broken lines', () => {
    const [call, result] = start('t1', 'b1')
    const records = [
      call,
      // 같은 tool_use 의 결과가 아닌 ID (한 줄에 결과가 여럿일 때 다른 결과의 toolUseResult)
      { ...result, toolUseResult: { backgroundTaskId: 'other99' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'a.txt' }] }, toolUseResult: { stdout: 'a.txt' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Monitor', input: { command: 'tail -f x' } }] } },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'Monitor started with ID: m1' }] },
        toolUseResult: { backgroundTaskId: 'm1' },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'x' }] } },
    ]
    const text = jsonl(...records) + '{ not json\n\n{"type":"assistant","message":{"content":"plain"}}\n'
    expect(parseShells(text)).toEqual([])
  })

  it('leaves the output path null when the result text has no path', () => {
    const [call] = start('t1', 'b1')
    const result = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Command running in background with ID: b1.' }] }] },
      toolUseResult: { backgroundTaskId: 'b1' },
    }
    expect(parseShells(jsonl(call, result))).toMatchObject([{ id: 'b1', outputPath: null, isRunning: true }])
  })
})

describe('output tail', () => {
  const root = mkdtempSync(join(tmpdir(), 'jk-corp-tail-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const file = (name: string, content: string | Buffer) => {
    const path = join(root, name)
    writeFileSync(path, content)
    return path
  }

  it('returns the last lines, strips CRLF and keeps what a terminal shows after CR redraws', async () => {
    const content = 'one\r\ntwo\r\n[1/3]\r[2/3]\r[3/3] done\r\nfour\n'
    const path = file('small.output', content)
    const size = Buffer.byteLength(content)
    expect(await readTail(path, 20)).toEqual({ lines: ['one', 'two', '[3/3] done', 'four'], isTruncated: false, size })
    expect(await readTail(path, 2)).toEqual({ lines: ['[3/3] done', 'four'], isTruncated: true, size })
  })

  it('keeps a last line without a newline, and handles an empty file', async () => {
    expect((await readTail(file('open.output', 'a\nb'), 5)).lines).toEqual(['a', 'b'])
    expect(await readTail(file('empty.output', ''), 5)).toEqual({ lines: [], isTruncated: false, size: 0 })
  })

  it('reads only the end of a big file and drops the cut first line', async () => {
    // 200KB: 64KB 끝 조각만 읽어도 20줄은 넘는다. 한글 3바이트 글자가 조각 경계에 걸려도 깨진 줄은 버려진다
    const lines = Array.from({ length: 4000 }, (_, i) => `줄 ${i} ${'가'.repeat(10)}`)
    const content = lines.join('\n') + '\n'
    const path = file('big.output', content)
    const tail = await readTail(path, 20)
    expect(tail.lines).toEqual(lines.slice(-20))
    expect(tail.isTruncated).toBe(true)
    expect(tail.size).toBe(Buffer.byteLength(content))
  })

  it('stops at 1MB for one huge line and returns its end', async () => {
    const path = file('huge.output', 'x'.repeat(3 * 1024 * 1024) + 'END')
    const tail = await readTail(path, 20)
    expect(tail.lines).toHaveLength(1)
    expect(tail.lines[0].endsWith('END')).toBe(true)
    expect(tail.lines[0].length).toBe(1024 * 1024)
    expect(tail.isTruncated).toBe(true)
  })
})
