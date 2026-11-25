import { describe, expect, it } from 'vitest'
import { machineRows, parseMachines, selfMachine, switchTargets, unavailableReason, type Machine, type MachinesResponse } from './machines'

function machine(overrides: Partial<Machine> = {}): Machine {
  return { name: 'home', hostName: 'home.tail.ts.net', url: 'http://home.tail.ts.net:4710', isSelf: false, isOnline: true, hasPray: true, ...overrides }
}

const office = machine({ name: 'office', hostName: 'office.tail.ts.net', url: 'http://office.tail.ts.net:4710', isSelf: true })

function response(machines: Machine[], tailscale: MachinesResponse['tailscale'] = 'ready'): MachinesResponse {
  return { tailscale, machines }
}

describe('parseMachines', () => {
  it('reads a valid response', () => {
    expect(parseMachines({ tailscale: 'ready', machines: [office] })).toEqual(response([office]))
  })

  it('rejects other shapes (old server answers with index.html or nothing)', () => {
    expect(parseMachines(null)).toBeNull()
    expect(parseMachines('<html>')).toBeNull()
    expect(parseMachines({ tailscale: 'ready' })).toBeNull()
    expect(parseMachines({ tailscale: 'weird', machines: [] })).toBeNull()
  })

  it('drops a malformed machine and keeps the rest', () => {
    const parsed = parseMachines({ tailscale: 'ready', machines: [office, { name: 'x' }, { ...machine(), url: 5 }] })
    expect(parsed?.machines).toEqual([office])
  })

  it('treats an empty url as no address', () => {
    expect(parseMachines({ tailscale: 'ready', machines: [{ ...machine(), url: '' }] })?.machines[0].url).toBeNull()
  })
})

describe('selfMachine', () => {
  it('is the self machine only when tailscale is ready', () => {
    expect(selfMachine(response([machine(), office]))).toEqual(office)
    expect(selfMachine(response([office], 'stopped'))).toBeNull()
    expect(selfMachine(response([machine()]))).toBeNull()
    expect(selfMachine(null)).toBeNull()
  })
})

describe('unavailableReason', () => {
  it('says why a machine cannot be opened, offline first', () => {
    expect(unavailableReason(machine())).toBeNull()
    expect(unavailableReason(machine({ isOnline: false, hasPray: false }))).toBe('Offline')
    expect(unavailableReason(machine({ hasPray: false }))).toBe('Pray not running')
    expect(unavailableReason(machine({ url: null }))).toBe('No address')
  })
})

describe('machineRows', () => {
  it('puts self first, then available by name, then unavailable (online first) by name', () => {
    const rows = machineRows(
      response([
        office,
        machine({ name: 'zeta', isOnline: false }),
        machine({ name: 's26', hasPray: false }),
        machine({ name: 'laptop' }),
        machine({ name: 'Home' }),
        machine({ name: 'alpha', isOnline: false }),
      ]),
    )
    expect(rows.map((row) => [row.machine.name, row.isCurrent, row.disabledReason])).toEqual([
      ['office', true, null],
      ['Home', false, null],
      ['laptop', false, null],
      ['s26', false, 'Pray not running'],
      ['alpha', false, 'Offline'],
      ['zeta', false, 'Offline'],
    ])
  })

  it('is empty when the chip is hidden', () => {
    expect(machineRows(response([office, machine()], 'not-installed'))).toEqual([])
    expect(machineRows(null)).toEqual([])
  })
})

describe('switchTargets', () => {
  it('keeps only other machines that can be opened', () => {
    const targets = switchTargets(response([office, machine({ name: 's26', hasPray: false }), machine({ name: 'home' }), machine({ name: 'nas', url: null })]))
    expect(targets.map((target) => target.name)).toEqual(['home'])
  })

  it('is empty when tailscale is not ready', () => {
    expect(switchTargets(response([office, machine()], 'error'))).toEqual([])
  })
})
