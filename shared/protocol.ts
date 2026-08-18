/**
 * shared/protocol.ts —— 客户端 ↔ Worker 的 WS 消息协议（M2）
 * 序列化约定：牌用 JSON 安全的 {r, s}（与 shared/engine/types.ts 的 Card 一致）。
 */

export interface WireCard {
  r: number
  s: number
}

/** 客户端 → 服务端 */
export type ClientMsg =
  | { v: 1; t: 'call'; d: { call: boolean } }
  | { v: 1; t: 'play'; d: { cards: WireCard[] } }
  | { v: 1; t: 'pass'; d: Record<string, never> }

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
  | { v: 1; t: 'state'; d: GameStateForPlayer }
  | { v: 1; t: 'settle'; d: SettleMsg }
  | { v: 1; t: 'error'; d: { message: string } }
  | { v: 1; t: 'info'; d: { message: string } }

/** 心跳（服务端主动发，客户端不回也可） */
export const HEARTBEAT_INTERVAL_MS = 25_000
