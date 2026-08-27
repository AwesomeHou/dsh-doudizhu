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
 * @param base 桌别底分
 * @param multiplier 总倍数（明牌 × 抢地主 × 加倍 × 炸弹 × 春天）
 * @param rakeRate 抽水率（0~1），默认 5%
 * @param capitals 每座开局余额（可选）：传入后按“每场封顶”规则收缩 stake——
 *   赢家所得不超过它自己的本金（开局余额），同时保证任何一方都不会输超本金。
 */
export function settle(
  landlord: Seat,
  winner: 'landlord' | 'farmer',
  base: number,
  multiplier: number,
  rakeRate = 0.05,
  capitals?: [number, number, number],
): Settlement {
  let stake = base * multiplier
  if (capitals) {
    // 地主侧单方金额为 2×stake，农民侧为 stake：
    // 封顶 = min(原始 stake, 地主本金/2, 农民1本金, 农民2本金)
    const farmers: Seat[] = ([0, 1, 2] as Seat[]).filter((s) => s !== landlord)
    const cap = Math.min(
      stake,
      Math.floor(capitals[landlord]! / 2),
      ...farmers.map((f) => capitals[f]!),
    )
    stake = Math.max(0, cap)
  }
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
