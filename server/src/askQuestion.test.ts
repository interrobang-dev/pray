import { describe, expect, it } from 'vitest'
import { allowDecision, answerText, buildAnswers, chatMessage, denyDecision, parseQuestions } from './askQuestion.js'
import type { AskQuestion } from './types.js'

const single: AskQuestion = {
  question: '어디서 분기할까요?',
  header: '브랜치',
  options: [
    { label: 'main', description: '로컬 main' },
    { label: 'dev', description: '개발 브랜치' },
  ],
  multiSelect: false,
}
const multi: AskQuestion = {
  question: '무엇을 넣을까요?',
  header: '기능',
  options: [
    { label: '로그인', description: '' },
    { label: '검색', description: '' },
  ],
  multiSelect: true,
}

describe('parseQuestions', () => {
  it('reads tool_input.questions, filling optional fields', () => {
    const toolInput = {
      questions: [
        {
          question: 'Q?',
          header: 'H',
          options: [{ label: 'A', description: 'a', preview: '```\nA\n```' }, { label: 'B' }],
          multiSelect: true,
        },
        { question: 'R?', options: [{ label: 'C', description: 'c' }] },
      ],
    }
    expect(parseQuestions(toolInput)).toEqual([
      {
        question: 'Q?',
        header: 'H',
        options: [
          { label: 'A', description: 'a', preview: '```\nA\n```' },
          { label: 'B', description: '' },
        ],
        multiSelect: true,
      },
      { question: 'R?', header: '', options: [{ label: 'C', description: 'c' }], multiSelect: false },
    ])
  })

  it('returns null for a different shape', () => {
    expect(parseQuestions(undefined)).toBeNull()
    expect(parseQuestions({ questions: [] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: 'Q?' }] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [{ description: 'x' }] }] })).toBeNull()
  })
})

describe('answerText', () => {
  it('keeps a single-select answer as is, even with ", " or quotes', () => {
    expect(answerText(single, ['main, 그리고 "dev"'])).toBe('main, 그리고 "dev"')
  })

  it('joins multi-select values with ", " and JSON-quotes values containing ", " or a double quote', () => {
    expect(answerText(multi, ['로그인', '검색'])).toBe('로그인, 검색')
    expect(answerText(multi, ['A, B', 'say "hi"', '그대로'])).toBe('"A, B", "say \\"hi\\"", 그대로')
    expect(answerText(multi, ['A,B'])).toBe('A,B')
  })
})

describe('buildAnswers', () => {
  it('builds answer strings keyed by question text, other text included', () => {
    const built = buildAnswers([single, multi], { [single.question]: ['직접 입력한 글'], [multi.question]: ['로그인', '기타 기능'] })
    expect(built).toEqual({ ok: true, answers: { [single.question]: '직접 입력한 글', [multi.question]: '로그인, 기타 기능' } })
  })

  it('rejects missing answers, empty arrays, blank values, extra values on single-select and unknown questions', () => {
    const cases: unknown[] = [
      undefined,
      [],
      { [single.question]: ['main'] },
      { [single.question]: [], [multi.question]: ['검색'] },
      { [single.question]: ['  '], [multi.question]: ['검색'] },
      { [single.question]: [1], [multi.question]: ['검색'] },
      { [single.question]: 'main', [multi.question]: ['검색'] },
      { [single.question]: ['main', 'dev'], [multi.question]: ['검색'] },
      { [single.question]: ['main'], [multi.question]: ['검색'], '없는 질문': ['x'] },
    ]
    for (const answers of cases) expect(buildAnswers([single, multi], answers).ok, JSON.stringify(answers)).toBe(false)
  })
})

describe('decisions', () => {
  it('allow keeps the original input (questions untouched) and adds answers', () => {
    const toolInput = { questions: [{ question: 'Q?', options: [{ label: 'A' }], extra: 1 }], metadata: { source: 'x' } }
    expect(allowDecision(toolInput, { 'Q?': 'A' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedInput: { ...toolInput, answers: { 'Q?': 'A' } } },
      },
    })
  })

  it('deny carries a message; the chat message lists the questions', () => {
    expect(denyDecision('m')).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'm' } } })
    const message = chatMessage([single, multi])
    expect(message.startsWith('The user wants to clarify these questions.')).toBe(true)
    expect(message.endsWith(`Questions asked:\n- "${single.question}"\n- "${multi.question}"`)).toBe(true)
  })
})
