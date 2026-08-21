/**
 * src/client/table-view.ts —— 统一牌桌视图模型
 * 本地引擎状态（GameState）与线上 WS 状态（GameStateForPlayer）都能转换成同一渲染结构，
 * 让 GameTableShell 一套 UI 服务两种玩法。
 */
import type { GameState } from '../../shared/engine/game.ts'
import type { GameStateForPlayer } from '../../shared/protocol.ts'
import type { Card, Seat } from '../../shared/engine/types.ts'

export interface SeatView {
  seat: Seat
  nickname: string
  avatarId: string
  handCount: number
  role: 'landlord' | 'farmer' | null
  connected: boolean
  tokenBalance: number
  isHuman: boolean
}

export interface TableView {
  phase: 'calling' | 'playing' | 'settled'
  mySeat: Seat
  myHand: Card[]
  bottom: Card[]
  landlord: Seat | null
  current: Seat
  callOrder: Seat[]
  callActor: number
  callMultiplier: number
  lastPlayCards: Card[] | null
  lastActor: Seat | null
  multiplier: number
  bombCount: number
  spring: 'none' | 'landlord' | 'farmer'
  finished: boolean
  winner: 'landlord' | 'farmer' | null
  seats: SeatView[]
  turnStartedAt: number
  turnTimeoutMs: number
}

const NO_SEATS: SeatView[] = []

/** 本地引擎状态 → 视图（人类恒为 0 号座位） */
export function tableViewFromEngine(s: GameState, mySeat: Seat, seatMeta: Array<{ nickname: string; avatarId: string; tokenBalance: number }>): TableView {
  // 叫地主阶段的 landlord 只是当前最高叫分者，只有进入出牌阶段才正式确定。
  const landlord = s.phase === 'calling' ? null : s.landlord
  const seats: SeatView[] = ([0, 1, 2] as Seat[]).map((seat) => {
    const meta = seatMeta[seat] ?? { nickname: `座位${seat}`, avatarId: 'default-01', tokenBalance: 0 }
    return {
      seat,
      nickname: meta.nickname,
      avatarId: meta.avatarId,
      handCount: s.hands[seat]!.length,
      role: landlord === null ? null : seat === landlord ? 'landlord' : 'farmer',
      connected: true,
      tokenBalance: meta.tokenBalance,
      isHuman: seat === mySeat,
    }
  })
  return {
    phase: s.phase,
    mySeat,
    myHand: s.hands[mySeat]!.map((c) => ({ ...c })),
    bottom: landlord === null ? [] : s.bottom.map((c) => ({ ...c })),
    landlord,
    current: s.current,
    callOrder: s.callOrder,
    callActor: s.callActor,
    callMultiplier: s.callMultiplier,
    lastPlayCards: s.lastPlayCards ? s.lastPlayCards.map((c) => ({ ...c })) : null,
    lastActor: s.lastActor,
    multiplier: s.multiplier,
    bombCount: s.bombCount,
    spring: s.spring,
    finished: s.finished,
    winner: s.winner,
    seats,
    turnStartedAt: Date.now(),
    turnTimeoutMs: 25_000,
  }
}

/** 线上 WS 状态 → 视图 */
export function tableViewFromProtocol(p: GameStateForPlayer): TableView {
  return {
    phase: p.phase,
    mySeat: p.seat as Seat,
    myHand: p.hand.map((c) => ({ r: c.r as Card['r'], s: c.s as Card['s'] })),
    bottom: p.bottom.map((c) => ({ r: c.r as Card['r'], s: c.s as Card['s'] })),
    landlord: p.landlord as Seat | null,
    current: p.current as Seat,
    callOrder: p.callOrder.map((s) => s as Seat),
    callActor: p.callActor,
    callMultiplier: p.callMultiplier,
    lastPlayCards: p.lastPlayCards ? p.lastPlayCards.map((c) => ({ r: c.r as Card['r'], s: c.s as Card['s'] })) : null,
    lastActor: p.lastActor as Seat | null,
    multiplier: p.multiplier,
    bombCount: p.bombCount,
    spring: p.spring,
    finished: p.finished,
    winner: p.winner,
    seats: p.seats.map((s) => ({
      seat: s.seat as Seat,
      nickname: s.nickname,
      avatarId: s.avatarId,
      handCount: s.count,
      role: s.role,
      connected: s.connected,
      tokenBalance: s.tokenBalance,
      isHuman: s.seat === p.seat,
    })),
    turnStartedAt: p.turnStartedAt,
    turnTimeoutMs: p.turnTimeoutMs,
  }
}

/** 占位空视图（加载中） */
export function emptyTableView(mySeat: Seat = 0, myNickname = '你', myAvatar = 'default-01'): TableView {
  return {
    phase: 'playing',
    mySeat,
    myHand: [],
    bottom: [],
    landlord: null,
    current: mySeat,
    callOrder: [0, 1, 2] as Seat[],
    callActor: 0,
    callMultiplier: 1,
    lastPlayCards: null,
    lastActor: null,
    multiplier: 1,
    bombCount: 0,
    spring: 'none',
    finished: false,
    winner: null,
    seats: [{
      seat: mySeat, nickname: myNickname, avatarId: myAvatar, handCount: 0,
      role: null, connected: true, tokenBalance: 0, isHuman: true,
    }],
    turnStartedAt: Date.now(),
    turnTimeoutMs: 25_000,
  }
}
