import { describe, expect, it } from 'vitest'
import { findHighlights, rehypeHighlightTokens } from './markdownHighlight'

/** 강조된 조각만 `kind:글` 로 */
function marked(text: string, options?: { isNumbers?: boolean; isPaths?: boolean }): string[] {
  return findHighlights(text, options).map((range) => `${range.kind}:${text.slice(range.start, range.end)}`)
}

describe('숫자 강조', () => {
  it('정수·천 단위·소수·부호·퍼센트', () => {
    expect(marked('42 and 1,234 and 3.5 and -7 and 85%')).toEqual(['num:42', 'num:1,234', 'num:3.5', 'num:-7', 'num:85%'])
  })

  it('단위가 붙은 수는 단위까지 한 덩어리', () => {
    expect(marked('120ms 4.1MB 2h 30s 10px 5min 3x 60fps 2GiB')).toEqual(['num:120ms', 'num:4.1MB', 'num:2h', 'num:30s', 'num:10px', 'num:5min', 'num:3x', 'num:60fps', 'num:2GiB'])
  })

  it('버전·시각·날짜', () => {
    expect(marked('v1.2.3 and 1.2.3 at 10:30 and 10:30:15 on 2026-10-28')).toEqual(['num:v1.2.3', 'num:1.2.3', 'num:10:30', 'num:10:30:15', 'num:2026-10-28'])
  })

  it('낱말 중간은 제외: v2·UTF-8·h1·커밋 해시·변수 이름', () => {
    expect(marked('v2 UTF-8 h1 a56abbde d89876e x_1 COVID-19 5apples 0x1F #123456')).toEqual([])
  })

  it('한글 문장 안: 조사·단위가 붙어도 숫자만 칠한다', () => {
    expect(marked('파일이 3개, 5분 걸렸고 1,234원이며 약3.5배, 85%가 끝났다')).toEqual(['num:3', 'num:5', 'num:1,234', 'num:3.5', 'num:85%'])
  })

  it('범위는 양쪽 다, 분수는 제외, 슬래시 날짜는 한 덩어리', () => {
    expect(marked('10-20 items, 1/2, 2026/10/28')).toEqual(['num:10', 'num:20', 'num:2026/10/28'])
  })

  it('문장 끝 마침표는 숫자에 넣지 않는다', () => {
    expect(marked('Total is 42.')).toEqual(['num:42'])
  })

  it('옵션으로 끈다', () => {
    expect(marked('42 web/src/Chat.tsx', { isNumbers: false })).toEqual(['path:web/src/Chat.tsx'])
    expect(marked('42 web/src/Chat.tsx', { isPaths: false })).toEqual(['num:42'])
  })
})

describe('경로 강조', () => {
  it('슬래시가 든 상대 경로', () => {
    expect(marked('see web/src/Chat.tsx, .claude/rules/chat.md, ./x and ../y/z.')).toEqual(['path:web/src/Chat.tsx', 'path:.claude/rules/chat.md', 'path:./x', 'path:../y/z'])
  })

  it('윈도우 절대 경로·홈 경로', () => {
    expect(marked(String.raw`open C:\Users\ENGSOFT\a.txt and D:/workspace/@private/jk-corp and ~/.claude/pray/hq.json.`)).toEqual([
      String.raw`path:C:\Users\ENGSOFT\a.txt`,
      'path:D:/workspace/@private/jk-corp',
      'path:~/.claude/pray/hq.json',
    ])
  })

  it('확장자 있는 파일 이름 단독, 문장 끝 마침표는 제외', () => {
    expect(marked('Edit Chat.tsx and package.json.')).toEqual(['path:Chat.tsx', 'path:package.json'])
    expect(marked('Open CLAUDE.md')).toEqual(['path:CLAUDE.md'])
  })

  it('한글 조사는 경로에 넣지 않는다', () => {
    expect(marked('web/src/Chat.tsx를 고치고 Files.tsx에서 본다')).toEqual(['path:web/src/Chat.tsx', 'path:Files.tsx'])
  })

  it('줄 번호는 경로 안에 넣는다 (숫자로 따로 칠하지 않음)', () => {
    expect(marked('at web/src/Chat.tsx:422 and Files.tsx:10:5')).toEqual(['path:web/src/Chat.tsx:422', 'path:Files.tsx:10:5'])
  })

  it('경로 안 숫자는 숫자로 칠하지 않는다', () => {
    expect(marked('docs/plans/2026-10-20-design.md has 3 items')).toEqual(['path:docs/plans/2026-10-20-design.md', 'num:3'])
  })

  it('URL·이메일은 경로도 숫자도 아니다', () => {
    expect(marked('visit https://example.com/a/b.html?x=1 or user@example.com or www.site.com/a/b')).toEqual([])
  })

  it('경로가 아닌 슬래시 글: and/or·TCP/IP·슬래시 명령·제품 이름', () => {
    expect(marked('and/or input/output TCP/IP /btw Node.js and Next.js e.g. i.e.')).toEqual([])
  })

  it('슬래시 명령 둘 이상 구간의 절대 경로는 경로', () => {
    expect(marked('GET /api/sessions/abc now')).toEqual(['path:/api/sessions/abc'])
  })
})

interface TestNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: string[] }
  children?: TestNode[]
}

describe('rehype 플러그인', () => {
  function run(tree: TestNode): TestNode {
    rehypeHighlightTokens()(tree)
    return tree
  }
  const text = (value: string): TestNode => ({ type: 'text', value })
  const element = (tagName: string, ...children: TestNode[]): TestNode => ({ type: 'element', tagName, children })

  it('일반 글의 text 노드를 num·path span 으로 나눈다', () => {
    const tree = run(element('p', text('took 5s in web/x.ts')))
    expect(tree.children?.map((child) => (child.type === 'text' ? child.value : `${child.properties?.className?.[0]}:${child.children?.[0].value}`))).toEqual(['took ', 'num:5s', ' in ', 'path:web/x.ts'])
  })

  it('code·pre·a·제목·span 안은 건드리지 않는다', () => {
    const tree = run(element('div', element('code', text('42')), element('pre', element('code', text('42'))), element('a', text('42')), element('h2', text('Step 42')), element('span', text('42'))))
    expect(JSON.stringify(tree)).not.toContain('"num"')
  })

  it('강조할 것이 없으면 노드를 그대로 둔다', () => {
    const child = text('nothing here')
    const tree = run(element('p', child))
    expect(tree.children?.[0]).toBe(child)
  })

  it('strong·표 칸 안은 칠한다', () => {
    const tree = run(element('td', element('strong', text('42'))))
    expect(JSON.stringify(tree)).toContain('"num"')
  })
})
