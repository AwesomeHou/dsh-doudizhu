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
export const PROTOCOL_VERSION = 1

/** 应用版本（须与根 package.json version 同步） */
export const APP_VERSION = '0.2.0'

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

/** 客户端 → 服务端 */
export type ClientMsg =
  | { v: typeof PROTOCOL_VERSION; t: 'call'; d: { call: boolean } }
  | { v: typeof PROTOCOL_VERSION; t: 'play'; d: { cards: WireCard[] } }
  | { v: typeof PROTOCOL_VERSION; t: 'pass'; d: Record<string, never> }
  | { v: typeof PROTOCOL_VERSION; t: 'ping'; d: { ts: number } }

/** 服务端 → 客户端：给某个玩家的个性化对局状态 */
export interface GameStateForPlayer {
  phase: 'calling' | 'playing' | 'settled'
  seat: number
  hand: WireCard[]                 // 只有自己能看到
  bottom: WireCard[]               // 地主确认后可见
  landlord: number | null
  current: number
  callOrder: number[]
  callActor: number
  callMultiplier: number
  lastPlayCards: WireCard[] | null
  lastActor: number | null
  multiplier: number
  bombCount: number
  spring: 'none' | 'landlord' | 'farmer'
  /** 每座：手牌数、角色、昵称等 */
  seats: Array<{
    seat: number
    uid: string
    nickname: string
    avatarId: string
    count: number
    role: 'landlord' | 'farmer' | null
    connected: boolean
    tokenBalance: number
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
