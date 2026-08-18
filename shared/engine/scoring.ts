/**
 * 斗地主规则引擎 —— 结算（底注 × 倍数、抽水、账目守恒）
 */
import type { Role, Seat } from './types.ts'

export interface Settlement {
  landlord: Seat
  winner: 'landlord' | 'farmer'
  base: number
  multiplier: number
  /** 每农民支付给地主的税前金额 */
  stake: number
  /** 平台抽水（从赢家所得中扣） */
  rake: number
  /** 每座净变化：正=赢，负=输；三者之和 + rake = 0（账目守恒） */
  deltas: [number, number, number]
}

/**
 * @param landlord 地主座位
 * @param winner 赢家阵营
 * @param base 桌别底注
 * @param multiplier 总倍数（抢地主 × 炸弹 × 春天）
 * @param rakeRate 抽水率（0~1），默认 5%
 */
export function settle(
  landlord: Seat,
  winner: 'landlord' | 'farmer',
  base: number,
  multiplier: number,
  rakeRate = 0.05,
): Settlement {
  const stake = base * multiplier
  const deltas: [number, number, number] = [0, 0, 0]
  const farmers: Seat[] = ([0, 1, 2] as Seat[]).filter((s) => s !== landlord)
  let rake = 0
  if (winner === 'landlord') {
    for (const f of farmers) deltas[f] = -stake
    deltas[landlord] = 2 * stake
    rake = Math.floor(2 * stake * rakeRate)
    deltas[landlord] -= rake
  } else {
    deltas[landlord] = -2 * stake
    for (const f of farmers) {
      const gain = Math.floor(stake * (1 - rakeRate))
      deltas[f] = gain
      rake += stake - gain
    }
  }
  return { landlord, winner, base, multiplier, stake, rake, deltas }
}
