/**
 * Files 탭 편집기 (CodeMirror 6). **이 파일은 CodeEditor.tsx 가 동적 import 로만 부른다** — 메인 번들에 CodeMirror 를 넣지 않으려고.
 * 언어는 @codemirror/language-data 가 파일 이름으로 고르고 그 언어 모듈도 따로 받는다. 색은 style.css 변수(`--hl-*`·`--panel` 등)라 팔레트·다크를 따른다.
 * 글의 줄바꿈은 늘 `\n` 이다 (원래 CRLF·BOM 은 서버가 저장할 때 되살린다)
 */
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel, search } from '@codemirror/search'
import { languages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'
import type { LineRange } from './codeSelection'

/** 코드 보기의 .hljs-* 규칙과 같은 묶음·변수 */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.self], color: 'var(--hl-keyword)' },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))],
    color: 'var(--hl-entity)',
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal, tags.attributeName, tags.unit, tags.color], color: 'var(--hl-constant)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.escape], color: 'var(--hl-string)' },
  { tag: [tags.special(tags.variableName), tags.labelName], color: 'var(--hl-variable)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta], color: 'var(--hl-comment)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--hl-tag)' },
  { tag: tags.heading, color: 'var(--hl-section)', fontWeight: 'bold' },
  { tag: [tags.list, tags.quote], color: 'var(--hl-bullet)' },
  { tag: [tags.link, tags.url], color: 'var(--link)', textDecoration: 'underline' },
  { tag: tags.inserted, color: 'var(--hl-addition)', backgroundColor: 'var(--hl-addition-bg)' },
  { tag: tags.deleted, color: 'var(--hl-deletion)', backgroundColor: 'var(--hl-deletion-bg)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.invalid, color: 'var(--error)' },
])

/** 코드 보기(.code-view)와 같은 글꼴·크기·색. 색은 변수라 다크 테마를 따로 두지 않는다 */
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--panel)', fontSize: 'calc(12px * var(--font-scale))' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--text)', padding: '6px 0 24px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-bg)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-bg)', color: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--search-match-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match-bg)', outline: '1px solid var(--line-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-current-bg)', color: 'var(--search-current-text)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-line)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--red-soft)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--chip-bg)', color: 'var(--muted)', border: '1px solid var(--line)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  // 찾기·바꾸기 패널 (basicSetup 의 Ctrl+F): 코드 보기 찾기 막대(.chat-search)와 같은 바탕·입력칸·버튼 색. 기본 테마의 회색 그라데이션 버튼을 지운다
  '.cm-panel.cm-search': { padding: '6px 32px 6px 10px', fontFamily: 'inherit', fontSize: 'calc(12px * var(--font-scale))' },
  '.cm-panel input, .cm-panel button': { fontSize: 'inherit' },
  '.cm-textfield': {
    margin: '0 6px 0 0',
    padding: '3px 8px',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    verticalAlign: 'middle',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)' },
  '.cm-button': {
    margin: '0 4px 0 0',
    padding: '3px 9px',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    backgroundColor: 'var(--panel)',
    backgroundImage: 'none',
    color: 'var(--text)',
    fontFamily: 'inherit',
    verticalAlign: 'middle',
    cursor: 'pointer',
  },
  '.cm-button:hover': { borderColor: 'var(--accent)' },
  '.cm-button:active': { backgroundColor: 'var(--accent-soft)', backgroundImage: 'none' },
  '.cm-panel.cm-search label': { margin: '0 8px 0 2px', color: 'var(--muted)', fontSize: 'inherit', whiteSpace: 'nowrap', verticalAlign: 'middle' },
  '.cm-panel.cm-search input[type=checkbox]': { margin: '0 4px 0 0', accentColor: 'var(--accent)', verticalAlign: 'middle' },
  '.cm-panel.cm-search [name=close]': { top: '6px', right: '8px', width: '22px', height: '22px', padding: '0', color: 'var(--muted)', fontSize: '18px', lineHeight: '18px', borderRadius: '6px' },
  '.cm-panel.cm-search [name=close]:hover': { color: 'var(--text)', backgroundColor: 'var(--bg)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
})

export interface EditorHandle {
  getText(): string
  /** 글을 바꾸고 그 글을 저장된 기준으로 (다시 받기) */
  setText(text: string): void
  /** 지금 글이 저장됐다 (● 를 끈다) */
  markSaved(text: string): void
  /** 고른 글자가 걸친 줄 (1부터). 고른 것이 없으면 null */
  selectionLines(): LineRange | null
  /** 고른 글자 (없으면 빈 글. Ctrl+Shift+F 가 검색어로 쓴다) */
  selectedText(): string
  /** 찾기·바꾸기 패널을 연다 (편집기 밖에서 Ctrl+F 를 눌렀을 때) */
  openSearch(): void
  /** 그 줄(1부터)을 고르고 가운데로 스크롤한다 (Search 결과를 눌렀을 때) */
  revealLine(line: number): void
  focus(): void
  destroy(): void
}

interface Options {
  text: string
  /** 언어를 고를 파일 이름 (경로 가능) */
  path: string
  /** 저장된 글과 다른지가 바뀔 때 */
  onDirtyChange: (isDirty: boolean) => void
  /** Ctrl+S (맥 Cmd+S) */
  onSave: () => void
}

export function createEditor(parent: HTMLElement, { text, path, onDirtyChange, onSave }: Options): EditorHandle {
  /** 저장된 기준 글. CodeMirror 가 줄바꿈을 `
` 으로 바꾼 글이라야 CRLF 파일이 열자마자 바뀐 것으로 보이지 않는다 */
  let savedText = ''
  let isDirty = false
  const languageSlot = new Compartment()
  /** 길이가 다르면 바로 다르다. 같을 때만 글 전체를 비교한다 (1MB 글을 글자마다 비교하지 않게) */
  const update = (view: EditorView) => {
    const doc = view.state.doc
    const next = doc.length !== savedText.length || doc.toString() !== savedText
    if (next === isDirty) return
    isDirty = next
    onDirtyChange(isDirty)
  }
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }])),
        basicSetup,
        // 찾기·바꾸기 패널을 위에 (코드 보기의 찾기 막대와 같은 자리)
        search({ top: true }),
        keymap.of([indentWithTab]),
        syntaxHighlighting(highlightStyle),
        theme,
        languageSlot.of([]),
        EditorView.updateListener.of((viewUpdate) => {
          if (viewUpdate.docChanged) update(viewUpdate.view)
        }),
      ],
    }),
  })
  savedText = view.state.doc.toString()
  const description = LanguageDescription.matchFilename(languages, path.split('/').pop() ?? path)
  description
    ?.load()
    .then((support) => view.dispatch({ effects: languageSlot.reconfigure(support) }))
    .catch(() => {})

  return {
    getText: () => view.state.doc.toString(),
    setText(next) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
      savedText = view.state.doc.toString()
      update(view)
    },
    markSaved(next) {
      savedText = next
      update(view)
    },
    selectionLines() {
      const { main } = view.state.selection
      if (main.empty) return null
      const start = view.state.doc.lineAt(main.from).number
      // 다음 줄 맨 앞에서 끝나면 그 줄은 넣지 않는다 (코드 보기 줄 고르기와 같다)
      const endLine = view.state.doc.lineAt(main.to)
      const end = main.to === endLine.from && endLine.number > start ? endLine.number - 1 : endLine.number
      return { start, end }
    },
    selectedText() {
      const { main } = view.state.selection
      return view.state.sliceDoc(main.from, main.to)
    },
    openSearch() {
      openSearchPanel(view)
    },
    revealLine(number) {
      const line = view.state.doc.line(Math.min(Math.max(number, 1), view.state.doc.lines))
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
      view.focus()
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
