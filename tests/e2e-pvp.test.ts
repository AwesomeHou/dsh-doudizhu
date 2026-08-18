/**
 * M2 端到端测试：3 个客户端连上本地 wrangler dev，打完整局 PVP，校验账目守恒。
 * 运行：npm run test:e2e （需先启动：cd worker && npx wrangler dev --port 8787）
 */
import { describe, expect, it } from 'vitest'
import { botCall, botMove } from '../shared/engine/bot.ts'
import { classify, type Play } from '../shared/engine/valid.ts'
import type { Card } from '../shared/engine/types.ts'

const BASE = process.env.DDZ_API ?? 'http://127.0.0.1:8787'
const WS_BASE = BASE.replace(/^http/, 'ws')

async function api(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`
  const res = await fetch(BASE + path, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function auth(uid: string): Promise<string> {
  const r = await api('/api/auth', { method: 'POST', body: JSON.stringify({ uid }) }) as { token: string }
  return r.token
}

function uid(): string {
  return crypto.randomUUID()
}

interface Client {
  seat: number
  ws: WebSocket
  settled: unknown
}

function openClient(roomId: string, token: string): Promise<{ ws: WebSocket; seat: number; initialState: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/room/${roomId}?token=${token}`)
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 10_000)
    ws.addEventListener('open', () => {
      const onFirst = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data))
        if (msg.t === 'state') {
          clearTimeout(timer)
          ws.removeEventListener('message', onFirst)
          resolve({ ws, seat: msg.d.seat, initialState: msg.d })
        }
      }
      ws.addEventListener('message', onFirst)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')) })
  })
}

function actOnState(client: { ws: WebSocket; seat: number }, s: Record<string, unknown>): void {
  if (s.finished || s.current !== client.seat) return
  if (s.phase === 'calling') {
    const call = botCall(s.hand as Card[])
    console.log(`[client ${client.seat}] call=${call}`)
    client.ws.send(JSON.stringify({ v: 1, t: 'call', d: { call } }))
  } else {
    const last = (s.lastPlayCards && (s.lastPlayCards as Card[]).length > 0)
      ? classify(s.lastPlayCards as Card[]) as Play
      : null
    const move = botMove(s.hand as Card[], last)
    client.ws.send(move === null
      ? JSON.stringify({ v: 1, t: 'pass', d: {} })
      : JSON.stringify({ v: 1, t: 'play', d: { cards: move } }))
  }
}

function drive(client: { ws: WebSocket; seat: number }, initialState: unknown, onSettle: (d: unknown) => void): void {
  // 处理打开时收到的初始 state（否则会丢失第一个回合）
  actOnState(client, initialState as Record<string, unknown>)
  client.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.t === 'settle') {
      onSettle(msg.d)
      return
    }
    if (msg.t === 'error') {
      throw new Error(`server error: ${JSON.stringify(msg.d)}`)
    }
    if (msg.t === 'state') {
      actOnState(client, msg.d)
    }
  })
}

describe('M2 PVP 端到端（需 wrangler dev 在 :8787）', () => {
  it('3 人匹配 → 完整对局 → 账目守恒', async () => {
    const players = [uid(), uid(), uid()]
    const tokens: string[] = []
    for (const p of players) {
      const t = await auth(p)
      tokens.push(t)
      await api('/api/daily', { method: 'POST', token: t })
    }
    // 匹配
    let roomId = ''
    for (const t of tokens) {
      const r = await api('/api/lobby/queue', { method: 'POST', token: t, body: JSON.stringify({ tableId: 'novice' }) }) as { status: string; roomId?: string }
      if (r.status === 'matched' && r.roomId) roomId = r.roomId
    }
    expect(roomId).toBeTruthy()

    // 连接并驱动
    const clients: Client[] = []
    const settles: unknown[] = []
    for (const t of tokens) {
      const c = await openClient(roomId, t)
      clients.push({ ...c, settled: null })
      drive({ ws: c.ws, seat: c.seat }, c.initialState, (d) => settles.push(d))
    }
    expect(new Set(clients.map((c) => c.seat)).size).toBe(3)

    // 等待结算（最多 60s）
    const deadline = Date.now() + 60_000
    while (settles.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }
    for (const c of clients) c.ws.close()
    if (settles.length < 3) {
      // 调试：dump 服务器房间状态
      const debug = await fetch(`${BASE}/api/room/${roomId}/debug`).then((r) => r.json()).catch(() => null)
      console.log('ROOM DEBUG:', JSON.stringify(debug))
    }

    expect(settles.length).toBe(3)
    const ds = settles as Array<{ myDelta: number; rake: number; balance_after: number }>
    const sum = ds.reduce((a, b) => a + b.myDelta, 0)
    const rake = ds[0]!.rake
    // 三方净变化之和 + 抽水 = 0（账目守恒）
    expect(sum + rake).toBe(0)
    // 余额非负
    for (const d of ds) expect(d.balance_after).toBeGreaterThanOrEqual(0)
  }, 150_000)
})
