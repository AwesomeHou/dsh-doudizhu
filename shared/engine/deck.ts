/**
 * 斗地主规则引擎 —— 牌堆/洗牌/发牌
 */
import { BJ, SJ, type Card, type Rank, type Suit } from './types.ts'

const SUITS: Suit[] = [0, 1, 2, 3]

/** 构造一副 54 张的完整牌（13 点数 × 4 花色 + 大小王） */
export function newDeck(): Card[] {
  const deck: Card[] = []
  for (let r = 0; r < 13; r++) {
    for (const s of SUITS) deck.push({ r, s })
  }
  deck.push({ r: SJ, s: 0 }, { r: BJ, s: 0 })
  return deck
}

/** Fisher–Yates 洗牌（rng 可注入以便测试） */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

export interface DealResult {
  /** 三家手牌，各 17 张 */
  hands: Card[][]
  /** 3 张底牌 */
  bottom: Card[]
}

/** 发牌：洗牌 → 17×3 + 3 底牌 */
export function deal(rng: () => number = Math.random): DealResult {
  const deck = shuffle(newDeck(), rng)
  return {
    hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)],
    bottom: deck.slice(51, 54),
  }
}

export interface DealPlan {
  /** rounds[r][seat] = 第 r 轮（0..2）发给 seat 的牌；每人 6+6+5=17 张 */
  rounds: Card[][][]
  /** 3 张底牌 */
  bottom: Card[]
}

/**
 * 分 3 轮发牌：每轮按座位 0→1→2 依次发一小撮（6、6、5），
 * 供客户端做“逐轮发牌 + 动画”展示（规则引擎仍以最终手牌为准）。
 */
export function dealInRounds(rng: () => number = Math.random): DealPlan {
  const deck = shuffle(newDeck(), rng)
  const chunk = [6, 6, 5]
  const rounds: Card[][][] = []
  let idx = 0
  for (const size of chunk) {
    const round: Card[][] = [[], [], []]
    for (let seat = 0; seat < 3; seat++) {
      round[seat] = deck.slice(idx, idx + size)
      idx += size
    }
    rounds.push(round)
  }
  return { rounds, bottom: deck.slice(51, 54) }
}

/** 单张牌的可读名（如 "10♠"、"小王"） */
export function cardName(c: Card): string {
  const names = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王']
  const suits = ['♣', '♦', '♥', '♠']
  return c.r < 13 ? names[c.r]! + suits[c.s]! : names[c.r]!
}

/** 手牌排序：按点数降序（方便展示/比较） */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => b.r - a.r || a.s - b.s)
}
