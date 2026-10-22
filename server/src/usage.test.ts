import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeUsageCache, parseUsage, readAccountEmail } from './usage.js'

const now = new Date('2026-10-20T04:00:00Z')

describe('parseUsage', () => {
  it('labels limits and rounds percent', () => {
    const usage = parseUsage(
      {
        limits: [
          { kind: 'session', percent: 33.4, severity: 'normal', resets_at: '2026-10-20T04:29:59Z', scope: null },
          { kind: 'weekly_all', percent: 23, severity: 'normal', resets_at: '2026-10-24T18:59:59Z', scope: null },
          {
            kind: 'weekly_scoped',
            percent: 6,
            severity: 'normal',
            resets_at: '2026-10-24T18:59:59Z',
            scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          },
        ],
      },
      { plan: 'max', email: 'dev@example.com' },
      now,
    )
    expect(usage.plan).toBe('max')
    expect(usage.email).toBe('dev@example.com')
    expect(usage.fetchedAt).toBe(now.toISOString())
    expect(usage.limits.map((l) => [l.label, l.kind, l.model, l.percent])).toEqual([
      ['5h', 'session', null, 33],
      ['wk', 'weekly_all', null, 23],
      ['Fable', 'weekly_scoped', 'Fable', 6],
    ])
  })

  it('falls back to five_hour / seven_day when limits is missing', () => {
    const usage = parseUsage(
      {
        five_hour: { utilization: 10, resets_at: '2026-10-20T04:29:59Z' },
        seven_day: { utilization: 20, resets_at: '2026-10-24T18:59:59Z' },
      },
      { plan: null, email: null },
      now,
    )
    expect(usage.email).toBeNull()
    expect(usage.limits.map((l) => [l.label, l.kind, l.model, l.percent])).toEqual([
      ['5h', 'session', null, 10],
      ['wk', 'weekly_all', null, 20],
    ])
  })
})

describe('readAccountEmail', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'jk-usage-test-'))
  })
  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  function claudeJson(content: string): string {
    const path = join(base, '.claude.json')
    writeFileSync(path, content)
    return path
  }

  it('reads oauthAccount.emailAddress', async () => {
    const path = claudeJson(JSON.stringify({ projects: {}, oauthAccount: { accountUuid: 'x', emailAddress: 'dev@example.com' } }))
    expect(await readAccountEmail(path)).toBe('dev@example.com')
  })

  it('is null without the key, with an empty or non-string value', async () => {
    expect(await readAccountEmail(claudeJson(JSON.stringify({ projects: {} })))).toBeNull()
    expect(await readAccountEmail(claudeJson(JSON.stringify({ oauthAccount: null })))).toBeNull()
    expect(await readAccountEmail(claudeJson(JSON.stringify({ oauthAccount: { emailAddress: '' } })))).toBeNull()
    expect(await readAccountEmail(claudeJson(JSON.stringify({ oauthAccount: { emailAddress: 42 } })))).toBeNull()
  })

  it('is null when the file is missing or broken (Claude Code may be rewriting it)', async () => {
    expect(await readAccountEmail(join(base, 'missing.json'))).toBeNull()
    expect(await readAccountEmail(claudeJson('{"oauthAccount": {"emailAddress": "dev@'))).toBeNull()
  })
})

describe('makeUsageCache', () => {
  it('calls loader once within ttl and again after', async () => {
    let calls = 0
    const cache = makeUsageCache(1000, async () => {
      calls += 1
      return { ok: false, reason: `n${calls}` }
    })
    const first = await cache(0)
    const second = await cache(500)
    expect(first).toBe(second)
    expect(calls).toBe(1)
    await cache(Date.now() + 5000)
    expect(calls).toBe(2)
  })
})
