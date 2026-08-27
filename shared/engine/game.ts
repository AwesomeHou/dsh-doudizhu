/**
 * 斗地主规则引擎 —— 对局状态机（纯函数 reducer）
 * 客户端与服务端共用：任何人出牌前，都必须先在这里校验并推进。
 *
 * 对局流程：
 *   dealing（分 3 轮发牌，期间可明牌 ×4/×3/×2）
 *   → calling（叫地主：首个叫者成为“叫地主的人”）
 *   → robbing（抢地主：其余两家依次抢/不抢，最后回到叫地主的人再决定，每次抢 ×2）
 *   → doubling（加倍：每人 加倍×2 / 超级加倍×4 / 不加倍）
 *   → playing（出牌；地主可明牌，明牌后手牌公开且倍数 ×2）
 *   → 一方出完 → settled 结算
 */
import { canBeat } from './compare.ts'
import { dealInRounds } from './deck.ts'
import { settle, type Settlement } from './scoring.ts'
import { classify } from './valid.ts'
import type { Card, Phase, Play, Role, Seat } from './types.ts'

export interface MoveLog {
  seat: Seat
  type: 'call' | 'rob' | 'pass' | 'play' | 'double' | 'ming' | 'deal'
  cards?: Card[]
  play?: Play
}

export interface GameState {
  phase: Phase
  hands: Card[][]
  /** 发牌计划（dealing 阶段逐轮取出放入 hands） */
  dealRounds: Card[][][]
  bottom: Card[]
  /** 已发牌轮数：0=未发，1..3=已发轮数 */
  dealRound: number
  landlord: Seat | null
  /** 当前行动座位 */
  current: Seat
  /** 叫地主：轮到的座位；-1 表示结束 */
  callActor: number
  callOrder: Seat[]
  /** 首个叫地主的人（抢地主最后回到他那里再选择） */
  callerSeat: Seat | null
  /** 抢地主：轮到的下标；-1 表示结束 */
  robActor: number
  robOrder: Seat[]
  /** 加倍：轮到的下标；-1 表示结束 */
  doublingActor: number
  doublingOrder: Seat[]
  /** 每座加倍选择：0=不加倍 1=加倍(×2) 2=超级加倍(×4) */
  doubled: [number, number, number]
  /** 每座是否明牌（手牌公开） */
  revealed: [boolean, boolean, boolean]
  /** 抢地主倍数：首次叫=1，之后每次抢 ×2 */
  callMultiplier: number
  lastPlay: Play | null
  lastActor: Seat | null
  /** 上一手实际打出的牌（用于界面展示） */
  lastPlayCards: Card[] | null
  passStreak: number
  /** 当前总倍数（明牌 × 抢地主 × 加倍 × 炸弹 × 春天） */
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
  | { type: 'deal' }
  | { type: 'start' }
  | { type: 'call'; seat: Seat; call: boolean }
  | { type: 'double'; seat: Seat; choice: 0 | 1 | 2 }
  | { type: 'ming'; seat: Seat }
  | { type: 'play'; seat: Seat; cards: Card[] }
  | { type: 'pass'; seat: Seat }

export function nextSeat(s: Seat): Seat {
  return ((s + 1) % 3) as Seat
}

export function roleOf(state: GameState, seat: Seat): Role {
  return state.landlord === seat ? 'landlord' : 'farmer'
}

/** 发牌阶段明牌倍数：第 1/2/3 轮明牌分别 ×4/×3/×2 */
export function mingFactor(dealRound: number): number {
  return dealRound >= 1 && dealRound <= 3 ? 5 - dealRound : 1
}

export function createGame(rng: () => number = Math.random): GameState {
  const { rounds, bottom } = dealInRounds(rng)
  // 叫地主按逆时针轮转：从随机起始座位开始，依次为下家 (start+1)%3、再下家 (start+2)%3，
  // 与出牌阶段的方向（逆时针）一致。旧实现是完全随机排列，导致叫牌阶段看不出方向。
  const start = Math.floor(rng() * 3) as Seat
  const order: Seat[] = [start, ((start + 1) % 3) as Seat, ((start + 2) % 3) as Seat]
  return {
    phase: 'dealing',
    hands: [[], [], []],
    dealRounds: rounds,
    bottom,
    dealRound: 0,
    landlord: null,
    current: order[0]!,
    callActor: 0,
    callOrder: order,
    callerSeat: null,
    robActor: 0,
    robOrder: [0, 1, 2] as Seat[],
    doublingActor: 0,
    doublingOrder: order,
    doubled: [0, 0, 0],
    revealed: [false, false, false],
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
    dealRounds: s.dealRounds.map((round) => round.map((h) => [...h])),
    bottom: [...s.bottom],
    playedEver: [...s.playedEver] as [boolean, boolean, boolean],
    revealed: [...s.revealed] as [boolean, boolean, boolean],
    doubled: [...s.doubled] as [number, number, number],
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

  // —— 发牌：每次推进一轮（第 3 轮发完后仍停留在发牌阶段，保留最后一轮 ×2 的明牌窗口） ——
  if (action.type === 'deal') {
    if (s.phase !== 'dealing') throw new Error('phase not dealing')
    if (s.dealRound >= 3) throw new Error('dealing already done')
    const round = s.dealRound
    for (let seat = 0; seat < 3; seat++) {
      s.hands[seat]!.push(...s.dealRounds[round]![seat]!)
    }
    s.dealRound++
    s.moveLog.push({ seat: 0 as Seat, type: 'deal' })
    return s
  }

  // —— 发牌完毕 → 进入叫地主 ——
  if (action.type === 'start') {
    if (s.phase !== 'dealing' || s.dealRound < 3) throw new Error('dealing not finished')
    s.phase = 'calling'
    s.callActor = 0
    s.current = s.callOrder[0]!
    return s
  }

  // —— 明牌 ——
  if (action.type === 'ming') {
    if (s.phase === 'dealing') {
      if (s.dealRound < 1) throw new Error('no cards dealt yet')
      if (s.revealed[action.seat]) throw new Error('already revealed')
      const factor = mingFactor(s.dealRound)
      s.revealed[action.seat] = true
      s.multiplier *= factor
      s.moveLog.push({ seat: action.seat, type: 'ming' })
      return s
    }
    // 出牌阶段：仅地主可明牌，明牌后手牌公开且倍数 ×2
    if (s.phase === 'playing' && s.landlord === action.seat && s.current === action.seat) {
      if (s.revealed[action.seat]) throw new Error('already revealed')
      s.revealed[action.seat] = true
      s.multiplier *= 2
      s.moveLog.push({ seat: action.seat, type: 'ming' })
      return s
    }
    throw new Error('cannot reveal now')
  }

  // —— 叫地主 / 抢地主 ——
  if (action.type === 'call') {
    if (s.phase === 'calling') {
      if (s.callOrder[s.callActor] !== action.seat) throw new Error('not your turn to call')
      if (action.call) {
        if (s.landlord !== null) throw new Error('already called')
        // 首个叫的人成为“叫地主的人”，进入抢地主环节：
        // 其余两家按原顺序先抢，最后回到叫地主的人再决定抢/不抢。
        s.landlord = action.seat
        s.callerSeat = action.seat
        s.callMultiplier = 1
        s.moveLog.push({ seat: action.seat, type: 'call' })
        s.phase = 'robbing'
        s.robActor = 0
        s.robOrder = [nextSeat(action.seat), nextSeat(nextSeat(action.seat)), action.seat]
        s.current = s.robOrder[0]!
        return s
      }
      // 不叫
      s.callActor++
      s.moveLog.push({ seat: action.seat, type: 'call' })
      if (s.callActor >= 3) {
        s.redeal = true
      } else {
        s.current = s.callOrder[s.callActor]!
      }
      return s
    }
    if (s.phase === 'robbing') {
      if (s.robOrder[s.robActor] !== action.seat) throw new Error('not your turn to rob')
      if (action.call) {
        // 抢地主：成为当前地主候选，场上倍数 ×2
        s.landlord = action.seat
        s.callMultiplier *= 2
        s.multiplier *= 2
        s.moveLog.push({ seat: action.seat, type: 'rob' })
      } else {
        s.moveLog.push({ seat: action.seat, type: 'call' })
      }
      s.robActor++
      if (s.robActor >= 3) {
        // 抢地主结束 → 加倍（每人按叫牌顺序选择，限时由服务端托管）
        s.phase = 'doubling'
        s.doublingActor = 0
        s.doublingOrder = s.callOrder
        s.current = s.doublingOrder[0]!
      } else {
        s.current = s.robOrder[s.robActor]!
      }
      return s
    }
    throw new Error('phase not calling/robbing')
  }

  // —— 加倍 ——
  if (action.type === 'double') {
    if (s.phase !== 'doubling') throw new Error('phase not doubling')
    if (s.doublingOrder[s.doublingActor] !== action.seat) throw new Error('not your turn to double')
    if (action.choice < 0 || action.choice > 2) throw new Error('invalid double choice')
    s.doubled[action.seat] = action.choice
    if (action.choice === 1) s.multiplier *= 2
    else if (action.choice === 2) s.multiplier *= 4
    s.moveLog.push({ seat: action.seat, type: 'double' })
    s.doublingActor++
    if (s.doublingActor >= 3) {
      // 加倍结束 → 出牌（地主先行）
      s.phase = 'playing'
      s.current = s.landlord!
    } else {
      s.current = s.doublingOrder[s.doublingActor]!
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
