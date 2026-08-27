/**
 * 斗地主规则引擎 —— 机器人（简单但“看起来会打”）
 * 目标：M1 阶段"看起来会打、能打完一局"，不追求强。
 *
 * 行为要点：
 * - 叫地主/抢地主/加倍：按手牌强度分档决策，强度高更主动，弱牌更保守。
 * - 出牌：
 *   · 能一手走完（含领出时整手就是一个牌型）→ 直接打完；
 *   · 农民队友领出/出牌且有牌 → 尽量不压队友（让队友继续，除非自己能一手走完）；
 *   · 领出：优先甩长组合（顺子/飞机/连对 → 三带 → 对 → 单）；
 *   · 跟牌：压最小可压牌；炸弹/王炸仅在必要时用（最后一手、被迫应炸、
 *     对手快走完、或自己手牌很少需要抢控制权）。
 */
import { buildPlay, classify, hintPlay, legalPlays } from './valid.ts'
import type { Card, Play, Seat } from './types.ts'

/** 出牌决策上下文（由调用方提供对局信息；可省略，省略时退化为无队友/无手牌数感知） */
export interface BotContext {
  mySeat: Seat
  landlord: Seat | null
  lastActor: Seat | null
  /** 每座剩余手牌数（用于判断对手/队友是否快走完） */
  handsCount: [number, number, number]
}

/** 手牌强度粗评分：王>2>A/K>10/J/Q，炸弹/三张/对子额外加成 */
function handStrength(hand: Card[]): number {
  let s = 0
  const counts = new Map<number, number>()
  for (const c of hand) {
    counts.set(c.r, (counts.get(c.r) ?? 0) + 1)
    if (c.r >= 13) s += 6        // 王
    else if (c.r === 12) s += 4  // 2
    else if (c.r >= 10) s += 2   // K A
    else if (c.r >= 8) s += 1    // 10 J Q
  }
  for (const [r, n] of counts) {
    if (n >= 4) s += 6           // 炸弹
    else if (n === 3) s += r >= 10 ? 4 : 2   // 三张（高点数更值钱）
    else if (n === 2) s += r >= 10 ? 2 : 1   // 对子（高点数更值钱）
  }
  return s
}

/** 叫地主决策（机器人 / 服务端超时托管共用） */
export function botCall(hand: Card[], random: () => number = Math.random): boolean {
  const s = handStrength(hand)
  if (s >= 16) return true
  if (s >= 10) return random() < 0.6
  if (s >= 6) return random() < 0.35
  return random() < 0.2
}

/** 抢地主决策：手牌更强时更倾向抢（每次抢倍数 ×2，更保守一些） */
export function botRob(hand: Card[], random: () => number = Math.random): boolean {
  const s = handStrength(hand)
  if (s >= 20) return true
  if (s >= 14) return random() < 0.6
  if (s >= 8) return random() < 0.3
  return random() < 0.15
}

/**
 * 加倍决策：0=不加倍 1=加倍(×2) 2=超级加倍(×4)
 * 手牌越强越倾向超级加倍/加倍。
 */
export function botDouble(hand: Card[], random: () => number = Math.random): 0 | 1 | 2 {
  const s = handStrength(hand)
  if (s >= 22) return random() < 0.6 ? 2 : 1
  if (s >= 14) return random() < 0.4 ? 1 : 0
  return 0
}

/** 另一个农民（非我、非地主） */
function otherFarmer(me: Seat, landlord: Seat): Seat {
  return ([0, 1, 2] as Seat[]).find((x) => x !== me && x !== landlord) as Seat
}

/**
 * 机器人出牌决策。
 * @param hand 当前手牌
 * @param last 上家的牌（null = 领出）
 * @param ctx 对局上下文（队友/手牌数感知，可选）
 * @returns 要出的牌；null = 过
 */
export function botMove(hand: Card[], last: Play | null, ctx: BotContext | null = null): Card[] | null {
  const isLeading = last === null
  const myIsFarmer = ctx !== null && ctx.landlord !== null && ctx.mySeat !== ctx.landlord

  // 1) 能一手走完 → 直接打完（含领出时整手就是一个合法牌型）
  if (isLeading) {
    if (classify(hand)) return hand
  } else {
    const legal = legalPlays(hand, last)
    for (const p of legal) {
      const c = buildPlay(hand, p)
      if (c && c.length === hand.length) return c
    }
  }

  // 2) 让牌给农民队友：队友领出/出牌且还有牌 → 不压队友（除非能一手走完）
  if (last && ctx && myIsFarmer && ctx.landlord !== null) {
    const partner = otherFarmer(ctx.mySeat, ctx.landlord)
    if (ctx.lastActor === partner && ctx.handsCount[partner] > 0) {
      return null
    }
  }

  // 3) 领出：优先甩长组合（hintPlay 已按飞机/连对/顺子 → 三带 → 对 → 单 排序）
  if (isLeading) {
    const h = hintPlay(hand, null)
    return h && h.length > 0 ? h : null
  }

  // 4) 跟牌：压最小可压牌
  const h = hintPlay(hand, last)
  if (!h) return null
  const kind = classify(h)?.kind
  // 炸弹/王炸：仅在必要时使用
  if (kind === 'bomb' || kind === 'rocket') {
    if (!shouldUseBomb(hand, last, ctx, h)) return null
  }
  return h
}

/** 是否值得用炸弹/王炸 */
function shouldUseBomb(hand: Card[], last: Play, ctx: BotContext | null, play: Card[]): boolean {
  // 最后一手直接赢
  if (play.length === hand.length) return true
  // 对方出了炸弹/王炸 → 只能以炸对炸
  if (last.kind === 'bomb' || last.kind === 'rocket') return true
  // 对手快走完（≤2 张）→ 必须拦住
  if (ctx && ctx.lastActor !== null && ctx.lastActor !== ctx.mySeat) {
    const count = ctx.handsCount[ctx.lastActor]
    if (count !== undefined && count <= 2) return true
  }
  // 自己手牌很少 → 用炸抢控制权（炸后剩余 ≤2 张，容易收尾）
  if (hand.length <= 6) return true
  return false
}
