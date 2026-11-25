import type { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  buildMachines,
  findTailscale,
  machineUrl,
  parseTailscaleStatus,
  probePray,
  readTailscaleStatus,
  selfHostNames,
  Tailscale,
  type TailscaleStatus,
} from './tailscale.js'

const SAMPLE = {
  BackendState: 'Running',
  MagicDNSSuffix: 'tailda52be.ts.net',
  CurrentTailnet: { MagicDNSSuffix: 'tailda52be.ts.net', MagicDNSEnabled: true },
  Self: { HostName: 'DESKTOP-R7FM8CI', DNSName: 'office.tailda52be.ts.net.', TailscaleIPs: ['100.89.244.81', 'fd7a:115c:a1e0::2348:f452'], OS: 'windows', Online: true },
  Peer: {
    'nodekey:b': { HostName: '준기의 S26', DNSName: 's26.tailda52be.ts.net.', TailscaleIPs: ['fd7a:115c:a1e0::9648:c54c', '100.101.197.75'], OS: 'android', Online: false },
    'nodekey:a': { HostName: 'DESKTOP-U8JGUV7', DNSName: 'home.tailda52be.ts.net.', TailscaleIPs: ['100.105.169.121'], OS: 'windows', Online: true },
  },
}

describe('parseTailscaleStatus', () => {
  it('reads self, peers and MagicDNS', () => {
    const status = parseTailscaleStatus(SAMPLE)
    expect(status.state).toBe('ready')
    expect(status.isMagicDnsEnabled).toBe(true)
    expect(status.self).toEqual({ name: 'office', hostName: 'DESKTOP-R7FM8CI', dnsName: 'office.tailda52be.ts.net', ipv4: '100.89.244.81', os: 'windows', isOnline: true })
    expect(status.peers).toContainEqual({ name: 's26', hostName: '준기의 S26', dnsName: 's26.tailda52be.ts.net', ipv4: '100.101.197.75', os: 'android', isOnline: false })
  })

  it('treats anything but Running as stopped and junk as error', () => {
    expect(parseTailscaleStatus({ BackendState: 'Stopped' }).state).toBe('stopped')
    expect(parseTailscaleStatus({ BackendState: 'NeedsLogin', Self: SAMPLE.Self }).self).toBeNull()
    expect(parseTailscaleStatus(null).state).toBe('error')
    expect(parseTailscaleStatus('x').state).toBe('error')
  })

  it('falls back to the OS host name without a DNS name and skips nameless nodes', () => {
    const status = parseTailscaleStatus({ BackendState: 'Running', Self: { HostName: 'PC', TailscaleIPs: [] }, Peer: { x: {}, y: null } })
    expect(status.self).toMatchObject({ name: 'PC', dnsName: null, ipv4: null, isOnline: false })
    expect(status.peers).toEqual([])
    expect(status.isMagicDnsEnabled).toBe(false)
  })
})

describe('selfHostNames', () => {
  it('gives the full MagicDNS name and its first label in lower case', () => {
    expect(selfHostNames(parseTailscaleStatus(SAMPLE))).toEqual(['office.tailda52be.ts.net', 'office'])
    const upper = parseTailscaleStatus({ ...SAMPLE, Self: { ...SAMPLE.Self, DNSName: 'Office.TailDA52BE.ts.net.' } })
    expect(selfHostNames(upper)).toEqual(['office.tailda52be.ts.net', 'office'])
  })

  it('is empty when not ready or without a DNS name', () => {
    expect(selfHostNames(parseTailscaleStatus({ BackendState: 'Stopped' }))).toEqual([])
    expect(selfHostNames(parseTailscaleStatus({ BackendState: 'Running', Self: { HostName: 'PC' } }))).toEqual([])
  })
})

describe('machineUrl', () => {
  const node = { name: 'home', hostName: 'H', dnsName: 'home.t.ts.net', ipv4: '100.1.2.3', os: 'windows', isOnline: true }
  it('uses the MagicDNS name when enabled, else IPv4, else null', () => {
    expect(machineUrl(node, true, 4710)).toBe('http://home.t.ts.net:4710')
    expect(machineUrl(node, false, 4710)).toBe('http://100.1.2.3:4710')
    expect(machineUrl({ ...node, dnsName: null }, true, 4710)).toBe('http://100.1.2.3:4710')
    expect(machineUrl({ ...node, ipv4: null }, false, 4710)).toBeNull()
  })
})

describe('buildMachines', () => {
  it('puts this PC first and sorts the rest by name', () => {
    const payload = buildMachines(parseTailscaleStatus(SAMPLE), new Set(['100.105.169.121', '100.101.197.75']), 4710)
    expect(payload).toEqual({
      tailscale: 'ready',
      machines: [
        { name: 'office', hostName: 'DESKTOP-R7FM8CI', url: 'http://office.tailda52be.ts.net:4710', isSelf: true, isOnline: true, hasPray: true },
        { name: 'home', hostName: 'DESKTOP-U8JGUV7', url: 'http://home.tailda52be.ts.net:4710', isSelf: false, isOnline: true, hasPray: true },
        // 꺼진 기기는 probe 결과가 있어도 hasPray false
        { name: 's26', hostName: '준기의 S26', url: 'http://s26.tailda52be.ts.net:4710', isSelf: false, isOnline: false, hasPray: false },
      ],
    })
  })

  it('returns no machines unless ready', () => {
    expect(buildMachines({ state: 'stopped', isMagicDnsEnabled: false, self: null, peers: [] }, new Set(), 4710)).toEqual({ tailscale: 'stopped', machines: [] })
  })
})

describe('findTailscale', () => {
  it('prefers Program Files and falls back to PATH', () => {
    expect(findTailscale({ ProgramFiles: 'C:\\Program Files' }, () => true)).toBe('C:\\Program Files\\Tailscale\\tailscale.exe')
    expect(findTailscale({ ProgramFiles: 'C:\\Program Files' }, () => false)).toBe('tailscale')
    expect(findTailscale({}, () => true)).toBe('tailscale')
  })
})

function fakeRun(error: Partial<NodeJS.ErrnoException> | null, stdout: string, stderr = '') {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  const run = ((command: string, args: string[], options: Record<string, unknown>, callback: (e: unknown, out: string, err: string) => void) => {
    calls.push({ command, args, options })
    callback(error ? Object.assign(new Error('failed'), error) : null, stdout, stderr)
  }) as unknown as typeof execFile
  return { run, calls }
}

describe('readTailscaleStatus', () => {
  it('runs only status --json without a shell', async () => {
    const { run, calls } = fakeRun(null, JSON.stringify(SAMPLE))
    expect((await readTailscaleStatus(run, 'ts.exe')).state).toBe('ready')
    expect(calls).toEqual([{ command: 'ts.exe', args: ['status', '--json'], options: expect.objectContaining({ timeout: 5000, windowsHide: true }) }])
    expect(calls[0].options.shell).toBeUndefined()
  })

  it('maps failures to not-installed, stopped and error', async () => {
    expect((await readTailscaleStatus(fakeRun({ code: 'ENOENT' }, '').run, 'x')).state).toBe('not-installed')
    expect((await readTailscaleStatus(fakeRun({ code: 1 } as never, '', 'failed to connect to local Tailscale service; is Tailscale running?').run, 'x')).state).toBe('stopped')
    expect((await readTailscaleStatus(fakeRun({ code: 1 } as never, JSON.stringify({ BackendState: 'Stopped' })).run, 'x')).state).toBe('stopped')
    expect((await readTailscaleStatus(fakeRun({ killed: true } as never, '').run, 'x')).state).toBe('error')
    expect((await readTailscaleStatus(fakeRun(null, '{broken').run, 'x')).state).toBe('error')
  })
})

describe('probePray', () => {
  const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  it('is true only for a Pray auth/me answer', async () => {
    expect(await probePray('100.1.2.3', 4710, respond({ app: 'pray', isAuthenticated: false }))).toBe(true)
    expect(await probePray('100.1.2.3', 4710, respond({ isAuthenticated: false }))).toBe(false)
    expect(await probePray('100.1.2.3', 4710, respond({ app: 'pray' }, 500))).toBe(false)
    expect(await probePray('100.1.2.3', 4710, (async () => new Response('<html>')) as unknown as typeof fetch)).toBe(false)
    expect(await probePray('100.1.2.3', 4710, (async () => { throw new Error('refused') }) as unknown as typeof fetch)).toBe(false)
  })

  it('asks the IP on the given port', async () => {
    const urls: string[] = []
    await probePray('100.1.2.3', 4710, (async (url: string) => { urls.push(url); return new Response('{}') }) as unknown as typeof fetch)
    expect(urls).toEqual(['http://100.1.2.3:4710/api/auth/me'])
  })
})

describe('Tailscale', () => {
  it('probes online peers only, caches for 30s and shares one in-flight read', async () => {
    let time = 0
    let reads = 0
    const probed: string[] = []
    const tailscale = new Tailscale(4710, {
      now: () => time,
      readStatus: async () => {
        reads++
        return parseTailscaleStatus(SAMPLE)
      },
      probe: async (ip) => {
        probed.push(ip)
        return ip === '100.105.169.121'
      },
    })
    const [a, b] = await Promise.all([tailscale.machines(), tailscale.machines()])
    expect(a).toBe(b)
    expect(reads).toBe(1)
    expect(probed).toEqual(['100.105.169.121'])
    expect(a.machines.map((m) => [m.name, m.hasPray])).toEqual([['office', true], ['home', true], ['s26', false]])
    time = 29_999
    await tailscale.machines()
    await tailscale.status()
    expect(reads).toBe(1)
    time = 30_000
    await tailscale.machines()
    expect(reads).toBe(2)
    expect(probed).toHaveLength(2)
  })

  it('does not probe when tailscale is not ready', async () => {
    const stopped: TailscaleStatus = { state: 'not-installed', isMagicDnsEnabled: false, self: null, peers: [] }
    const tailscale = new Tailscale(4710, { readStatus: async () => stopped, probe: async () => { throw new Error('no') } })
    expect(await tailscale.machines()).toEqual({ tailscale: 'not-installed', machines: [] })
  })
})
