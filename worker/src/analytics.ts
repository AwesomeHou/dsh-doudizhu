/**
 * worker/src/analytics.ts —— 埋点 ingest + Admin 报表（M2 初版：明细落 D1，报表实时聚合）
 */

export interface AnalyticsEvent {
  event: string
  uid?: string | null
  ts?: number
  props?: Record<string, unknown>
  event_id?: string
}

/** 批量写入埋点事件（幂等：event_id 唯一约束，重复插入被忽略） */
export async function ingestAnalytics(env: { DB: D1Database }, events: AnalyticsEvent[]): Promise<number> {
  if (!Array.isArray(events) || events.length === 0) return 0
  const now = Date.now()
  const stmts: D1PreparedStatement[] = []
  let inserted = 0
  for (const e of events) {
    if (!e || typeof e.event !== 'string' || !e.event) continue
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO analytics_events (event, uid, ts, props, event_id, server_ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        e.event.slice(0, 64),
        e.uid ?? null,
        e.ts ?? now,
        e.props ? JSON.stringify(e.props).slice(0, 2000) : null,
        e.event_id ?? `${now}-${Math.random().toString(36).slice(2, 10)}`,
        now,
      ),
    )
    inserted++
  }
  if (stmts.length > 0) await env.DB.batch(stmts)
  return inserted
}

export interface AdminStats {
  since: number
  days: number
  dau: number
  matches: number
  events: Record<string, number>
  players: number
  tokenCirculation: number
}

/** Admin 报表：最近 N 天关键指标（实时聚合，数据量小时够用） */
export async function adminStats(env: { DB: D1Database }, days = 7): Promise<AdminStats> {
  const since = Date.now() - days * 24 * 3600 * 1000
  const eventsRes = await env.DB.prepare(
    'SELECT event, COUNT(*) AS c FROM analytics_events WHERE server_ts >= ?1 GROUP BY event',
  ).bind(since).all<{ event: string; c: number }>()
  const matchesRes = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches WHERE finished_at >= ?1').bind(since).first<{ c: number }>()
  const dauRes = await env.DB.prepare(
    'SELECT COUNT(DISTINCT uid) AS c FROM analytics_events WHERE server_ts >= ?1 AND uid IS NOT NULL',
  ).bind(since).first<{ c: number }>()
  const playersRes = await env.DB.prepare('SELECT COUNT(*) AS c FROM players').first<{ c: number }>()
  const circRes = await env.DB.prepare('SELECT COALESCE(SUM(balance), 0) AS c FROM players').first<{ c: number }>()

  const events: Record<string, number> = {}
  for (const r of (eventsRes.results ?? [])) events[r.event] = Number(r.c)
  return {
    since,
    days,
    dau: Number(dauRes?.c ?? 0),
    matches: Number(matchesRes?.c ?? 0),
    events,
    players: Number(playersRes?.c ?? 0),
    tokenCirculation: Number(circRes?.c ?? 0),
  }
}
