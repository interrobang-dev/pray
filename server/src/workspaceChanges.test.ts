import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  additionHunks,
  decodeDiffOutput,
  diffChange,
  listChanges,
  makeChangesCache,
  parseGitStatus,
  parseSvnStatusXml,
  parseUnifiedDiff,
} from './workspaceChanges.js'

describe('workspaceChanges parsing', () => {
  it('parses git porcelain v2 against HEAD (index and worktree merged)', () => {
    const output = [
      '# branch.oid 5a09',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 c9 c9 a.txt',
      '1 .D N... 100644 100644 000000 b0 b0 del.txt',
      '1 D. N... 100644 000000 000000 b0 00 staged-del.txt',
      '1 A. N... 000000 100644 100644 00 91 staged.txt',
      '1 AM N... 000000 100644 100644 00 91 staged then edited.txt',
      '1 AD N... 000000 100644 000000 00 91 added-then-removed.txt',
      '2 RM N... 100644 100644 100644 c9 c9 R100 new name.txt',
      'old name.txt',
      '2 RD N... 100644 100644 000000 c9 c9 R100 moved-then-removed.txt',
      'was.txt',
      '2 C. N... 100644 100644 100644 c9 c9 C100 copy.txt',
      'orig.txt',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
      '? 한글/새 파일.txt',
      '! ignored.log',
      '',
    ].join('\0')
    expect(parseGitStatus(output)).toEqual({
      branch: 'main',
      isInitial: false,
      changes: [
        { path: 'a.txt', status: 'modified', oldPath: null },
        { path: 'del.txt', status: 'deleted', oldPath: null },
        { path: 'staged-del.txt', status: 'deleted', oldPath: null },
        { path: 'staged.txt', status: 'added', oldPath: null },
        { path: 'staged then edited.txt', status: 'added', oldPath: null },
        { path: 'new name.txt', status: 'renamed', oldPath: 'old name.txt' },
        { path: 'was.txt', status: 'deleted', oldPath: null },
        { path: 'copy.txt', status: 'added', oldPath: null },
        { path: 'conflict.txt', status: 'conflicted', oldPath: null },
        { path: '한글/새 파일.txt', status: 'untracked', oldPath: null },
      ],
    })
    expect(parseGitStatus('# branch.oid (initial)\0# branch.head (detached)\0')).toEqual({ branch: 'HEAD', isInitial: true, changes: [] })
  })

  it('parses svn status xml with moves, props, unversioned and entities', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status><target path=".">
<entry path="a.txt"><wc-status props="none" item="modified" revision="1"><commit revision="1"></commit></wc-status></entry>
<entry path="added.txt"><wc-status props="none" item="added" revision="-1"></wc-status></entry>
<entry path="del.txt"><wc-status item="deleted" props="none"></wc-status></entry>
<entry path="missing.txt"><wc-status item="missing" props="none"></wc-status></entry>
<entry path="move-new.txt"><wc-status moved-from="move-old.txt" item="added" props="none" copied="true"></wc-status></entry>
<entry path="move-old.txt"><wc-status moved-to="move-new.txt" item="deleted" props="none"></wc-status></entry>
<entry path="sub\\x.txt"><wc-status props="modified" item="normal"></wc-status></entry>
<entry path="sub\\y.txt"><wc-status props="none" item="normal" tree-conflicted="true"></wc-status></entry>
<entry path="R&amp;D.txt"><wc-status item="replaced" props="none"></wc-status></entry>
<entry path="c.txt"><wc-status item="conflicted" props="none"></wc-status></entry>
<entry path="ext"><wc-status item="external" props="none"></wc-status></entry>
<entry path="한글.txt"><wc-status props="none" item="unversioned"></wc-status></entry>
</target></status>`
    expect(parseSvnStatusXml(xml)).toEqual([
      { path: 'a.txt', status: 'modified', oldPath: null },
      { path: 'added.txt', status: 'added', oldPath: null },
      { path: 'del.txt', status: 'deleted', oldPath: null },
      { path: 'missing.txt', status: 'missing', oldPath: null },
      { path: 'move-new.txt', status: 'renamed', oldPath: 'move-old.txt' },
      { path: 'sub/x.txt', status: 'modified', oldPath: null },
      { path: 'sub/y.txt', status: 'conflicted', oldPath: null },
      { path: 'R&D.txt', status: 'modified', oldPath: null },
      { path: 'c.txt', status: 'conflicted', oldPath: null },
      { path: '한글.txt', status: 'untracked', oldPath: null },
    ])
  })

  it('decodes diff lines one by one (UTF-8, else EUC-KR) and judges the encoding from hunk lines only', () => {
    const cp949Name = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb])
    // SVN: 머리의 경로는 코드 페이지, 내용은 UTF-8
    const svnHeader = Buffer.concat([Buffer.from('Index: '), cp949Name, Buffer.from('\r\n--- '), cp949Name, Buffer.from('\t(revision 1)\r\n@@ -1 +1 @@\r\n-a\r\n+한글\n', 'utf8')])
    const decoded = decodeDiffOutput(svnHeader)
    expect(decoded.lines).toEqual(['Index: 한글', '--- 한글\t(revision 1)', '@@ -1 +1 @@', '-a', '+한글'])
    expect(parseUnifiedDiff(decoded.lines, decoded.eucKrLines).isEucKr).toBe(false)
    const eucBody = decodeDiffOutput(Buffer.concat([Buffer.from('@@ -1 +1 @@\n-'), cp949Name, Buffer.from('\n+b\n')]))
    expect(eucBody.lines).toEqual(['@@ -1 +1 @@', '-한글', '+b'])
    expect(parseUnifiedDiff(eucBody.lines, eucBody.eucKrLines).isEucKr).toBe(true)
  })

  it('parses hunks with line numbers, no-newline marks and binary', () => {
    const lines = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,4 @@ title',
      ' one',
      '-two',
      '+TWO',
      '+2b',
      '',
      '@@ -10 +11 @@',
      '-last',
      '\\ No newline at end of file',
      '+last!',
      '\\ No newline at end of file',
    ]
    const { hunks, isBinary } = parseUnifiedDiff(lines)
    expect(isBinary).toBe(false)
    expect(hunks.map((hunk) => [hunk.header, hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).toEqual([
      ['@@ -1,3 +1,4 @@ title', 1, 3, 1, 4],
      ['@@ -10 +11 @@', 10, 1, 11, 1],
    ])
    expect(hunks[0].lines).toEqual([
      { kind: 'context', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'two', oldLine: 2, newLine: null },
      { kind: 'add', text: 'TWO', oldLine: null, newLine: 2 },
      { kind: 'add', text: '2b', oldLine: null, newLine: 3 },
      { kind: 'context', text: '', oldLine: 3, newLine: 4 },
    ])
    expect(hunks[1].lines).toEqual([
      { kind: 'del', text: 'last', oldLine: 10, newLine: null, hasNoNewline: true },
      { kind: 'add', text: 'last!', oldLine: null, newLine: 11, hasNoNewline: true },
    ])
    expect(parseUnifiedDiff(['diff --git a/i.png b/i.png', 'Binary files a/i.png and b/i.png differ']).isBinary).toBe(true)
    expect(parseUnifiedDiff(['Index: i.png', '===', 'Cannot display: file marked as a binary type.']).isBinary).toBe(true)
    expect(parseUnifiedDiff(['@@ -1 +1 @@', '-PNG\u0000', '+PNG\u0001']).isBinary).toBe(true)
  })

  it('stops a hunk at its counted length so svn property sections are not swallowed', () => {
    const lines = ['@@ -1 +1 @@', '-a', '+b', '', 'Property changes on: x.txt', '______', 'Added: svn:keywords', '## -0,0 +1 ##', '+Id']
    const { hunks, hasPropertyChanges } = parseUnifiedDiff(lines)
    expect(hasPropertyChanges).toBe(true)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.map((line) => line.text)).toEqual(['a', 'b'])
  })

  it('turns a new file into one added hunk', () => {
    expect(additionHunks('')).toEqual([])
    const [hunk] = additionHunks('a\r\nb\n')
    expect(hunk.header).toBe('@@ -0,0 +1,2 @@')
    expect(hunk.lines).toEqual([
      { kind: 'add', text: 'a', oldLine: null, newLine: 1 },
      { kind: 'add', text: 'b', oldLine: null, newLine: 2 },
    ])
    expect(additionHunks('x')[0].lines[0].hasNoNewline).toBe(true)
  })

  it('shares an in-flight list and reuses a recent one only when asked', async () => {
    let calls = 0
    let time = 0
    const changesOf = makeChangesCache({
      now: () => time,
      load: async () => {
        calls++
        return { result: { kind: 'none' }, vcs: null, isInitial: false, byPath: new Map() }
      },
    })
    await Promise.all([changesOf('D:/a', 0), changesOf('d:/A', 0)])
    expect(calls).toBe(1)
    time = 5000
    await changesOf('D:/a', 10_000)
    expect(calls).toBe(1)
    await changesOf('D:/a', 0)
    expect(calls).toBe(2)
  })
})

/** 실제 git·svn 으로 (설치돼 있지 않으면 건너뛴다) */
const hasCommand = (command: string) => {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('workspaceChanges on real working copies', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jk-corp-changes-')))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it.skipIf(!hasCommand('git'))('lists git changes under the session folder and diffs them', async () => {
    const repo = join(root, 'git')
    mkdirSync(join(repo, 'web', 'src'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'top.txt'), 'top\n')
    writeFileSync(join(repo, 'web', 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(repo, 'web', 'gone.txt'), 'bye\n')
    writeFileSync(join(repo, 'web', 'old.txt'), 'r1\nr2\nr3\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(repo, 'top.txt'), 'top changed\n')
    writeFileSync(join(repo, 'web', 'a.txt'), 'one\nTWO\n')
    unlinkSync(join(repo, 'web', 'gone.txt'))
    git('mv', 'web/old.txt', 'web/src/new.txt')
    writeFileSync(join(repo, 'web', '새 파일.txt'), '가\n나\n')
    mkdirSync(join(repo, 'web', 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(repo, 'web', 'node_modules', 'x', 'i.js'), 'x\n')

    const changesOf = makeChangesCache()
    const cwd = join(repo, 'web')
    const changes = await listChanges(changesOf, cwd)
    // 저장소 루트의 top.txt 는 cwd 밖이라 빠지고, 경로는 cwd 상대
    expect(changes).toEqual({
      kind: 'git',
      branch: 'main',
      files: [
        { path: 'a.txt', status: 'modified', oldPath: null },
        { path: 'gone.txt', status: 'deleted', oldPath: null },
        { path: 'src/new.txt', status: 'renamed', oldPath: 'old.txt' },
        { path: '새 파일.txt', status: 'untracked', oldPath: null },
      ],
      isTruncated: false,
      hiddenCount: 1,
      error: null,
    })
    const modified = await diffChange(changesOf, cwd, 'a.txt')
    expect(modified?.kind).toBe('diff')
    expect(modified?.hunks[0].lines.map((line) => `${line.kind}:${line.text}`)).toEqual(['context:one', 'del:two', 'add:TWO'])
    expect((await diffChange(changesOf, cwd, 'src/new.txt'))?.kind).toBe('empty')
    expect((await diffChange(changesOf, cwd, 'gone.txt'))?.hunks[0].lines).toEqual([{ kind: 'del', text: 'bye', oldLine: 1, newLine: null }])
    const untracked = await diffChange(changesOf, cwd, '새 파일.txt')
    expect(untracked?.hunks[0].lines.map((line) => line.newLine)).toEqual([1, 2])
    expect(await diffChange(changesOf, cwd, 'top.txt')).toBeNull()
    expect(await diffChange(changesOf, cwd, 'node_modules/x/i.js')).toBeNull()
  })

  it.skipIf(!hasCommand('svn') || !hasCommand('svnadmin'))('lists svn changes of a local file:// working copy', async () => {
    const repoDir = join(root, 'svnrepo')
    const wc = join(root, 'svnwc')
    execFileSync('svnadmin', ['create', repoDir])
    execFileSync('svn', ['checkout', '-q', '--non-interactive', `file:///${repoDir.replace(/\\/g, '/')}`, wc])
    writeFileSync(join(wc, 'a.txt'), 'one\n')
    writeFileSync(join(wc, 'm.txt'), 'm\n')
    execFileSync('svn', ['add', '-q', 'a.txt', 'm.txt'], { cwd: wc })
    execFileSync('svn', ['commit', '-q', '--non-interactive', '-m', 'init'], { cwd: wc })
    writeFileSync(join(wc, 'a.txt'), 'ONE\n')
    execFileSync('svn', ['move', '-q', 'm.txt', 'moved.txt'], { cwd: wc })
    mkdirSync(join(wc, 'new', 'deep'), { recursive: true })
    writeFileSync(join(wc, 'new', 'deep', 'n.txt'), 'n\n')

    const changesOf = makeChangesCache()
    expect(await listChanges(changesOf, wc)).toEqual({
      kind: 'svn',
      branch: null,
      files: [
        { path: 'a.txt', status: 'modified', oldPath: null },
        { path: 'moved.txt', status: 'renamed', oldPath: 'm.txt' },
        { path: 'new/deep/n.txt', status: 'untracked', oldPath: null },
      ],
      isTruncated: false,
      hiddenCount: 0,
      error: null,
    })
    const diff = await diffChange(changesOf, wc, 'a.txt')
    expect(diff?.hunks[0].lines.map((line) => `${line.kind}:${line.text}`)).toEqual(['del:one', 'add:ONE'])
  })

  it('reports no version control', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    expect(await listChanges(makeChangesCache(), plain)).toEqual({ kind: 'none' })
  })
})
