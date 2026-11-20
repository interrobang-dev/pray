import { describe, expect, it } from 'vitest'
import { artifactLabel, artifactOf, artifactTitles, deletedArtifacts, sessionArtifacts } from './artifacts'
import type { ChatMessage, ToolUse } from './types'

const URL_A = 'https://claude.ai/code/artifact/3f2b9c1e-1111-2222-3333-444455556666'
const URL_B = 'https://claude.ai/artifact/Dpb46hR8bjS7L6jPH5Xmty'

function tool(input: unknown, result: string | null, id = 'toolu_1'): ToolUse {
  return { id, name: 'Artifact', input, result }
}

function message(timestamp: string, toolUses: ToolUse[]): ChatMessage {
  return { id: `m-${timestamp}`, role: 'assistant', timestamp, text: '', toolUses }
}

describe('artifactOf', () => {
  it('reads a publish with the link from the result and the file name as title', () => {
    const ref = artifactOf(tool({ file_path: 'C:\\tmp\\scratch\\report.html', description: 'Weekly numbers' }, `Published ${URL_A} (private).`))
    expect(ref).toEqual({ toolId: 'toolu_1', action: 'publish', url: URL_A, title: 'report.html', description: 'Weekly numbers', state: 'done' })
  })

  it('prefers the given title, and reads open calls', () => {
    expect(artifactOf(tool({ file_path: 'a/b.html', title: 'Sales board' }, URL_A))?.title).toBe('Sales board')
    const open = artifactOf(tool({ action: 'open', url: URL_B }, `Opened the Artifact at ${URL_B} for the user.`))
    expect(open).toMatchObject({ action: 'open', url: URL_B, title: null, state: 'done' })
  })

  it('is running before the result and failed when the result has no link', () => {
    expect(artifactOf(tool({ file_path: 'a.html' }, null))).toMatchObject({ url: null, state: 'running' })
    expect(artifactOf(tool({ file_path: 'a.html' }, 'Publish refused: page imitates a real organization'))).toMatchObject({ url: null, state: 'failed' })
  })

  it('falls back to the input url once a result came (updating an artifact in place)', () => {
    expect(artifactOf(tool({ file_path: 'a.html', url: URL_A }, 'Updated.'))).toMatchObject({ url: URL_A, state: 'done' })
    expect(artifactOf(tool({ file_path: 'a.html', url: URL_A }, null))).toMatchObject({ url: null, state: 'running' })
  })

  it('leaves other actions, asset uploads and other tools to the work group', () => {
    for (const action of ['read', 'list', 'delete', 'pin', 'quickstart']) expect(artifactOf(tool({ action, url: URL_A }, URL_A))).toBeNull()
    expect(artifactOf(tool({ url: URL_A, file_path: 'logo.png', asset: true }, URL_A))).toBeNull()
    expect(artifactOf({ id: 'x', name: 'Write', input: { file_path: 'a.html' }, result: URL_A })).toBeNull()
  })
})

describe('sessionArtifacts', () => {
  it('lists each link once, newest first, keeping the publish title over a later open', () => {
    const list = sessionArtifacts([
      message('2026-11-17T01:00:00Z', [tool({ file_path: 'x/board.html', title: 'Board' }, URL_A, 't1')]),
      message('2026-11-17T02:00:00Z', [tool({ file_path: 'x/notes.html' }, URL_B, 't2')]),
      message('2026-11-17T03:00:00Z', [tool({ action: 'open', url: URL_A }, `Opened ${URL_A}`, 't3')]),
      message('2026-11-17T04:00:00Z', [tool({ file_path: 'x/fail.html' }, 'refused', 't4')]),
    ])
    expect(list.map((item) => [item.url, item.title, item.cardToolId])).toEqual([
      [URL_A, 'Board', 't3'],
      [URL_B, 'notes.html', 't2'],
    ])
  })

  it('keeps one row for republishes to the same link, with the latest title', () => {
    const list = sessionArtifacts([
      message('2026-11-17T01:00:00Z', [tool({ file_path: 'v1.html' }, URL_A, 't1')]),
      message('2026-11-17T02:00:00Z', [tool({ file_path: 'v2.html', url: URL_A }, `Updated ${URL_A}`, 't2')]),
    ])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: 'v2.html', cardToolId: 't2', deletedAt: null })
  })
})

describe('deletedArtifacts', () => {
  const published = message('2026-11-17T01:00:00Z', [tool({ file_path: 'board.html' }, URL_A, 't1'), tool({ file_path: 'notes.html' }, URL_B, 't2')])

  it('marks a link this session deleted, and the list row with the time', () => {
    const deleting = message('2026-11-17T02:00:00Z', [tool({ action: 'delete', url: URL_A }, 'Deleted.', 't3')])
    expect([...deletedArtifacts([published, deleting])]).toEqual([[URL_A, '2026-11-17T02:00:00Z']])
    expect(sessionArtifacts([published, deleting]).map((item) => [item.url, item.deletedAt])).toEqual([
      [URL_A, '2026-11-17T02:00:00Z'],
      [URL_B, null],
    ])
  })

  it('ignores refused or failed deletes, deletes still running and asset deletes', () => {
    const tries = message('2026-11-17T02:00:00Z', [
      { ...tool({ action: 'delete', url: URL_A }, 'The user declined.', 't3'), isError: true },
      tool({ action: 'delete', url: URL_A }, null, 't4'),
      tool({ action: 'delete', url: URL_A, path: '0123456789abcdef0123456789abcdef' }, 'Removed the asset.', 't5'),
      tool({ action: 'delete', url: 'https://example.com/x' }, 'Deleted.', 't6'),
    ])
    expect(deletedArtifacts([published, tries]).size).toBe(0)
  })

  it('treats publishing to the link again after the delete as live', () => {
    const deleting = message('2026-11-17T02:00:00Z', [tool({ action: 'delete', url: URL_A }, 'Deleted.', 't3')])
    const again = message('2026-11-17T03:00:00Z', [tool({ file_path: 'board.html', url: URL_A }, `Updated ${URL_A}`, 't4')])
    expect(deletedArtifacts([published, deleting, again]).size).toBe(0)
  })

  it('shows links marked deleted in Pray, with the session delete winning', () => {
    const deleting = message('2026-11-17T02:00:00Z', [tool({ action: 'delete', url: URL_A }, 'Deleted.', 't3')])
    const marked = new Map([
      [URL_A, '2026-11-18T00:00:00Z'],
      [URL_B, '2026-11-18T01:00:00Z'],
    ])
    expect(sessionArtifacts([published, deleting], marked).map((item) => [item.url, item.deletedAt, item.isMarkedDeleted])).toEqual([
      [URL_A, '2026-11-17T02:00:00Z', false],
      [URL_B, '2026-11-18T01:00:00Z', true],
    ])
  })
})

describe('Claude Docs connector', () => {
  const DOCS = 'mcp__claude_ai_Claude_Docs__'
  const docs = (name: string, input: unknown, result: string | null, id: string, artifactUrl?: string): ToolUse => ({ id, name: DOCS + name, input, result, ...(artifactUrl ? { artifactUrl } : {}) })
  const create = { container: { kind: 'project', create: { name: '교체 가이드', doc: {} } }, batch: [] }

  it('shows creating a doc as a card, with the link the server found past the cut', () => {
    expect(artifactOf(docs('batch', create, '{"verdict":"allow","acks":[…cut', 'd1', URL_B))).toEqual({
      toolId: 'd1',
      action: 'create',
      url: URL_B,
      title: '교체 가이드',
      description: null,
      state: 'done',
    })
    expect(artifactOf(docs('batch', create, null, 'd1'))).toMatchObject({ url: null, state: 'running' })
  })

  it('is done without a link on an old server (result cut before the link), failed when refused', () => {
    expect(artifactOf(docs('batch', create, '{"verdict":"allow","acks":[…cut', 'd1'))).toMatchObject({ url: null, state: 'done' })
    expect(artifactOf(docs('batch', create, '{"verdict":"deny","code":"quota"}', 'd1'))).toMatchObject({ url: null, state: 'failed' })
  })

  it('leaves edits and reads in the work group', () => {
    expect(artifactOf(docs('batch', { container: { kind: 'project', id: 'x' }, batch: [] }, URL_B, 'd2'))).toBeNull()
    expect(artifactOf(docs('update', { ref: {} }, URL_B, 'd3'))).toBeNull()
    expect(artifactOf(docs('read', { ref: {} }, URL_B, 'd4'))).toBeNull()
  })

  it('lists a doc this session only read, named from the read result, without a card to jump to', () => {
    const list = sessionArtifacts([
      message('2026-11-17T06:08:00Z', [docs('read', { ref: { object: 'project' } }, '{"verdict":"allow","value":{"name":"교체 \\"가이드\\"","artifact":{…cut', 'r1', URL_B)]),
      message('2026-11-17T06:12:00Z', [docs('update', { ref: {} }, '{"verdict":"allow","rev":27}', 'u1')]),
      message('2026-11-17T06:16:00Z', [docs('read', { ref: {} }, `{"verdict":"allow","frame":{"url":"${URL_B}"}}`, 'r2')]),
    ])
    expect(list).toEqual([{ url: URL_B, title: '교체 "가이드"', description: null, at: '2026-11-17T06:16:00Z', cardToolId: null, deletedAt: null, isMarkedDeleted: false }])
  })

  it('names the open card of a doc created in the same session', () => {
    const messages = [
      message('2026-11-17T05:51:45Z', [docs('batch', create, '{"verdict":"allow"…', 'd1', URL_B)]),
      message('2026-11-17T05:51:50Z', [tool({ action: 'open', url: URL_B }, `Opened the Artifact at ${URL_B} for the user.`, 'o1')]),
    ]
    expect(artifactTitles(messages).get(URL_B)).toBe('교체 가이드')
    expect(sessionArtifacts(messages)).toEqual([{ url: URL_B, title: '교체 가이드', description: null, at: '2026-11-17T05:51:50Z', cardToolId: 'o1', deletedAt: null, isMarkedDeleted: false }])
  })
})

describe('artifactLabel', () => {
  it('uses the title, else the short id from the link', () => {
    expect(artifactLabel({ title: 'Board', url: URL_A })).toBe('Board')
    expect(artifactLabel({ title: null, url: URL_B })).toBe('Artifact Dpb46hR8')
    expect(artifactLabel({ title: null, url: null })).toBe('Artifact')
  })
})
