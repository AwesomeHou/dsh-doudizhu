/**
 * dsh-doudizhu Worker 入口（M2）
 * REST：身份/资料/签到/流水/匹配/埋点/Admin
 * WS：/ws/room/:id 升级到 Durable Object Room（服务端权威对局）
 */
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { rankForBalance, tableById, CONFIG } from '../../shared/config.ts'
import { APP_VERSION, PROTOCOL_VERSION } from '../../shared/protocol.ts'
import { verifyToken, signToken, bearerToken, type AuthPayload } from './auth.ts'
import { addLedger, getLedger, getPlayer, hasClaimed, hasRescued, insertClaim, insertRescue, updateProfile, upsertPlayer, type PlayerRow } from './db.ts'
import { joinQueue, leaveQueue, pollStatus, getRoomMeta, clearRoom } from './queue.ts'
import { ingestAnalytics, adminStats, type AnalyticsEvent } from './analytics.ts'
import type { Env } from './types.ts'

/** Durable Object 需从入口导出 */
export { Room } from './room.ts'
export { Queue } from './queue.ts'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

/** UTC+8 自然日 'YYYY-MM-DD' */
function dayKeyUTC8(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function limitNickname(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return Array.from(s).slice(0, 12).join('') || '斗地主玩家'
}

function validAvatar(id: unknown): string {
  return id === 'default-01' || id === 'default-02' ? id : 'default-01'
}

async function auth(c: Context<{ Bindings: Env }>): Promise<AuthPayload> {
  const token = bearerToken(c.req.header('Authorization'))
  const payload = await verifyToken(c.env.AUTH_SECRET, token)
  if (!payload) throw new Error('unauthorized')
  return payload
}

function fail(c: { json: (o: unknown, s?: number) => Response }, status: number, message: string): Response {
  return c.json({ error: message }, status)
}

app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'dsh-doudizhu',
  version: APP_VERSION,
  protocol: PROTOCOL_VERSION,
  ts: Date.now(),
}))

// ---- 匿名身份 ----
app.post('/api/auth', async (c) => {
  const body = await c.req.json().catch(() => null)
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  if (!uid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
    return fail(c, 400, 'invalid uid')
  }
  const player = await upsertPlayer(c.env, uid, limitNickname(undefined), 'default-01')
  const token = await signToken(c.env.AUTH_SECRET, uid)
  return c.json({ token, player: await publicPlayer(c.env, player) })
})

app.get('/api/me', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const player = await getPlayer(c.env, payload.uid)
  if (!player) return fail(c, 404, 'player not found')
  return c.json({ player: await publicPlayer(c.env, player) })
})

app.put('/api/me/profile', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const body = await c.req.json().catch(() => null)
  const nickname = limitNickname(body?.nickname)
  const avatarId = validAvatar(body?.avatarId)
  await updateProfile(c.env, payload.uid, nickname, avatarId)
  const player = await getPlayer(c.env, payload.uid)
  return c.json({ player: await publicPlayer(c.env, player!) })
})

// ---- 签到 / 流水 ----
app.post('/api/daily', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const day = dayKeyUTC8()
  if (await hasClaimed(c.env, payload.uid, day)) {
    return fail(c, 409, 'already claimed today')
  }
  const amount = 200_000
  await insertClaim(c.env, payload.uid, day, amount)
  const balance = await addLedger(c.env, payload.uid, 'daily', amount, `daily:${day}`)
  return c.json({ amount, balance })
})

app.get('/api/ledger', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200)
  const ledger = await getLedger(c.env, payload.uid, limit)
  return c.json({ ledger })
})

// ---- 破产救济 ----
app.post('/api/rescue', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const player = await getPlayer(c.env, payload.uid)
  if (!player) return fail(c, 404, 'player not found')
  const minBalance = Math.min(...CONFIG.tables.map((t) => t.minBalance))
  if (player.balance >= minBalance) return fail(c, 403, 'balance not low enough')
  const day = dayKeyUTC8()
  if (await hasRescued(c.env, payload.uid, day)) return fail(c, 409, 'already rescued today')
  const amount = CONFIG.rescueTokens
  await insertRescue(c.env, payload.uid, day, amount)
  const balance = await addLedger(c.env, payload.uid, 'rescue', amount, `rescue:${day}`)
  return c.json({ amount, balance })
})

// ---- 匹配 ----
app.post('/api/lobby/queue', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const body = await c.req.json().catch(() => null)
  const tableId = typeof body?.tableId === 'string' ? body.tableId : ''
  const table = tableById(tableId)
  if (!table) return fail(c, 400, 'unknown table')
  const player = await getPlayer(c.env, payload.uid)
  if (!player) return fail(c, 404, 'player not found')
  if (player.balance < table.minBalance) return fail(c, 403, 'balance below table minimum')
  const result = await joinQueue(c.env, tableId, {
    uid: player.uid,
    nickname: player.nickname,
    avatarId: player.avatar_id,
    tokenBalance: player.balance,
    joinedAt: Date.now(),
  })
  return c.json(result)
})

app.delete('/api/lobby/queue', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const body = await c.req.json().catch(() => null)
  await leaveQueue(c.env, String(body?.tableId ?? ''), payload.uid)
  return c.json({ ok: true })
})

app.get('/api/lobby/status', async (c) => {
  let payload: AuthPayload
  try { payload = await auth(c) } catch { return fail(c, 401, 'unauthorized') }
  const tableId = String(c.req.query('tableId') ?? '')
  const result = await pollStatus(c.env, tableId, payload.uid)
  return c.json(result)
})

app.get('/api/room/:id', async (c) => {
  const meta = await getRoomMeta(c.env, c.req.param('id'))
  if (!meta) return fail(c, 404, 'room not found')
  return c.json(meta)
})

// 调试：查看房间 DO 内部状态（M2 排查用，后续可移除或加鉴权）
app.get('/api/room/:id/debug', async (c) => {
  const id = c.env.ROOM.idFromName(c.req.param('id'))
  const url = new URL(c.req.url)
  url.searchParams.set('debug', '1')
  return c.env.ROOM.get(id).fetch(new Request(url.toString()))
})

// ---- WebSocket 对局（升级到 Room DO）----
app.get('/ws/room/:id', async (c) => {
  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') return c.text('expected websocket', 426)
  // 浏览器无法给 WS 升级请求带自定义 header → token 走查询参数
  const token = bearerToken(c.req.header('Authorization')) ?? c.req.query('token')
  const payload = await verifyToken(c.env.AUTH_SECRET, token)
  if (!payload) return fail(c, 401, 'unauthorized')
  // 在线对战协议版本一致性：客户端须与服务端一致（不一致返回 426）
  const protoParam = c.req.query('protocol')
  if (protoParam !== null && Number(protoParam) !== PROTOCOL_VERSION) {
    return fail(c, 426, `protocol version mismatch: server=${PROTOCOL_VERSION}, client=${protoParam}`)
  }
  const roomId = c.req.param('id')
  const meta = await getRoomMeta(c.env, roomId)
  if (!meta) return fail(c, 404, 'room not found')
  const seat = meta.players.find((p) => p.uid === payload.uid)?.seat
  if (seat === undefined) return fail(c, 403, 'not in this room')

  const url = new URL(c.req.url)
  url.search = ''
  url.searchParams.set('uid', payload.uid)
  url.searchParams.set('seat', String(seat))
  const forward = new Request(url.toString(), c.req.raw)
  const id = c.env.ROOM.idFromName(roomId)
  return c.env.ROOM.get(id).fetch(forward)
})

// ---- 埋点 / Admin ----
app.post('/api/analytics', async (c) => {
  const key = bearerToken(c.req.header('Authorization'))
  if (!key || key !== c.env.ANALYTICS_INGEST_KEY) return fail(c, 401, 'bad ingest key')
  const body = await c.req.json().catch(() => null)
  const events = Array.isArray(body?.events) ? body.events as AnalyticsEvent[] : []
  const inserted = await ingestAnalytics(c.env, events)
  return c.json({ ok: true, inserted })
})

app.get('/api/admin/stats', async (c) => {
  const key = bearerToken(c.req.header('Authorization'))
  if (!key || key !== c.env.ADMIN_KEY) return fail(c, 401, 'bad admin key')
  const days = Math.min(Number(c.req.query('days') ?? 7) || 7, 90)
  const stats = await adminStats(c.env, days)
  return c.json(stats)
})

app.get('/api/admin/rooms/cleanup', async (c) => {
  const key = bearerToken(c.req.header('Authorization'))
  if (!key || key !== c.env.ADMIN_KEY) return fail(c, 401, 'bad admin key')
  // 清理过期房间元数据（可选维护端点）
  return c.json({ ok: true })
})

async function publicPlayer(env: Env, p: PlayerRow) {
  return {
    uid: p.uid,
    nickname: p.nickname,
    avatarId: p.avatar_id,
    balance: p.balance,
    peakBalance: p.peak_balance,
    rank: rankForBalance(p.balance).name,
    rankId: rankForBalance(p.balance).id,
    claimedToday: await hasClaimed(env, p.uid, dayKeyUTC8()),
  }
}

app.onError((err, c) => {
  return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500)
})

export default app
