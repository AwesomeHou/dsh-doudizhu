/**
 * src/client/table-view.ts —— 统一牌桌视图模型
 * 本地引擎状态（GameState）与线上 WS 状态（GameStateForPlayer）都能转换成同一渲染结构，
 * 让 GameTableShell 一套 UI 服务两种玩法。
 */
import type { GameState } from '../../shared/engine/game.ts'
import type { GameStateForPlayer } from '../../shared/protocol.ts'
import type { Card, Phase, Seat } from '../../shared/engine/types.ts'

export interface SeatView {
  seat: Seat
  nickname: string
  avatarId: string
  handCount: number
  role: 'landlord' | 'farmer' | null
  connected: boolean
  tokenBalance: number
  isHuman: boolean
  /** 明牌座位下发的完整手牌（否则 undefined） */
  hand?: Card[]
}

export interface TableView {
  phase: Phase
  mySeat: Seat
  myHand: Card[]
  bottom: Card[]
  landlord: Seat | null
  hasCalled: boolean
  current: Seat
  callOrder: Seat[]
  callActor: number
  callMultiplier: number
  /** 首个叫地主的人（抢地主最后回到他那里再选择） */
  callerSeat: Seat | null
  robOrder: Seat[]
  robActor: number
  doublingOrder: Seat[]
  doublingActor: number
  /** 每座加倍选择：0=不加倍 1=加倍 2=超级加倍 */
  doubled: [number, number, number]
  /** 每座是否明牌 */
  revealed: [boolean, boolean, boolean]
  /** 发牌进度：0=未发，1..3=已发轮数 */
  dealRound: number
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

/** 本地引擎状态 → 视图（人类恒为 0 号座位） */
export function tableViewFromEngine(s: GameState, mySeat: Seat, seatMeta: Array<{ nickname: string; avatarId: string; tokenBalance: number }>): TableView {
  // 发牌/叫地主阶段尚未确定地主；抢/加倍/出牌阶段显示当前地主候选
  const landlord = s.phase === 'dealing' || s.phase === 'calling' ? null : s.landlord
  const playing = s.phase === 'playing'
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
      hand: s.revealed[seat] ? s.hands[seat]!.map((c) => ({ ...c })) : undefined,
    }
  })
  return {
    phase: s.phase,
    mySeat,
    myHand: s.hands[mySeat]!.map((c) => ({ ...c })),
    bottom: playing ? s.bottom.map((c) => ({ ...c })) : [],
    landlord,
    hasCalled: s.landlord !== null,
    current: s.current,
    callOrder: s.callOrder,
    callActor: s.callActor,
    callMultiplier: s.callMultiplier,
    callerSeat: s.callerSeat,
    robOrder: s.robOrder,
    robActor: s.robActor,
    doublingOrder: s.doublingOrder,
    doublingActor: s.doublingActor,
    doubled: [...s.doubled],
    revealed: [...s.revealed],
    dealRound: s.dealRound,
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
  const asCard = (c: { r: number; s: number }): Card => ({ r: c.r as Card['r'], s: c.s as Card['s'] })
  return {
    phase: p.phase,
    mySeat: p.seat as Seat,
    myHand: p.hand.map(asCard),
    bottom: p.bottom.map(asCard),
    landlord: p.landlord as Seat | null,
    hasCalled: p.hasCalled,
    current: p.current as Seat,
    callOrder: p.callOrder.map((s) => s as Seat),
    callActor: p.callActor,
    callMultiplier: p.callMultiplier,
    callerSeat: p.callerSeat as Seat | null,
    robOrder: p.robOrder.map((s) => s as Seat),
    robActor: p.robActor,
    doublingOrder: p.doublingOrder.map((s) => s as Seat),
    doublingActor: p.doublingActor,
    doubled: p.doubled as [number, number, number],
    revealed: p.revealed as [boolean, boolean, boolean],
    dealRound: p.dealRound,
    lastPlayCards: p.lastPlayCards ? p.lastPlayCards.map(asCard) : null,
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
      hand: s.hand ? s.hand.map(asCard) : undefined,
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
    hasCalled: false,
    current: mySeat,
    callOrder: [0, 1, 2] as Seat[],
    callActor: 0,
    callMultiplier: 1,
    callerSeat: null,
    robOrder: [0, 1, 2] as Seat[],
    robActor: 0,
    doublingOrder: [0, 1, 2] as Seat[],
    doublingActor: 0,
    doubled: [0, 0, 0],
    revealed: [false, false, false],
    dealRound: 0,
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
