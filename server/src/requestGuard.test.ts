import { describe, expect, it } from 'vitest'
import { isAllowedHost, isLoopbackUrl, isSameOriginRequest } from './requestGuard.js'

const MACHINE = 'DESKTOP-ABC'

describe('isAllowedHost', () => {
  it('accepts IP addresses, localhost and this PC name with or without a port', () => {
    expect(isAllowedHost('127.0.0.1:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('127.0.0.1', MACHINE)).toBe(true)
    expect(isAllowedHost('192.168.60.21:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('[::1]:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('[fe80::1234:5678]:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('[::ffff:127.0.0.1]:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('localhost:4711', MACHINE)).toBe(true)
    expect(isAllowedHost('LocalHost:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('desktop-abc:4710', MACHINE)).toBe(true)
    expect(isAllowedHost('DESKTOP-ABC', MACHINE)).toBe(true)
  })

  it('rejects domain names (DNS rebinding) and malformed hosts', () => {
    expect(isAllowedHost('evil.com:4710', MACHINE)).toBe(false)
    expect(isAllowedHost('127.0.0.1.evil.com:4710', MACHINE)).toBe(false)
    expect(isAllowedHost('localhost.:4710', MACHINE)).toBe(false)
    expect(isAllowedHost('localhost.evil.com', MACHINE)).toBe(false)
    expect(isAllowedHost('desktop-abc.evil.com:4710', MACHINE)).toBe(false)
    expect(isAllowedHost('other-pc:4710', MACHINE)).toBe(false)
    expect(isAllowedHost('evil.com@127.0.0.1', MACHINE)).toBe(false)
    expect(isAllowedHost('127.0.0.1/x', MACHINE)).toBe(false)
    expect(isAllowedHost('::1', MACHINE)).toBe(false)
    expect(isAllowedHost('[::1', MACHINE)).toBe(false)
    expect(isAllowedHost('', MACHINE)).toBe(false)
    expect(isAllowedHost(undefined, MACHINE)).toBe(false)
  })
})

describe('isSameOriginRequest', () => {
  it('passes requests without Origin (hooks, mod, MCP, curl)', () => {
    expect(isSameOriginRequest(undefined, '127.0.0.1:4710')).toBe(true)
  })

  it('accepts the same host and port', () => {
    expect(isSameOriginRequest('http://127.0.0.1:4710', '127.0.0.1:4710')).toBe(true)
    expect(isSameOriginRequest('http://192.168.60.21:4710', '192.168.60.21:4710')).toBe(true)
    expect(isSameOriginRequest('http://desktop-abc:4710', 'DESKTOP-ABC:4710')).toBe(true)
    // 기본 포트는 Origin·Host 어느 쪽에 적혀도 같다
    expect(isSameOriginRequest('http://192.168.60.21', '192.168.60.21:80')).toBe(true)
  })

  it('accepts loopback to loopback on another port (Vite 4711 proxy)', () => {
    expect(isSameOriginRequest('http://localhost:4711', '127.0.0.1:4710')).toBe(true)
    expect(isSameOriginRequest('http://[::1]:4711', 'localhost:4710')).toBe(true)
  })

  it('rejects other sites, other ports off loopback, null and junk', () => {
    expect(isSameOriginRequest('https://evil.com', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('http://evil.com:4710', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('http://192.168.60.21:4711', '192.168.60.21:4710')).toBe(false)
    expect(isSameOriginRequest('http://192.168.60.22:4710', '192.168.60.21:4710')).toBe(false)
    expect(isSameOriginRequest('http://localhost:4711', '192.168.60.21:4710')).toBe(false)
    expect(isSameOriginRequest('http://192.168.60.21:4710', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('null', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('file://', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('', '127.0.0.1:4710')).toBe(false)
    expect(isSameOriginRequest('http://127.0.0.1:4710', undefined)).toBe(false)
  })
})

describe('isLoopbackUrl', () => {
  it('checks only the name of http(s) URLs', () => {
    expect(isLoopbackUrl('http://127.0.0.1:4710/x')).toBe(true)
    expect(isLoopbackUrl('https://LOCALHOST')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:4711')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackUrl('ftp://127.0.0.1')).toBe(false)
    expect(isLoopbackUrl('null')).toBe(false)
  })
})
