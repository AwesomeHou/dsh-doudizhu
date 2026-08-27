/**
 * 斗地主规则引擎 —— 简单机器人
 * 目标：M1 阶段"看起来会打、能打完一局"，不追求强。
 */
import { buildPlay, classify, hintPlay, legalPlays } from './valid.ts'
import type { Card, Play } from './types.ts'

/** 叫地主决策（机器人 / 服务端超时托管共用） */
export function botCall(hand: Card[], random: () => number = Math.random): boolean {
  const strong = hand.filter((x) => x.r >= 12).length >= 1 || hand.filter((x) => x.r >= 9).length >= 3
  return strong || random() < 0.3
}

/** 抢地主决策：手牌更强时更倾向抢（每次抢倍数 ×2） */
export function botRob(hand: Card[], random: () => number = Math.random): boolean {
  const strong = hand.filter((x) => x.r >= 12).length >= 2 || hand.filter((x) => x.r >= 9).length >= 4
  return strong || random() < 0.25
}

/**
 * 加倍决策：0=不加倍 1=加倍(×2) 2=超级加倍(×4)
 * 手牌越强越倾向超级加倍/加倍。
 */
export function botDouble(hand: Card[], random: () => number = Math.random): 0 | 1 | 2 {
  const aces = hand.filter((x) => x.r >= 12).length
  const highs = hand.filter((x) => x.r >= 9).length
  if (aces >= 2 && highs >= 5) return random() < 0.65 ? 2 : 1
  if (aces >= 1) return random() < 0.35 ? 1 : 0
  return 0
}

/**
 * 机器人出牌决策。
 * @param hand 当前手牌
 * @param last 上家的牌（null = 领出）
 * @returns 要出的牌；null = 过
 */
export function botMove(hand: Card[], last: Play | null): Card[] | null {
  // 领出：用 hintPlay 的甩牌策略（优先长顺子/飞机，其次三带/对/单）
  if (!last) {
    const h = hintPlay(hand, null)
    return h && h.length > 0 ? h : null
  }

  // 跟牌：
  // 1) 能一手出完 → 直接打完
  const legal = legalPlays(hand, last)
  for (const p of legal) {
    const c = buildPlay(hand, p)
    if (c && c.length === hand.length) return c
  }
  // 2) 最小可压牌
  const h = hintPlay(hand, last)
  if (!h) return null
  const kind = classify(h)?.kind
  // 3) 炸弹/王炸尽量保留（除非手牌很少、或这是最后一手）
  if ((kind === 'bomb' || kind === 'rocket') && hand.length > 4) return null
  return h
}
