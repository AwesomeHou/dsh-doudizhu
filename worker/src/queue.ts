/**
 * worker/src/queue.ts —— 匹配（KV 队列按桌别凑 3 人开局）
 * 说明：KV 的读改写非原子，小规模 beta 够用；并发高峰可后续换 Durable Object 队列。
 * 卫生：队列/房间条目都带 TTL，加入前清理过期条目，避免「幽灵玩家」占座。
 */
import { tableById } from '../../shared/config.ts'
import type { Env, QueueEntry, RoomMeta } from './types.ts'

const queueKey = (tableId: string) => `queue:${tableId}`
const roomKey = (roomId: string) => `room:${roomId}`
const uidRoomKey = (uid: string) => `roomuid:${uid}`

/** 队列条目 5 分钟过期（玩家中途离开后自动清理） */
const QUEUE_TTL_SECONDS = 300
/** 读取时认为过期的队列条目时长 */
const QUEUE_STALE_MS = 3 * 60_000
/** 房间元数据 2 小时过期（避免对局未结算就永远残留） */
const ROOM_TTL_SECONDS = 7200

async function readQueue(env: Env, tableId: string): Promise<QueueEntry[]> {
  const raw = await env.KVPUBLIC.get(queueKey(tableId))
  if (!raw) return []
  try {
    const now = Date.now()
    return (JSON.parse(raw) as QueueEntry[]).filter((e) => now - e.joinedAt <= QUEUE_STALE_MS)
  } catch {
    return []
  }
}

async function writeQueue(env: Env, tableId: string, queue: QueueEntry[]): Promise<void> {
  await env.KVPUBLIC.put(queueKey(tableId), JSON.stringify(queue), { expirationTtl: QUEUE_TTL_SECONDS })
}

export type JoinResult =
  | { status: 'waiting'; count: number }
  | { status: 'matched'; roomId: string }

/** 加入匹配队列；满 3 人时创建房间并返回 roomId（创建者即第三人） */
export async function joinQueue(env: Env, tableId: string, entry: QueueEntry): Promise<JoinResult> {
  let queue = await readQueue(env, tableId)
  queue = queue.filter((e) => e.uid !== entry.uid)
  queue.push(entry)
  if (queue.length < 3) {
    await writeQueue(env, tableId, queue)
    return { status: 'waiting', count: queue.length }
  }
  const trio = queue.slice(0, 3)
  const rest = queue.slice(3)
  const base = tableById(tableId)?.base ?? 10_000
  const roomId = crypto.randomUUID()
  const roomMeta: RoomMeta = {
    id: roomId,
    tableId,
    base,
    createdAt: Date.now(),
    players: trio.map((e, i) => ({
      uid: e.uid,
      seat: i as RoomMeta['players'][number]['seat'],
      nickname: e.nickname,
      avatarId: e.avatarId,
      tokenBalance: e.tokenBalance,
    })),
  }
  await env.KVPUBLIC.put(roomKey(roomId), JSON.stringify(roomMeta), { expirationTtl: ROOM_TTL_SECONDS })
  for (const p of roomMeta.players) {
    await env.KVPUBLIC.put(uidRoomKey(p.uid), roomId, { expirationTtl: ROOM_TTL_SECONDS })
  }
  await writeQueue(env, tableId, rest)
  return { status: 'matched', roomId }
}

export async function leaveQueue(env: Env, tableId: string, uid: string): Promise<void> {
  const queue = (await readQueue(env, tableId)).filter((e) => e.uid !== uid)
  await writeQueue(env, tableId, queue)
}

/** 轮询：是否已被匹配进房间 */
export async function pollStatus(env: Env, tableId: string, uid: string): Promise<JoinResult> {
  const roomId = await env.KVPUBLIC.get(uidRoomKey(uid))
  if (roomId) return { status: 'matched', roomId }
  const queue = await readQueue(env, tableId)
  const count = queue.some((e) => e.uid === uid) ? queue.length : 0
  return { status: 'waiting', count }
}

export async function getRoomMeta(env: Env, roomId: string): Promise<RoomMeta | null> {
  const raw = await env.KVPUBLIC.get(roomKey(roomId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as RoomMeta
  } catch {
    return null
  }
}

export async function clearRoom(env: Env, roomId: string, uids: string[]): Promise<void> {
  await env.KVPUBLIC.delete(roomKey(roomId))
  for (const uid of uids) await env.KVPUBLIC.delete(uidRoomKey(uid))
}
