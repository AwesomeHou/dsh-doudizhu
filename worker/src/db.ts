/**
 * worker/src/db.ts —— D1 数据访问
 */
import type { Env } from './types.ts'

export interface PlayerRow {
  uid: string
  nickname: string
  avatar_id: string
  balance: number
  peak_balance: number
  rank_id: number
  created_at: number
  updated_at: number
}

const PLAYER_COLS = 'uid, nickname, avatar_id, balance, peak_balance, rank_id, created_at, updated_at'

function rowToPlayer(row: Record<string, unknown> | null): PlayerRow | null {
  if (!row) return null
  return {
    uid: String(row.uid),
    nickname: String(row.nickname),
    avatar_id: String(row.avatar_id),
    balance: Number(row.balance),
    peak_balance: Number(row.peak_balance),
    rank_id: Number(row.rank_id),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

export async function getPlayer(env: Env, uid: string): Promise<PlayerRow | null> {
  const res = await env.DB.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE uid = ?1`).bind(uid).first()
  return rowToPlayer(res as Record<string, unknown> | null)
}

export async function upsertPlayer(env: Env, uid: string, nickname: string, avatarId: string): Promise<PlayerRow> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO players (uid, nickname, avatar_id, balance, peak_balance, rank_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, 0, 0, 1, ?4, ?4)
     ON CONFLICT(uid) DO NOTHING`,
  ).bind(uid, nickname, avatarId, now).run()
  return (await getPlayer(env, uid))!
}

export async function updateProfile(env: Env, uid: string, nickname: string, avatarId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE players SET nickname = ?2, avatar_id = ?3, updated_at = ?4 WHERE uid = ?1',
  ).bind(uid, nickname, avatarId, Date.now()).run()
}

/** 追加一笔流水并返回更新后的余额 */
export async function addLedger(env: Env, uid: string, type: string, delta: number, refId: string | null): Promise<number> {
  const result = await env.DB.prepare(
    'UPDATE players SET balance = balance + ?2, peak_balance = MAX(peak_balance, balance + ?2), updated_at = ?4 WHERE uid = ?1',
  ).bind(uid, delta, delta, Date.now()).run()
  if (!result.meta.changes) throw new Error('player not found')
  const row = await getPlayer(env, uid)
  await env.DB.prepare(
    'INSERT INTO token_ledger (uid, type, delta, balance_after, ref_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  ).bind(uid, type, delta, row!.balance, refId ?? null, Date.now()).run()
  return row!.balance
}

export async function getLedger(env: Env, uid: string, limit = 50): Promise<Array<{ type: string; delta: number; balance_after: number; ref_id: string | null; created_at: number }>> {
  const res = await env.DB.prepare(
    'SELECT type, delta, balance_after, ref_id, created_at FROM token_ledger WHERE uid = ?1 ORDER BY id DESC LIMIT ?2',
  ).bind(uid, limit).all()
  return (res.results ?? []).map((r) => ({
    type: String(r.type),
    delta: Number(r.delta),
    balance_after: Number(r.balance_after),
    ref_id: r.ref_id ? String(r.ref_id) : null,
    created_at: Number(r.created_at),
  }))
}

export async function hasClaimed(env: Env, uid: string, day: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM daily_claims WHERE uid = ?1 AND day = ?2').bind(uid, day).first()
  return row !== null
}

export async function insertClaim(env: Env, uid: string, day: string, amount: number): Promise<void> {
  await env.DB.prepare('INSERT INTO daily_claims (uid, day, amount) VALUES (?1, ?2, ?3)').bind(uid, day, amount).run()
}

export async function hasRescued(env: Env, uid: string, day: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM rescue_claims WHERE uid = ?1 AND day = ?2').bind(uid, day).first()
  return row !== null
}

export async function insertRescue(env: Env, uid: string, day: string, amount: number): Promise<void> {
  await env.DB.prepare('INSERT INTO rescue_claims (uid, day, amount) VALUES (?1, ?2, ?3)').bind(uid, day, amount).run()
}

export async function recordMatch(env: Env, m: {
  id: string
  tableId: string
  baseStake: number
  multiplier: number
  rake: number
  players: unknown
  winner: string
}): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO matches (id, table_id, base_stake, multiplier, rake, players, winner, created_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)',
  ).bind(m.id, m.tableId, m.baseStake, m.multiplier, m.rake, JSON.stringify(m.players), m.winner, Date.now()).run()
}
