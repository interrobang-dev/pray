import { describe, expect, it } from 'vitest'
import { openPathAction } from './openPath'

describe('openPathAction', () => {
  it('files: path, line only for files', () => {
    expect(openPathAction(200, { target: 'files', path: 'web/a.ts', isDirectory: false, line: 12 })).toEqual({
      kind: 'files',
      request: { path: 'web/a.ts', line: 12, isDirectory: false },
    })
    expect(openPathAction(200, { target: 'files', path: 'web', isDirectory: true, line: 3 })).toEqual({ kind: 'files', request: { path: 'web', line: null, isDirectory: true } })
    expect(openPathAction(200, { target: 'files', path: '', isDirectory: true, line: null })).toEqual({ kind: 'files', request: { path: '', line: null, isDirectory: true } })
    expect(openPathAction(200, { target: 'files', path: 'a.ts', isDirectory: false, line: 0 })).toMatchObject({ request: { line: null } })
  })

  it('work files and explorer', () => {
    expect(openPathAction(200, { target: 'work-files', path: 'shots/a.png', isDirectory: false })).toEqual({
      kind: 'work-files',
      request: { path: 'shots/a.png', isDirectory: false },
    })
    expect(openPathAction(200, { target: 'explorer' })).toEqual({ kind: 'none' })
  })

  it('another PC outside the session folders copies the path; other errors alert with the server message', () => {
    expect(openPathAction(403, { message: 'Opens only on this PC' })).toEqual({ kind: 'copy' })
    expect(openPathAction(403, { message: 'Cross-site request blocked' })).toEqual({ kind: 'alert', message: "Couldn't open: Cross-site request blocked" })
    expect(openPathAction(404, { message: 'Path not found' })).toEqual({ kind: 'alert', message: "Couldn't open: Path not found" })
    expect(openPathAction(500, null)).toEqual({ kind: 'alert', message: "Couldn't open: HTTP 500" })
  })

  it('an unknown 200 body alerts', () => {
    expect(openPathAction(200, {})).toEqual({ kind: 'alert', message: "Couldn't open: Unexpected response" })
    expect(openPathAction(200, { target: 'files' })).toMatchObject({ kind: 'alert' })
  })
})
