/**
 * shared/protocol.ts —— 客户端 ↔ Worker 的 WS 消息协议（M2）
 * 序列化约定：牌用 JSON 安全的 {r, s}（与 shared/engine/types.ts 的 Card 一致）。
 *
 * 版本约定（在线对战兼容性）：
 * - PROTOCOL_VERSION：线上协议/规则版本。**破坏性变更（改消息格式、规则、结算）必须 +1**，
 *   并同时：改这里 → 重新部署 worker → 重建并提交 lib → 发版。所有玩家客户端协议必须与服务器一致。
 * - APP_VERSION：应用（插件）版本，须与根 package.json 的 version 保持一致。
 */

/** 线上协议版本（服务端与所有在线客户端必须一致） */
export const PROTOCOL_VERSION = 2

/** 应用版本（须与根 package.json version 同步） */
export const APP_VERSION = '0.3.0'

/** 服务器 /api/health 返回的版本信息，客户端据此做兼容性检查 */
export interface HealthInfo {
  ok: boolean
  service: string
  version: string
  protocol: number
}

export interface WireCard {
  r: number
  s: number
}

/** 对局阶段（与 shared/engine/types.ts 的 Phase 一致） */
export type WirePhase = 'dealing' | 'calling' | 'robbing' | 'doubling' | 'playing' | 'settled'

/** 客户端 → 服务端 */
export type ClientMsg =
  | { v: typeof PROTOCOL_VERSION; t: 'call'; d: { call: boolean } }
  | { v: typeof PROTOCOL_VERSION; t: 'double'; d: { choice: 0 | 1 | 2 } }
  | { v: typeof PROTOCOL_VERSION; t: 'ming'; d: Record<string, never> }
  | { v: typeof PROTOCOL_VERSION; t: 'play'; d: { cards: WireCard[] } }
  | { v: typeof PROTOCOL_VERSION; t: 'pass'; d: Record<string, never> }
  | { v: typeof PROTOCOL_VERSION; t: 'ping'; d: { ts: number } }

/** 服务端 → 客户端：给某个玩家的个性化对局状态 */
export interface GameStateForPlayer {
  phase: WirePhase
  seat: number
  hand: WireCard[]                 // 只有自己能看到
  bottom: WireCard[]               // 出牌阶段（地主确认后）可见
  landlord: number | null          // 叫/抢阶段为当前最高叫分者，出牌阶段才最终确定
  hasCalled: boolean               // 叫地主阶段是否已经有人叫过
  current: number
  callOrder: number[]
  callActor: number
  callMultiplier: number
  /** 首个叫地主的人（抢地主最后回到他那里再选择） */
  callerSeat: number | null
  robOrder: number[]
  robActor: number
  doublingOrder: number[]
  doublingActor: number
  /** 每座加倍选择：0=不加倍 1=加倍 2=超级加倍 */
  doubled: number[]
  /** 每座是否明牌 */
  revealed: boolean[]
  /** 发牌进度：0=未发，1..3=已发轮数 */
  dealRound: number
  lastPlayCards: WireCard[] | null
  lastActor: number | null
  multiplier: number
  bombCount: number
  /** 地主已出牌组数（=0 时地主可明牌，即第一轮出牌） */
  landlordPlays: number
  spring: 'none' | 'landlord' | 'farmer'
  /** 每座：手牌数、角色、昵称等；明牌座位的完整手牌在 hand 中下发 */
  seats: Array<{
    seat: number
    uid: string
    nickname: string
    avatarId: string
    count: number
    role: 'landlord' | 'farmer' | null
    connected: boolean
    tokenBalance: number
    /** 该座位明牌时下发完整手牌（否则 null） */
    hand: WireCard[] | null
  }>
  turnStartedAt: number            // 用于客户端倒计时
  turnTimeoutMs: number
  finished: boolean
  winner: 'landlord' | 'farmer' | null
}

export interface SettleMsg {
  winner: 'landlord' | 'farmer'
  spring: string
  multiplier: number
  rake: number
  myDelta: number
  balance: number
  balance_after: number
}

export type ServerMsg =
  | { v: typeof PROTOCOL_VERSION; t: 'state'; d: GameStateForPlayer }
  | { v: typeof PROTOCOL_VERSION; t: 'settle'; d: SettleMsg }
  | { v: typeof PROTOCOL_VERSION; t: 'error'; d: { message: string } }
  | { v: typeof PROTOCOL_VERSION; t: 'info'; d: { message: string } }
  | { v: typeof PROTOCOL_VERSION; t: 'pong'; d: { ts: number } }

/** 心跳（服务端主动发，客户端不回也可） */
export const HEARTBEAT_INTERVAL_MS = 25_000
