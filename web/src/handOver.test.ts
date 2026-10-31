import { describe, expect, it } from 'vitest'
import { handOverUnit } from './handOver'
import type { Team } from './types'

const team = (leadSessionId: string | undefined, parts: Team['parts'] = []): Team => ({
  id: 't1',
  name: 'pray',
  cwd: 'C:\\pray',
  groupId: 'g1',
  x: 0,
  y: 0,
  leadSessionId,
  desks: {},
  parts,
  partOf: {},
  createdAt: '2026-11-01T00:00:00.000Z',
})
const part = (leadSessionId: string | undefined) => ({ id: 'p1', name: 'api', leadSessionId, createdAt: '2026-11-01T00:00:00.000Z' })
const lead = { id: 's1', role: 'lead' as const, teamId: 't1', partId: null, contextTokens: 150_000 }

describe('handOverUnit', () => {
  it('shows for the current lead at the warn level', () => {
    expect(handOverUnit(lead, [team('s1')])).toEqual({ teamId: 't1', partId: null })
  })

  it('shows for the current part lead with its part', () => {
    expect(handOverUnit({ ...lead, partId: 'p1' }, [team('other', [part('s1')])])).toEqual({ teamId: 't1', partId: 'p1' })
  })

  it('hides below the warn level or when the size is unknown', () => {
    expect(handOverUnit({ ...lead, contextTokens: 149_999 }, [team('s1')])).toBeNull()
    expect(handOverUnit({ ...lead, contextTokens: null }, [team('s1')])).toBeNull()
    expect(handOverUnit({ ...lead, contextTokens: undefined }, [team('s1')])).toBeNull()
  })

  it('hides for members, sessions outside a team and leads already replaced', () => {
    expect(handOverUnit({ ...lead, role: 'member' }, [team('s1')])).toBeNull()
    expect(handOverUnit({ ...lead, teamId: null }, [team('s1')])).toBeNull()
    expect(handOverUnit(lead, [team('s2')])).toBeNull()
    expect(handOverUnit(lead, [])).toBeNull()
    expect(handOverUnit({ ...lead, partId: 'p1' }, [team('s1', [part('s2')])])).toBeNull()
    expect(handOverUnit({ ...lead, partId: 'gone' }, [team('s1')])).toBeNull()
  })
})
