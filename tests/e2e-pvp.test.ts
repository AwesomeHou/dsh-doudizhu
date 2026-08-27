/**
 * M2 端到端测试：3 个客户端连上本地 wrangler dev，打完整局 PVP，校验账目守恒。
 * 运行：npm run test:e2e （需先启动：cd worker && npx wrangler dev --port 8787）
 */
import { describe, expect, it } from 'vitest'
import { botCall, botDouble, botMove, botRob } from '../shared/engine/bot.ts'
import { classify, type Play } from '../shared/engine/valid.ts'
import type { Card } from '../shared/engine/types.ts'
import { PROTOCOL_VERSION } from '../shared/protocol.ts'

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
    const ws = new WebSocket(`${WS_BASE}/ws/room/${roomId}?token=${token}&protocol=${PROTOCOL_VERSION}`)
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
  if (s.phase === 'dealing') return // 发牌由服务端定时推进
  if (s.phase === 'calling') {
    const call = botCall(s.hand as Card[])
    console.log(`[client ${client.seat}] call=${call}`)
    client.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'call', d: { call } }))
  } else if (s.phase === 'robbing') {
    const rob = botRob(s.hand as Card[])
    console.log(`[client ${client.seat}] rob=${rob}`)
    client.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'call', d: { call: rob } }))
  } else if (s.phase === 'doubling') {
    const choice = botDouble(s.hand as Card[])
    console.log(`[client ${client.seat}] double=${choice}`)
    client.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'double', d: { choice } }))
  } else {
    const last = (s.lastPlayCards && (s.lastPlayCards as Card[]).length > 0)
      ? classify(s.lastPlayCards as Card[]) as Play
      : null
    const move = botMove(s.hand as Card[], last, {
      mySeat: client.seat as 0 | 1 | 2,
      landlord: s.landlord as 0 | 1 | 2 | null,
      lastActor: s.lastActor as 0 | 1 | 2 | null,
      handsCount: (s.seats as Array<{ count: number }>).map((x) => x.count) as [number, number, number],
    })
    client.ws.send(move === null
      ? JSON.stringify({ v: PROTOCOL_VERSION, t: 'pass', d: {} })
      : JSON.stringify({ v: PROTOCOL_VERSION, t: 'play', d: { cards: move } }))
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

  it('两个真人一起匹配 → 必须进同一房间（防拆桌/幽灵座位）', async () => {
    const tokens: string[] = []
    const uids: string[] = []
    for (let i = 0; i < 2; i++) {
      const u = uid()
      uids.push(u)
      const t = await auth(u)
      tokens.push(t)
      await api('/api/daily', { method: 'POST', token: t })
    }
    // 两个真人几乎同时加入同一桌（间隔 < 15s 补位线）
    await api('/api/lobby/queue', { method: 'POST', token: tokens[0], body: JSON.stringify({ tableId: 'novice' }) })
    await new Promise((r) => setTimeout(r, 300))
    await api('/api/lobby/queue', { method: 'POST', token: tokens[1], body: JSON.stringify({ tableId: 'novice' }) })

    // 各自轮询直到匹配，必须拿到同一个 roomId
    const rooms: string[] = []
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline && rooms.length < 2) {
      const statuses = await Promise.all(tokens.map((t) => api(`/api/lobby/status?tableId=novice&_=${Date.now()}`, { token: t })))
      for (let i = 0; i < 2; i++) {
        const s = statuses[i] as { status: string; roomId?: string }
        if (s.status === 'matched' && s.roomId && !rooms[i]) rooms[i] = s.roomId
      }
      if (rooms.length < 2) await new Promise((r) => setTimeout(r, 800))
    }
    expect(rooms[0]).toBeTruthy()
    expect(rooms[1]).toBeTruthy()
    // 核心断言：两个真人必须在同一房间
    expect(rooms[0]).toBe(rooms[1])

    // 断线托管前先连上验证座位正常
    const clients: Client[] = []
    for (const t of tokens) {
      const c = await openClient(rooms[0]!, t)
      clients.push({ ...c, settled: null })
    }
    expect(new Set(clients.map((c) => c.seat)).size).toBe(2)
    for (const c of clients) c.ws.close()
  }, 60_000)
})
