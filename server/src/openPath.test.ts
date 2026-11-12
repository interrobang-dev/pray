import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decideOpenPath, locateOpenPath, splitLineSuffix } from './openPath.js'

describe('splitLineSuffix', () => {
  it('strips :line and :line:column', () => {
    expect(splitLineSuffix('web/src/Chat.tsx:422')).toEqual({ path: 'web/src/Chat.tsx', line: 422 })
    expect(splitLineSuffix('C:\\a\\b.ts:12:3')).toEqual({ path: 'C:\\a\\b.ts', line: 12 })
    expect(splitLineSuffix('D:/x/y.md:1')).toEqual({ path: 'D:/x/y.md', line: 1 })
  })

  it('keeps the drive colon', () => {
    expect(splitLineSuffix('C:\\a\\b.ts')).toEqual({ path: 'C:\\a\\b.ts', line: null })
    expect(splitLineSuffix('C:12')).toEqual({ path: 'C:12', line: null })
    expect(splitLineSuffix('C:')).toEqual({ path: 'C:', line: null })
  })

  it('strips but drops line 0 or a huge line', () => {
    expect(splitLineSuffix('a.ts:0')).toEqual({ path: 'a.ts', line: null })
    expect(splitLineSuffix('a.ts:99999999')).toEqual({ path: 'a.ts', line: null })
  })

  it('leaves other colons alone', () => {
    expect(splitLineSuffix('a.ts:x')).toEqual({ path: 'a.ts:x', line: null })
    expect(splitLineSuffix('a.ts:1:2:3')).toEqual({ path: 'a.ts:1:2:3', line: null })
    expect(splitLineSuffix('')).toEqual({ path: '', line: null })
  })
})

describe('decideOpenPath', () => {
  const root = 'D:\\work\\app'
  const scratchpad = 'C:\\Temp\\claude\\p\\s\\scratchpad'
  const base = { root, scratchpad, line: null, isLocal: true, isDirectory: false }

  it('opens in Files inside the cwd with a / path and the line (files only)', () => {
    expect(decideOpenPath({ ...base, requested: `${root}\\web\\a.ts`, real: `${root}\\web\\a.ts`, line: 7 })).toEqual({
      kind: 'open',
      body: { target: 'files', path: 'web/a.ts', isDirectory: false, line: 7 },
    })
    expect(decideOpenPath({ ...base, requested: `${root}\\web`, real: `${root}\\web`, isDirectory: true, line: 7 })).toEqual({
      kind: 'open',
      body: { target: 'files', path: 'web', isDirectory: true, line: null },
    })
    expect(decideOpenPath({ ...base, requested: root, real: root, isDirectory: true })).toEqual({
      kind: 'open',
      body: { target: 'files', path: '', isDirectory: true, line: null },
    })
  })

  it('opens in Work files inside the scratchpad, also from another PC', () => {
    expect(decideOpenPath({ ...base, isLocal: false, requested: `${scratchpad}\\shots\\a.png`, real: `${scratchpad}\\shots\\a.png` })).toEqual({
      kind: 'open',
      body: { target: 'work-files', path: 'shots/a.png', isDirectory: false },
    })
  })

  it('cwd wins over the scratchpad when one holds the other', () => {
    const decision = decideOpenPath({ ...base, scratchpad: `${root}\\tmp`, requested: `${root}\\tmp\\a.txt`, real: `${root}\\tmp\\a.txt` })
    expect(decision).toMatchObject({ kind: 'open', body: { target: 'files', path: 'tmp/a.txt' } })
  })

  it('outside: explorer on this PC, 403 on another PC', () => {
    expect(decideOpenPath({ ...base, requested: 'E:\\x\\a.txt', real: 'E:\\x\\a.txt' })).toEqual({ kind: 'explorer', real: 'E:\\x\\a.txt', isDirectory: false })
    expect(decideOpenPath({ ...base, isLocal: false, requested: 'E:\\x', real: 'E:\\x', isDirectory: true })).toEqual({
      kind: 'rejected',
      status: 403,
      message: 'Opens only on this PC',
    })
  })

  it('uses the real path: a link inside the cwd that points outside is outside', () => {
    expect(decideOpenPath({ ...base, requested: `${root}\\link`, real: 'E:\\elsewhere', isDirectory: true })).toEqual({ kind: 'explorer', real: 'E:\\elsewhere', isDirectory: true })
  })

  it('missing: 404, but another PC asking outside the cwd and scratchpad gets 403', () => {
    expect(decideOpenPath({ ...base, requested: 'E:\\none', real: null })).toEqual({ kind: 'rejected', status: 404, message: 'Path not found' })
    expect(decideOpenPath({ ...base, isLocal: false, requested: `${root}\\none.ts`, real: null })).toEqual({ kind: 'rejected', status: 404, message: 'Path not found' })
    expect(decideOpenPath({ ...base, isLocal: false, requested: 'E:\\none', real: null })).toMatchObject({ status: 403 })
    expect(decideOpenPath({ ...base, root: null, requested: null, real: null })).toMatchObject({ status: 404 })
  })
})

describe('locateOpenPath (real folders)', () => {
  let base: string
  let root: string
  let scratchpad: string
  let outside: string

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'open-path-')))
    root = join(base, 'repo')
    scratchpad = join(base, 'scratchpad')
    outside = join(base, 'outside')
    for (const folder of [join(root, 'web', 'src'), join(scratchpad, 'shots'), outside]) mkdirSync(folder, { recursive: true })
    writeFileSync(join(root, 'web', 'src', 'Chat.tsx'), 'x')
    writeFileSync(join(scratchpad, 'shots', 'a.png'), 'x')
    writeFileSync(join(outside, 'secret.txt'), 'x')
    symlinkSync(outside, join(root, 'escape'), 'junction')
  })

  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('cwd relative and absolute paths open in Files', async () => {
    const context = { root, scratchpad, isLocal: false }
    expect(await locateOpenPath('web/src/Chat.tsx', 3, context)).toEqual({ kind: 'open', body: { target: 'files', path: 'web/src/Chat.tsx', isDirectory: false, line: 3 } })
    expect(await locateOpenPath(join(root, 'web'), null, context)).toEqual({ kind: 'open', body: { target: 'files', path: 'web', isDirectory: true, line: null } })
    expect(await locateOpenPath(join(root, 'web', 'src').replace(/\\/g, '/'), null, context)).toMatchObject({ body: { path: 'web/src' } })
  })

  it('scratchpad files open in Work files', async () => {
    expect(await locateOpenPath(join(scratchpad, 'shots', 'a.png'), null, { root, scratchpad, isLocal: false })).toEqual({
      kind: 'open',
      body: { target: 'work-files', path: 'shots/a.png', isDirectory: false },
    })
  })

  it('a junction out of the cwd goes to explorer locally and 403 from another PC', async () => {
    expect(await locateOpenPath('escape/secret.txt', null, { root, scratchpad, isLocal: true })).toEqual({ kind: 'explorer', real: join(outside, 'secret.txt'), isDirectory: false })
    expect(await locateOpenPath('escape', null, { root, scratchpad, isLocal: false })).toMatchObject({ kind: 'rejected', status: 403 })
  })

  it('missing paths and relative paths without a cwd are 404', async () => {
    expect(await locateOpenPath('web/none.ts', null, { root, scratchpad, isLocal: true })).toMatchObject({ status: 404 })
    expect(await locateOpenPath('web/src/Chat.tsx', null, { root: null, scratchpad, isLocal: true })).toMatchObject({ status: 404 })
  })
})
