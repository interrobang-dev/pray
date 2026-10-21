import type { AskQuestion } from './types.js'

/** PermissionRequest 훅 응답 (Claude Code 훅 JSON 출력 꼴) */
export interface PermissionDecision {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest'
    decision: { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }
  }
}

/** 웹에서 질문 취소. Claude Code 가 도구 거부 때 주는 문구처럼 멈추고 기다리게 한다 */
export const CANCEL_MESSAGE =
  'The user declined to answer these questions in the web UI. STOP what you are doing and wait for the user to tell you how to proceed.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 훅 payload 의 tool_input 에서 질문을 꺼낸다. 꼴이 다르면 null (붙잡지 않고 터미널에 맡긴다) */
export function parseQuestions(toolInput: unknown): AskQuestion[] | null {
  if (!isRecord(toolInput) || !Array.isArray(toolInput.questions) || toolInput.questions.length === 0) return null
  const questions: AskQuestion[] = []
  for (const raw of toolInput.questions) {
    if (!isRecord(raw) || typeof raw.question !== 'string' || !Array.isArray(raw.options)) return null
    const options: AskQuestion['options'] = []
    for (const option of raw.options) {
      if (!isRecord(option) || typeof option.label !== 'string') return null
      options.push({
        label: option.label,
        description: typeof option.description === 'string' ? option.description : '',
        ...(typeof option.preview === 'string' && { preview: option.preview }),
      })
    }
    questions.push({
      question: raw.question,
      header: typeof raw.header === 'string' ? raw.header : '',
      options,
      multiSelect: raw.multiSelect === true,
    })
  }
  return questions
}

/**
 * 고른 값들 → answers 의 답 문자열 (Claude Code 와 같은 규칙). 단일 선택은 글 그대로,
 * 여러 개 고르기는 ", " 로 잇되 ", " 나 `"` 가 든 값은 JSON 따옴표로 감싼다 (Claude Code 가 다시 나눌 수 있게)
 */
export function answerText(question: AskQuestion, values: string[]): string {
  if (!question.multiSelect) return values[0]
  return values.map((value) => (value.includes(', ') || value.includes('"') ? JSON.stringify(value) : value)).join(', ')
}

/** 답하기 API 의 answers({ [질문문]: string[] }) 검증 + 답 문자열로 합치기 */
export function buildAnswers(
  questions: AskQuestion[],
  answers: unknown,
): { ok: true; answers: Record<string, string> } | { ok: false; message: string } {
  if (!isRecord(answers)) return { ok: false, message: 'answers 필요 ({ [질문문]: string[] })' }
  const known = new Set(questions.map((q) => q.question))
  const unknown = Object.keys(answers).find((key) => !known.has(key))
  if (unknown !== undefined) return { ok: false, message: `모르는 질문: ${unknown}` }
  const result: Record<string, string> = {}
  for (const question of questions) {
    const values = answers[question.question]
    if (!Array.isArray(values) || values.length === 0) return { ok: false, message: `답 없음: ${question.question}` }
    if (values.some((value) => typeof value !== 'string' || !value.trim())) {
      return { ok: false, message: `빈 답: ${question.question}` }
    }
    if (!question.multiSelect && values.length !== 1) return { ok: false, message: `하나만 고를 수 있음: ${question.question}` }
    result[question.question] = answerText(question, values)
  }
  return { ok: true, answers: result }
}

/** 답으로 도구를 실행시킨다. updatedInput 은 입력 전체를 바꾸므로 원래 입력(questions 포함)을 그대로 두고 answers 만 넣는다 */
export function allowDecision(toolInput: Record<string, unknown>, answers: Record<string, string>): PermissionDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow', updatedInput: { ...toolInput, answers } },
    },
  }
}

export function denyDecision(message: string): PermissionDecision {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } }
}

/** 대화로 답하기. Claude Code 의 "Chat about this" 결과 문구를 따른다 */
export function chatMessage(questions: AskQuestion[]): string {
  return [
    'The user wants to clarify these questions.',
    'This means they may have additional information, context or questions for you.',
    'Take their response into account and then reformulate the questions if appropriate.',
    'Start by asking them what they would like to clarify.',
    '',
    'Questions asked:',
    ...questions.map((q) => `- "${q.question}"`),
  ].join('\n')
}
