/**
 * 斗地主规则引擎 —— 牌型比较
 */
import type { Play } from './types.ts'

/**
 * 后手 play 能否压过先手 last。
 * - last 为空（先手/领出）→ 任意合法牌型都可以出。
 * - 王炸 > 一切；炸弹 > 普通牌型；同型比主点数，且长度必须相同。
 */
export function canBeat(play: Play, last: Play | null): boolean {
  if (!last) return true
  if (play.kind === 'rocket') return true
  if (last.kind === 'rocket') return false
  if (play.kind === 'bomb') {
    if (last.kind === 'bomb') return play.rank > last.rank
    return true
  }
  if (last.kind === 'bomb') return false
  if (play.kind !== last.kind) return false
  if (play.length !== last.length) return false
  return play.rank > last.rank
}
