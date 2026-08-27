/**
 * 斗地主规则引擎 —— 类型定义（纯 TS，无依赖）
 */

/** 点数索引：3..A=0..11，2=12，小王=13，大王=14 */
export type Rank = number
/** 花色：0=♣ 1=♦ 2=♥ 3=♠（王忽略花色） */
export type Suit = 0 | 1 | 2 | 3

export interface Card {
  r: Rank
  s: Suit
}

/** 王 */
export const SJ = 13 as const
export const BJ = 14 as const

/** 点数名（下标即 Rank） */
export const RANK_NAMES = [
  '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'SJ', 'BJ',
] as const

export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const

export type PlayKind =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple_one'
  | 'triple_pair'
  | 'straight'
  | 'pair_straight'
  | 'airplane'
  | 'airplane_single'
  | 'airplane_pair'
  | 'four_two'
  | 'four_pair_two'
  | 'bomb'
  | 'rocket'

/** 一手牌型描述：kind + 主点数 rank + 张数 length */
export interface Play {
  kind: PlayKind
  rank: Rank
  length: number
}

export const KIND_NAMES: Record<PlayKind, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  triple_one: '三带一',
  triple_pair: '三带二',
  straight: '顺子',
  pair_straight: '连对',
  airplane: '飞机',
  airplane_single: '飞机带单',
  airplane_pair: '飞机带对',
  four_two: '四带二',
  four_pair_two: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
}

/** 座位：0 | 1 | 2 */
export type Seat = 0 | 1 | 2

/** 玩家身份 */
export type Role = 'landlord' | 'farmer'

/**
 * 对局阶段：
 * - dealing  发牌（分 3 轮，顺序入牌；所有人可在期间明牌，×4/×3/×2）
 * - calling  叫地主（3 人轮流叫/不叫，首个叫者成为“叫地主的人”）
 * - robbing  抢地主（其余两家依次抢/不抢，最后回到叫地主的人再决定抢/不抢，每次抢 ×2）
 * - doubling 加倍（每人 加倍×2 / 超级加倍×4 / 不加倍，限时 5s）
 * - playing  出牌（地主可在自己回合选择明牌，明牌后手牌对所有人公开且倍数 ×2）
 * - settled  已结算
 */
export type Phase = 'dealing' | 'calling' | 'robbing' | 'doubling' | 'playing' | 'settled'
