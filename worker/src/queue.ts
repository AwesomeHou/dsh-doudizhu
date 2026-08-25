/**
 * worker/src/queue.ts —— 匹配队列（Durable Object，原子化，避免并发加入互相覆盖）
 *
 * 每个桌别一个 Queue DO 实例（idFromName('queue:<tableId>')），单实例串行处理请求，
 * 读改写天然原子：三人同时点匹配不会丢人。
 *
 * 房间元数据仍写 KV（供 Room DO / worker 读取），带 TTL 自动清理。
 */
import { tableById } from '../../shared/config.ts'
import type { Env, QueueEntry, RoomMeta } from './types.ts'

const roomKey = (roomId: string) => `room:${roomId}`
const uidRoomKey = (uid: string) => `roomuid:${uid}`
/** 房间元数据 2 小时过期（避免对局未结算就永远残留） */
const ROOM_TTL_SECONDS = 7200
/** 队列条目视为过期的时长（进入后 3 分钟未凑满则作废） */
const QUEUE_STALE_MS = 3 * 60_000
/** 真人凑不齐时的补位等待：超过该时长（15s）则用机器人垫满 3 人开局 */
const BOT_FILL_MS = 15_000

/**
 * 机器人昵称池：模拟真人取名习惯（无“机器人/AI/Bot”字样），头像二选一。
 */
const BOT_NAMES = [
  '清风徐来', '晚风轻语', '南山南', '一壶清茶', '夜未央', '拾光者', '北辰星', '云深不知处',
  '江南烟雨', '半盏流年', '听风说雨', '岁月静好', '薄荷微凉', '指尖流沙', '故里草木', '月光倾城',
  '白鹿青崖', '孤舟蓑笠', '长安故里', '墨染青衣', '星河入梦', '小桥流水', '红叶煮酒', '枕边书',
  '南巷清风', '北城旧梦', '山有木兮', '灯火阑珊', '云开月明', '拾壹月', '风起长林', '悠然自得',
] as const

function botEntry(): QueueEntry {
  return {
    uid: 'bot:' + crypto.randomUUID(),
    nickname: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!,
    avatarId: Math.random() < 0.5 ? 'default-01' : 'default-02',
    // 固定大余额：模拟长期玩牌攒下家底的真人，避免被当作新手
    tokenBalance: 8_000_000 + Math.floor(Math.random() * 12_000_000),
    joinedAt: Date.now(),
  }
}

export type JoinResult =
  | { status: 'waiting'; count: number }
  | { status: 'matched'; roomId: string }

/** 匹配队列 Durable Object（每个桌别一个实例） */
export class Queue {
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    const body = await request.json().catch(() => ({})) as { uid?: string; entry?: QueueEntry }
    try {
      switch (action) {
        case 'join': {
          const entry = body.entry as QueueEntry
          if (!entry?.uid) return Response.json({ error: 'missing entry' }, { status: 400 })
          const result = await this.join(entry)
          return Response.json(result)
        }
        case 'leave': {
          if (body.uid) await this.leave(body.uid)
          return Response.json({ ok: true })
        }
        case 'status': {
          // 轮询时顺便检查是否到 15s 补位（真人凑不齐 → 机器人垫满开局）
          const matched = await this.tryCreateRoom(await this.load())
          if (matched) return Response.json(matched)
          const queue = await this.load()
          const count = body.uid ? queue.some((e) => e.uid === body.uid) : false
          return Response.json({ status: 'waiting', count: count ? queue.length : 0 })
        }
        default:
          return Response.json({ error: 'unknown action' }, { status: 400 })
      }
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'queue error' }, { status: 500 })
    }
  }

  /** 桌别 id（来自 DO 实例名 queue:<tableId>） */
  private get tableId(): string {
    return this.state.id.name?.slice('queue:'.length) ?? ''
  }

  private async load(): Promise<QueueEntry[]> {
    const raw = await this.state.storage.get<QueueEntry[]>('queue')
    if (!raw) return []
    const now = Date.now()
    return raw.filter((e) => now - e.joinedAt <= QUEUE_STALE_MS)
  }

  private async save(queue: QueueEntry[]): Promise<void> {
    await this.state.storage.put('queue', queue)
  }

  private async join(entry: QueueEntry): Promise<JoinResult> {
    let queue = await this.load()
    queue = queue.filter((e) => e.uid !== entry.uid)
    queue.push(entry)
    const matched = await this.tryCreateRoom(queue)
    if (matched) return matched
    await this.save(queue)
    return { status: 'waiting', count: queue.length }
  }

  /**
   * 满足开局条件（够 3 人，或已等待 ≥ BOT_FILL_MS）时创建房间；不足则返回 null。
   * 真人不足 3 人时用机器人垫满（模拟真人：真实感昵称 + 大余额）。
   */
  private async tryCreateRoom(queue: QueueEntry[]): Promise<JoinResult | null> {
    if (queue.length === 0) return null
    const oldest = Math.min(...queue.map((e) => e.joinedAt))
    const waited = Date.now() - oldest >= BOT_FILL_MS
    if (queue.length < 3 && !waited) return null
    const trio = queue.slice(0, 3)
    const rest = queue.slice(3)
    while (trio.length < 3) trio.push(botEntry())
    const tableId = this.tableId
    const roomId = crypto.randomUUID()
    const roomMeta: RoomMeta = {
      id: roomId,
      tableId,
      base: tableById(tableId)?.base ?? 10_000,
      createdAt: Date.now(),
      players: trio.map((e, i) => ({
        uid: e.uid,
        seat: i as RoomMeta['players'][number]['seat'],
        nickname: e.nickname,
        avatarId: e.avatarId,
        tokenBalance: e.tokenBalance,
      })),
    }
    await this.env.KVPUBLIC.put(roomKey(roomId), JSON.stringify(roomMeta), { expirationTtl: ROOM_TTL_SECONDS })
    // 只有真人写 uid→room 映射（机器人无需重连/轮询）
    for (const p of roomMeta.players) {
      if (p.uid.startsWith('bot:')) continue
      await this.env.KVPUBLIC.put(uidRoomKey(p.uid), roomId, { expirationTtl: ROOM_TTL_SECONDS })
    }
    await this.save(rest)
    return { status: 'matched', roomId }
  }

  private async leave(uid: string): Promise<void> {
    const queue = (await this.load()).filter((e) => e.uid !== uid)
    await this.save(queue)
  }
}

// ---- Worker 侧调用封装 ----

function stub(env: Env, tableId: string) {
  return env.QUEUE.get(env.QUEUE.idFromName('queue:' + tableId))
}

async function call<T>(stub: DurableObjectStub, action: string, payload: unknown): Promise<T> {
  const res = await stub.fetch(new Request(`http://queue/?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  return res.json() as T
}

/** 加入匹配队列；满 3 人时创建房间并返回 roomId */
export function joinQueue(env: Env, tableId: string, entry: QueueEntry): Promise<JoinResult> {
  return call(stub(env, tableId), 'join', { entry })
}

export function leaveQueue(env: Env, tableId: string, uid: string): Promise<{ ok: true }> {
  return call(stub(env, tableId), 'leave', { uid })
}

/** 轮询：是否已被匹配进房间 */
export async function pollStatus(env: Env, tableId: string, uid: string): Promise<JoinResult> {
  const roomId = await env.KVPUBLIC.get(uidRoomKey(uid))
  if (roomId) return { status: 'matched', roomId }
  return call(stub(env, tableId), 'status', { uid })
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
