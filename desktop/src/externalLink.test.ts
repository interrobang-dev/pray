import { describe, expect, it } from 'vitest'
import { isExternalUrl, navigationDecision, parseMachines, type PrayMachine } from './externalLink'

const SERVER = 'http://127.0.0.1:4710'

const MACHINES: PrayMachine[] = [
  { name: 'office', hostName: 'DESKTOP-R7FM8CI', url: 'http://office.tailda52be.ts.net:4710', isSelf: true, hasPray: true },
  { name: 'home', hostName: 'DESKTOP-U8JGUV7', url: 'http://home.tailda52be.ts.net:4710', isSelf: false, hasPray: true },
  { name: 'laptop', hostName: 'LAPTOP', url: 'http://laptop.tailda52be.ts.net:4710', isSelf: false, hasPray: false },
  { name: 's26', hostName: 'S26', url: null, isSelf: false, hasPray: true },
]

describe('isExternalUrl', () => {
  it('hands web links to the default browser', () => {
    expect(isExternalUrl('https://github.com/interrobang-dev/pray', SERVER)).toBe(true)
    expect(isExternalUrl('http://example.com/a?b=1', SERVER)).toBe(true)
    expect(isExternalUrl('http://127.0.0.1:4711/', SERVER)).toBe(true)
  })

  it('keeps the Pray server itself in Electron', () => {
    expect(isExternalUrl('http://127.0.0.1:4710/api/sessions/x/image?path=a.png', SERVER)).toBe(false)
    expect(isExternalUrl('http://127.0.0.1:4710/', SERVER)).toBe(false)
  })

  it('keeps Tailscale Pray machines in Electron', () => {
    expect(isExternalUrl('http://home.tailda52be.ts.net:4710/api/sessions/x/image', SERVER, MACHINES)).toBe(false)
    expect(isExternalUrl('http://office.tailda52be.ts.net:4710/', SERVER, MACHINES)).toBe(false)
    expect(isExternalUrl('http://laptop.tailda52be.ts.net:4710/', SERVER, MACHINES)).toBe(true)
    expect(isExternalUrl('http://home.tailda52be.ts.net:8080/', SERVER, MACHINES)).toBe(true)
  })

  it('ignores other protocols and broken URLs', () => {
    expect(isExternalUrl('file:///C:/a.html', SERVER)).toBe(false)
    expect(isExternalUrl('mailto:a@b.c', SERVER)).toBe(false)
    expect(isExternalUrl('javascript:alert(1)', SERVER)).toBe(false)
    expect(isExternalUrl('not a url', SERVER)).toBe(false)
  })
})

describe('navigationDecision', () => {
  it('allows the local server and other Pray machines', () => {
    expect(navigationDecision('http://127.0.0.1:4710/#session=a', SERVER, MACHINES)).toBe('allow')
    expect(navigationDecision('http://127.0.0.1:4710/', SERVER, [])).toBe('allow')
    expect(navigationDecision('http://home.tailda52be.ts.net:4710/', SERVER, MACHINES)).toBe('allow')
    expect(navigationDecision('http://HOME.tailda52be.ts.net:4710/x', SERVER, MACHINES)).toBe('allow')
  })

  it("sends this PC's own Tailscale address back to the local server", () => {
    expect(navigationDecision('http://office.tailda52be.ts.net:4710/#session=a', SERVER, MACHINES)).toBe('self')
    expect(navigationDecision('http://office:4710/', SERVER, MACHINES)).toBe('self')
    expect(navigationDecision('http://desktop-r7fm8ci:4710/', SERVER, MACHINES)).toBe('self')
    expect(navigationDecision('http://office:8080/', SERVER, MACHINES)).toBe('external')
  })

  it('sends everything else to the browser or blocks it', () => {
    expect(navigationDecision('http://laptop.tailda52be.ts.net:4710/', SERVER, MACHINES)).toBe('external')
    expect(navigationDecision('https://evil.ts.net/', SERVER, MACHINES)).toBe('external')
    expect(navigationDecision('http://home.tailda52be.ts.net:4710/', SERVER, [])).toBe('external')
    expect(navigationDecision('http://127.0.0.1:4711/', SERVER, MACHINES)).toBe('external')
    expect(navigationDecision('file:///C:/a.html', SERVER, MACHINES)).toBe('block')
    expect(navigationDecision('javascript:alert(1)', SERVER, MACHINES)).toBe('block')
    expect(navigationDecision('nope', SERVER, MACHINES)).toBe('block')
  })
})

describe('parseMachines', () => {
  it('keeps the fields the tray uses and drops broken rows', () => {
    expect(
      parseMachines({
        tailscale: 'ready',
        machines: [{ name: 'office', hostName: 'PC', url: 'http://office:4710', isSelf: true, isOnline: true, hasPray: true }, { url: 'x' }, null],
      }),
    ).toEqual([{ name: 'office', hostName: 'PC', url: 'http://office:4710', isSelf: true, hasPray: true }])
    expect(parseMachines({ tailscale: 'stopped', machines: [] })).toEqual([])
    expect(parseMachines({ message: 'Login required' })).toBeNull()
    expect(parseMachines(null)).toBeNull()
  })
})
