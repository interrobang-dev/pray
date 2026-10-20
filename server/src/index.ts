import express from 'express'
import type { Response } from 'express'
import { applyHook, type HookPayload, type HookState } from './hookState.js'
import { listSessions } from './sessions.js'

const PORT = 4710
const hookStates = new Map<string, HookState>()
const subscribers = new Set<Response>()

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/api/sessions', async (_req, res) => {
  res.json(await listSessions(hookStates))
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
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()
  subscribers.add(res)
  req.on('close', () => subscribers.delete(res))
  void broadcast()
})

async function broadcast() {
  if (subscribers.size === 0) return
  const data = JSON.stringify(await listSessions(hookStates))
  for (const res of subscribers) res.write(`event: sessions\ndata: ${data}\n\n`)
}

setInterval(() => void broadcast(), 5000)

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jk-corp server http://127.0.0.1:${PORT}`)
})
