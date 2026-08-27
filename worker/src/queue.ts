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
/**
 * Queue DO 本地映射（强一致）：与 KV 同步写，供"匹配后轮询/重复匹配"强一致兜底。
 * 因为 KV 是最终一致，房间刚创建时另一个真人立刻轮询可能读不到 roomuid，
 * 会误返回 count=0 → 客户端以为没匹配上 → 取消/重匹配 → 开出第二桌（两人不同桌）。
 */
const uidRoomDOKey = (uid: string) => `douid:${uid}`
/** 房间元数据 2 小时过期（避免对局未结算就永远残留） */
const ROOM_TTL_SECONDS = 7200
/** 队列条目视为过期的时长（进入后 3 分钟未凑满则作废） */
const QUEUE_STALE_MS = 3 * 60_000
/** 真人凑不齐时的补位等待：超过该时长（15s）则用机器人垫满 3 人开局 */
const BOT_FILL_MS = 15_000
/**
 * 补位宽限：已到 15s 但最近 2s 内刚有新真人加入（很可能是结伴匹配）时再多等一会儿，
 * 避免把几乎同时加入的两个真人拆到两桌（一个被补位带走、另一个单独开局）。
 */
const BOT_FILL_GRACE_MS = 2_000

/**
 * 机器人昵称池：模拟真人取名习惯（无“机器人/AI/Bot”字样），头像二选一。
 */
const BOT_NAMES = [
  '清风徐来', '晚风轻语', '南山南', '一壶清茶', '夜未央', '拾光者', '北辰星', '云深不知处',
  '江南烟雨', '半盏流年', '听风说雨', '岁月静好', '薄荷微凉', '指尖流沙', '故里草木', '月光倾城',
  '白鹿青崖', '孤舟蓑笠', '长安故里', '墨染青衣', '星河入梦', '小桥流水', '红叶煮酒', '枕边书',
  '南巷清风', '北城旧梦', '山有木兮', '灯火阑珊', '云开月明', '拾壹月', '风起长林', '悠然自得',
] as const

function botEntry(aroundBalance: number): QueueEntry {
  return {
    uid: 'bot:' + crypto.randomUUID(),
    nickname: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!,
    avatarId: Math.random() < 0.5 ? 'default-01' : 'default-02',
    // 机器人 Token 与真人平均余额接近（±20%），避免“机器人富得离谱”穿帮
    tokenBalance: Math.round(Math.max(1, aroundBalance) * (0.8 + Math.random() * 0.4)),
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
    const body = await request.json().catch(() => ({})) as { uid?: string; entry?: QueueEntry; uids?: string[] }
    try {
      // 关键：Durable Object 在 await 处会让出事件循环，并发请求会在 tryCreateRoom 的
      // KV await 间隙交错执行，导致两个真人同时轮询时读同一队列、各自开一桌。
      // blockConcurrencyWhile 把整个"读-判-写-开桌"包成原子段，杜绝重复开桌/拆散两人。
      switch (action) {
        case 'join': {
          const entry = body.entry as QueueEntry
          if (!entry?.uid) return Response.json({ error: 'missing entry' }, { status: 400 })
          const result = await this.state.blockConcurrencyWhile(() => this.join(entry))
          return Response.json(result)
        }
        case 'forceBot': {
          // 直接进入机器人对局：把玩家移出普通队列，立即用「本玩家 + 2 机器人」开局
          const entry = body.entry as QueueEntry
          if (!entry?.uid) return Response.json({ error: 'missing entry' }, { status: 400 })
          const result = await this.state.blockConcurrencyWhile(async () => {
            let queue = await this.load()
            queue = queue.filter((e) => e.uid !== entry.uid)
            await this.save(queue)
            return this.forceBotRoom(entry)
          })
          return Response.json(result)
        }
        case 'leave': {
          await this.state.blockConcurrencyWhile(() => body.uid ? this.leave(body.uid) : Promise.resolve())
          return Response.json({ ok: true })
        }
        case 'clear': {
          // 对局结算/清理时抹掉 DO 本地强一致映射（避免残留映射让玩家在下一局被"认回"旧房间）
          const uids = Array.isArray(body?.uids) ? body.uids as string[] : []
          await this.state.blockConcurrencyWhile(async () => {
            for (const uid of uids) await this.state.storage.delete(uidRoomDOKey(uid))
          })
          return Response.json({ ok: true })
        }
        case 'status': {
          const result = await this.state.blockConcurrencyWhile(() => this.status(body.uid))
          return Response.json(result)
        }
        default:
          return Response.json({ error: 'unknown action' }, { status: 400 })
      }
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'queue error' }, { status: 500 })
    }
  }

  /** 轮询状态（在 blockConcurrencyWhile 原子段内执行） */
  private async status(uid?: string): Promise<JoinResult> {
    // 轮询时顺便检查是否到 15s 补位（真人凑不齐 → 机器人垫满开局）
    const matched = await this.tryCreateRoom(await this.load())
    if (matched) return matched
    const queue = await this.load()
    // 强一致兜底：玩家不在队列里，但刚被创建房间匹配进了（KV roomuid 可能尚未
    // 传播），用 DO 本地映射返回其房间，避免误报 count=0 导致客户端取消/重匹配。
    if (uid && !queue.some((e) => e.uid === uid)) {
      const rid = await this.state.storage.get<string>(uidRoomDOKey(uid))
      if (rid && (await this.env.KVPUBLIC.get(roomKey(rid)))) {
        return { status: 'matched', roomId: rid }
      }
      // 房间元数据已清理（已结算/超时）→ 抹掉残留映射，正常按未匹配处理
      if (rid) {
        await this.state.storage.delete(uidRoomDOKey(uid))
        await this.env.KVPUBLIC.delete(uidRoomKey(uid))
      }
    }
    const count = uid ? queue.some((e) => e.uid === uid) : false
    return { status: 'waiting', count: count ? queue.length : 0 }
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
    // 防"二次开桌"：该真人若已有一个未结算的活跃房间（断线/误操作重复点匹配），
    // 直接回到原房间，而不是再开一桌 → 否则两人被拆成两场、原房间留下"幽灵座位"。
    const existingRoomId = await this.state.storage.get<string>(uidRoomDOKey(entry.uid))
      ?? await this.env.KVPUBLIC.get(uidRoomKey(entry.uid))
    if (existingRoomId) {
      const metaRaw = await this.env.KVPUBLIC.get(roomKey(existingRoomId))
      if (metaRaw) return { status: 'matched', roomId: existingRoomId }
      // 原房间元数据已清理（已结算/超时）→ 抹掉残留映射，按正常入队处理
      await this.state.storage.delete(uidRoomDOKey(entry.uid))
      await this.env.KVPUBLIC.delete(uidRoomKey(entry.uid))
    }
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
   * 真人不足 3 人时用机器人垫满（模拟真人：真实感昵称 + 接近真人余额）。
   */
  private async tryCreateRoom(queue: QueueEntry[]): Promise<JoinResult | null> {
    if (queue.length === 0) return null
    const oldest = Math.min(...queue.map((e) => e.joinedAt))
    const newest = Math.max(...queue.map((e) => e.joinedAt))
    const waited = Date.now() - oldest >= BOT_FILL_MS
    if (queue.length < 3 && !waited) return null
    // 补位宽限：已到 15s，但最近 2s 内刚有人加入（可能是结伴一起点的匹配）→ 再等等，
    // 避免把几乎同时加入的两个真人拆到两桌（第一个被补位带走，第二个单独开局）。
    if (queue.length < 3 && Date.now() - newest < BOT_FILL_GRACE_MS) return null
    const trio = queue.slice(0, 3)
    const rest = queue.slice(3)
    const result = await this.buildRoom(trio)
    await this.save(rest)
    return result
  }

  /**
   * 直接进入机器人对局：本玩家 + 2 个机器人立即开局（不占用普通匹配队列）。
   * 若该玩家已有活跃房间（断线/重复点击），回到原房间。
   */
  private async forceBotRoom(player: QueueEntry): Promise<JoinResult> {
    const existingRoomId = await this.state.storage.get<string>(uidRoomDOKey(player.uid))
      ?? await this.env.KVPUBLIC.get(uidRoomKey(player.uid))
    if (existingRoomId) {
      const metaRaw = await this.env.KVPUBLIC.get(roomKey(existingRoomId))
      if (metaRaw) return { status: 'matched', roomId: existingRoomId }
      // 原房间元数据已清理 → 抹掉残留映射，按正常开机器人局处理
      await this.state.storage.delete(uidRoomDOKey(player.uid))
      await this.env.KVPUBLIC.delete(uidRoomKey(player.uid))
    }
    // 只带本玩家建房，buildRoom 会用机器人垫满剩余 2 席
    return this.buildRoom([player])
  }

  /** 创建房间（原子段内执行）：写 KV room/uid 映射 + DO 本地强一致映射；机器人余额贴近真人 */
  private async buildRoom(players: QueueEntry[]): Promise<JoinResult> {
    const trio = players.slice(0, 3)
    const realPlayers = trio.filter((e) => !e.uid.startsWith('bot:'))
    const avgRealBalance = realPlayers.length > 0
      ? realPlayers.reduce((sum, e) => sum + e.tokenBalance, 0) / realPlayers.length
      : 0
    // 机器人余额以真人平均余额为基准（±20%），避免"机器人富得离谱"穿帮
    while (trio.length < 3) trio.push(botEntry(avgRealBalance))
    const tableId = this.tableId
    const roomId = crypto.randomUUID()
    const roomMeta: RoomMeta = {
      id: roomId,
      tableId,
      base: tableById(tableId)?.base ?? 15,
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
      // DO 本地强一致映射：房间刚创建时另一个真人立刻轮询也能命中，避免 KV 最终一致
      // 读到旧值返回 count=0 → 客户端取消/重匹配 → 两人被拆成两桌。
      // 运行时支持 expirationTtl，但该版本类型声明缺失，做一次精确断言。
      await this.state.storage.put(
        uidRoomDOKey(p.uid), roomId,
        { expirationTtl: ROOM_TTL_SECONDS } as unknown as DurableObjectPutOptions,
      )
    }
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

/** 直接进入机器人对局：移出普通队列，立即用「本玩家 + 2 机器人」开局 */
export function forceBotQueue(env: Env, tableId: string, entry: QueueEntry): Promise<JoinResult> {
  return call(stub(env, tableId), 'forceBot', { entry })
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
  // 先读 room meta（拿到 tableId），再清理 KV
  const meta = await getRoomMeta(env, roomId)
  await env.KVPUBLIC.delete(roomKey(roomId))
  for (const uid of uids) await env.KVPUBLIC.delete(uidRoomKey(uid))
  // 同时清理 Queue DO 本地的强一致映射（防止下局"认回"旧房间）
  if (meta) {
    try {
      await call(stub(env, meta.tableId), 'clear', { uids })
    } catch { /* 清理失败不影响主流程 */ }
  }
}
