/**
 * 斗地主规则引擎 —— 对局状态机（纯函数 reducer）
 * 客户端与服务端共用：任何人出牌前，都必须先在这里校验并推进。
 */
import { canBeat } from './compare.ts'
import { deal } from './deck.ts'
import { settle, type Settlement } from './scoring.ts'
import { classify } from './valid.ts'
import type { Card, Phase, Play, Role, Seat } from './types.ts'

export interface MoveLog {
  seat: Seat
  type: 'call' | 'rob' | 'pass' | 'play'
  cards?: Card[]
  play?: Play
}

export interface GameState {
  phase: Phase
  hands: Card[][]
  bottom: Card[]
  landlord: Seat | null
  /** 当前行动座位 */
  current: Seat
  /** 叫地主：轮到的座位；-1 表示结束 */
  callActor: number
  callOrder: Seat[]
  /** 抢地主倍数：首次叫=1，之后每次抢 ×2 */
  callMultiplier: number
  lastPlay: Play | null
  lastActor: Seat | null
  /** 上一手实际打出的牌（用于界面展示） */
  lastPlayCards: Card[] | null
  passStreak: number
  /** 当前总倍数（含炸弹） */
  multiplier: number
  bombCount: number
  /** 是否有人出过牌（春天判断） */
  playedEver: [boolean, boolean, boolean]
  /** 地主出牌组数（反春判断） */
  landlordPlays: number
  spring: 'none' | 'landlord' | 'farmer'
  winner: 'landlord' | 'farmer' | null
  finished: boolean
  /** 无人叫地主，需要重新发牌 */
  redeal: boolean
  moveLog: MoveLog[]
  settlement: Settlement | null
  startedAt: number
}

export type Action =
  | { type: 'call'; seat: Seat; call: boolean }
  | { type: 'play'; seat: Seat; cards: Card[] }
  | { type: 'pass'; seat: Seat }

export function nextSeat(s: Seat): Seat {
  return ((s + 1) % 3) as Seat
}

export function roleOf(state: GameState, seat: Seat): Role {
  return state.landlord === seat ? 'landlord' : 'farmer'
}

export function createGame(rng: () => number = Math.random): GameState {
  const { hands, bottom } = deal(rng)
  // 叫地主按逆时针轮转：从随机起始座位开始，依次为下家 (start+1)%3、再下家 (start+2)%3，
  // 与出牌阶段的方向（逆时针）一致。旧实现是完全随机排列，导致叫牌阶段看不出方向。
  const start = Math.floor(rng() * 3) as Seat
  const order: Seat[] = [start, ((start + 1) % 3) as Seat, ((start + 2) % 3) as Seat]
  return {
    phase: 'calling',
    hands,
    bottom,
    landlord: null,
    current: order[0]!,
    callActor: 0,
    callOrder: order,
    callMultiplier: 1,
    lastPlay: null,
    lastActor: null,
    lastPlayCards: null,
    passStreak: 0,
    multiplier: 1,
    bombCount: 0,
    playedEver: [false, false, false],
    landlordPlays: 0,
    spring: 'none',
    winner: null,
    finished: false,
    redeal: false,
    moveLog: [],
    settlement: null,
    startedAt: Date.now(),
  }
}

function clone(s: GameState): GameState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    bottom: [...s.bottom],
    playedEver: [...s.playedEver] as [boolean, boolean, boolean],
    moveLog: [...s.moveLog],
  }
}

/** 出牌是否合法（服务端权威判断入口） */
export function isLegalPlay(state: GameState, seat: Seat, cards: Card[]): boolean {
  if (state.phase !== 'playing') return false
  if (state.current !== seat) return false
  if (cards.length === 0) return false
  const play = classify(cards)
  if (!play) return false
  // 手牌里确实有这些牌
  const hand = state.hands[seat]!
  const remain = hand.slice()
  for (const c of cards) {
    const i = remain.findIndex((x) => x.r === c.r && x.s === c.s)
    if (i < 0) return false
    remain.splice(i, 1)
  }
  return canBeat(play, state.lastPlay)
}

export function applyAction(state: GameState, action: Action): GameState {
  const s = clone(state)
  if (action.type === 'call') {
    if (s.phase !== 'calling') throw new Error('phase not calling')
    if (s.callOrder[s.callActor] !== action.seat) throw new Error('not your turn to call')
    if (action.call) {
      if (s.landlord === null) {
        s.landlord = action.seat
        s.callMultiplier = 1
        s.moveLog.push({ seat: action.seat, type: 'call' })
      } else {
        s.landlord = action.seat
        s.callMultiplier *= 2
        s.moveLog.push({ seat: action.seat, type: 'rob' })
      }
    }
    s.callActor++
    if (s.callActor >= 3) {
      if (s.landlord === null) {
        s.redeal = true
      } else {
        s.phase = 'playing'
        s.current = s.landlord
        s.multiplier = s.callMultiplier
      }
    } else {
      s.current = s.callOrder[s.callActor]!
    }
    return s
  }

  if (s.phase !== 'playing' || s.current !== action.seat) {
    throw new Error('not your turn')
  }

  if (action.type === 'play') {
    if (!isLegalPlay(s, action.seat, action.cards)) throw new Error('illegal play')
    const play = classify(action.cards)!
    const hand = s.hands[action.seat]!
    for (const c of action.cards) {
      const i = hand.findIndex((x) => x.r === c.r && x.s === c.s)
      hand.splice(i, 1)
    }
    s.lastPlay = play
    s.lastActor = action.seat
    s.lastPlayCards = action.cards
    s.passStreak = 0
    s.playedEver[action.seat] = true
    if (roleOf(s, action.seat) === 'landlord') s.landlordPlays++
    if (play.kind === 'bomb' || play.kind === 'rocket') {
      s.bombCount++
      s.multiplier *= 2
    }
    s.moveLog.push({ seat: action.seat, type: 'play', cards: action.cards, play })
    if (hand.length === 0) {
      s.finished = true
      s.winner = roleOf(s, action.seat)
      finalize(s)
    } else {
      s.current = nextSeat(action.seat)
    }
    return s
  }

  // pass
  if (s.lastPlay === null) throw new Error('cannot pass when leading')
  s.passStreak++
  s.moveLog.push({ seat: action.seat, type: 'pass' })
  if (s.passStreak >= 2) {
    // 其余两家都过了 → lastActor 重新领出
    s.lastPlay = null
    s.lastPlayCards = null
    s.passStreak = 0
    s.current = s.lastActor!
  } else {
    s.current = nextSeat(action.seat)
  }
  return s
}

/** 结算（在 finished=true 时调用） */
export function finalize(s: GameState, rakeRate = 0.05): void {
  const landlord = s.landlord!
  const farmers: Seat[] = ([0, 1, 2] as Seat[]).filter((x) => x !== landlord)
  // 春天 / 反春
  if (s.winner === 'landlord') {
    if (!s.playedEver[farmers[0]!] && !s.playedEver[farmers[1]!]) s.spring = 'landlord'
  } else {
    if (s.landlordPlays <= 1) s.spring = 'farmer'
  }
  let mult = s.multiplier
  if (s.spring !== 'none') mult *= 2
  s.multiplier = mult
  s.settlement = settle(landlord, s.winner!, 0, mult, rakeRate)
}
