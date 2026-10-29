import { isIP } from 'node:net'

/**
 * 요청 머리 판정 (DNS rebinding·CSRF 막기, 순수 함수). index.ts 의 미들웨어와 저장 API 의 `isLocalPageRequest`(workspaceSave.ts)가 쓴다
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Host 머리 꼴: 이름 또는 `[IPv6]`, 그 뒤 `:포트`. URL 해석 전에 걸러 `a@b`·경로 같은 것이 hostname 을 바꾸지 못하게 한다 */
const HOST_HEADER = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i

/** Host 머리를 URL 로 (hostname 소문자, IPv4 는 점 네 칸으로 맞춰진다, 기본 포트 80 은 빠진다). 없거나 꼴이 틀리면 null */
function parseHost(value: string | undefined): URL | null {
  if (!value || !HOST_HEADER.test(value)) return null
  try {
    return new URL(`http://${value}`)
  } catch {
    return null
  }
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** http(s) 주소의 이름이 loopback(127.0.0.1·localhost·[::1])인지. 포트는 보지 않는다 */
export function isLoopbackUrl(value: string): boolean {
  const url = parseHttpUrl(value)
  return url !== null && LOOPBACK_HOSTNAMES.has(url.hostname)
}

/**
 * Host 머리의 이름이 IP 숫자 주소·`localhost`·이 PC 이름(대소문자 무시)인지 (DNS rebinding 막기).
 * rebinding 은 공격 사이트의 도메인 이름을 127.0.0.1 로 풀어 쓰므로 Host 가 그 도메인 이름이 된다. `localhost.` 처럼 끝에 점이 붙은 이름도 거절한다
 */
export function isAllowedHost(host: string | undefined, machineName: string): boolean {
  const url = parseHost(host)
  if (!url) return false
  const hostname = url.hostname
  if (isIP(hostname.replace(/^\[(.*)\]$/, '$1')) !== 0) return true
  return hostname === 'localhost' || hostname === machineName.toLowerCase()
}

/**
 * 쓰기 요청(GET·HEAD·OPTIONS 밖)이 같은 출처에서 왔는지 (CSRF 막기). Origin 이 없으면 통과 — 훅·mod·MCP·curl 처럼 브라우저가 아닌 쪽은 보내지 않는다.
 * `null`(sandbox·file: 등)은 거절. 있으면 그 host:port 가 Host 와 같아야 하고, 둘 다 loopback 이름이면 포트·이름이 달라도 된다 —
 * Vite 개발 서버(4711)는 proxy 가 Host 를 `127.0.0.1:4710` 으로 바꾸고(문자열 proxy 는 changeOrigin) Origin 은 `http://localhost:4711` 그대로 넘긴다
 */
export function isSameOriginRequest(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true
  const source = parseHttpUrl(origin)
  const target = parseHost(host)
  if (!source || !target) return false
  if (source.host === target.host) return true
  return LOOPBACK_HOSTNAMES.has(source.hostname) && LOOPBACK_HOSTNAMES.has(target.hostname)
}
