import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Response } from 'express'
import type { HostMessage } from '@jk-corp/host/protocol'
import { addRoom, readOffice, setSeat, updateRoom, type Seat } from '@jk-corp/host/hq'
import { setupFileLog } from '@jk-corp/host/runtime'
import { applyHook, type HookPayload, type HookState } from './hookState.js'
import { findTranscript, listSessions, projectsDir } from './sessions.js'
import { HostClient } from './hostClient.js'
import { parseMessages } from './messages.js'
import { TranscriptWatcher } from './transcriptWatcher.js'

setupFileLog()
const PORT = 4710
const hookStates = new Map<string, HookState>()
const subscribers = new Set<Response>()
const host = new HostClient()

const app = express()
app.use(express.json({ limit: '1mb' }))

function openSse(res: Response): void {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function snapshotPayload() {
  const webSessions = new Map(host.sessions.map((s) => [s.sessionId, s.cwd]))
  return {
    isHostReachable: host.isReachable,
    sessions: await listSessions(hookStates, webSessions),
  }
}

async function broadcast() {
  if (subscribers.size === 0) return
  const payload = await snapshotPayload()
  for (const res of subscribers) sendSse(res, 'sessions', payload)
}

app.get('/api/sessions', async (_req, res) => {
  res.json(await snapshotPayload())
})

app.post('/api/sessions', (req, res) => {
  const { cwd, prompt } = req.body as { cwd?: string; prompt?: string }
  if (!cwd) {
    res.status(400).json({ message: 'cwd 필요' })
    return
  }
  const sessionId = randomUUID()
  if (!host.send({ type: 'spawn', sessionId, cwd, prompt: prompt || undefined })) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  res.json({ sessionId })
})

app.get('/api/sessions/:id/messages', async (req, res) => {
  const jsonl = await findTranscript(req.params.id)
  res.json(jsonl ? parseMessages(jsonl) : [])
})

app.delete('/api/sessions/:id', (req, res) => {
  host.send({ type: 'kill', sessionId: req.params.id })
  res.json({})
})

app.post('/api/sessions/:id/input', (req, res) => {
  const { data } = req.body as { data?: string }
  if (typeof data !== 'string') {
    res.status(400).end()
    return
  }
  host.send({ type: 'input', sessionId: req.params.id, data })
  res.json({})
})

app.post('/api/sessions/:id/resize', (req, res) => {
  const { cols, rows } = req.body as { cols?: number; rows?: number }
  if (typeof cols !== 'number' || typeof rows !== 'number') {
    res.status(400).end()
    return
  }
  host.send({ type: 'resize', sessionId: req.params.id, cols, rows })
  res.json({})
})

app.get('/api/sessions/:id/stream', (req, res) => {
  const sessionId = req.params.id
  openSse(res)
  const onMessage = (message: HostMessage) => {
    if (!('sessionId' in message) || message.sessionId !== sessionId) return
    if (message.type === 'snapshot' || message.type === 'output') sendSse(res, message.type, message.data)
    if (message.type === 'exit') sendSse(res, 'exit', message.exitCode)
    if (message.type === 'error') sendSse(res, 'error', message.message)
  }
  host.on('message', onMessage)
  req.on('close', () => host.off('message', onMessage))
  if (!host.send({ type: 'attach', sessionId })) sendSse(res, 'error', '세션 호스트에 연결되지 않음')
})

function broadcastOffice(): void {
  const office = readOffice()
  for (const res of subscribers) sendSse(res, 'office', office)
}

app.get('/api/office', (_req, res) => {
  res.json(readOffice())
})

app.post('/api/rooms', (req, res) => {
  const { name } = req.body as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ message: '이름 필요' })
    return
  }
  res.json(addRoom(name.trim()))
  broadcastOffice()
})

app.patch('/api/rooms/:id', (req, res) => {
  const room = updateRoom(req.params.id, req.body as { name?: string; waitingNote?: string })
  if (!room) {
    res.status(404).end()
    return
  }
  res.json(room)
  broadcastOffice()
})

app.put('/api/seats/:sessionId', (req, res) => {
  const seat = req.body as Seat
  if (typeof seat?.roomId !== 'string' || typeof seat.x !== 'number' || typeof seat.y !== 'number') {
    res.status(400).end()
    return
  }
  setSeat(req.params.sessionId, { roomId: seat.roomId, x: seat.x, y: seat.y, label: seat.label })
  res.json({})
  broadcastOffice()
})

app.post('/api/hook', (req, res) => {
  const payload = req.body as HookPayload
  if (!payload?.session_id || !payload.hook_event_name) {
    res.status(400).end()
    return
  }
  const next = applyHook(hookStates.get(payload.session_id), payload)
  if (next) hookStates.set(payload.session_id, next)
  res.json({})
  void broadcast()
})

app.get('/api/events', (req, res) => {
  openSse(res)
  subscribers.add(res)
  req.on('close', () => subscribers.delete(res))
  void broadcast()
})

host.on('reachable', () => void broadcast())
host.on('message', (message: HostMessage) => {
  if (message.type === 'sessions' || message.type === 'exit') void broadcast()
})
host.start()

const watcher = new TranscriptWatcher(projectsDir)
watcher.on('change', (sessionId: string) => {
  for (const res of subscribers) sendSse(res, 'transcript', { sessionId })
})

setInterval(() => void broadcast(), 5000)

// 빌드된 웹이 있으면 서버 하나로 화면까지 제공한다 (개발 중에는 Vite 4711 을 쓴다)
const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')))
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jk-corp server http://127.0.0.1:${PORT}`)
})
