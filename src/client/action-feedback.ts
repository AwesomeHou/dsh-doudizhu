/**
 * src/client/action-feedback.ts —— 角色行动反馈推断（纯函数，可单测）
 *
 * 线上协议不直接下发“谁刚做了什么”，客户端靠相邻两次状态快照（state 消息）的推进
 * 推断刚刚发生的行动，并在各座位前显示气泡（叫地主/抢地主/不抢/不叫/过/加倍/超级加倍）。
 *
 * 推断依据：
 * - 叫地主：`callActor` 前进一格 → `callOrder[callActor-1]` 刚行动；
 *   或 calling → robbing 且 `hasCalled` false→true → 首个叫地主的人刚叫。
 * - 抢地主：`robActor` 前进一格 → `robOrder[robActor-1]` 刚行动；
 *   `callMultiplier` 增大 → 抢地主（×2），否则 → 不抢。
 * - 加倍：`doublingActor` 前进一格 → `doublingOrder[doublingActor-1]` 刚行动；
 *   依据 `doubled[seat]` 显示 超级加倍/加倍/不加倍。
 * - 出牌阶段：`current` 变了而 `lastActor` 没变，且上一手玩家不是刚刚重新领出 → 有人“过”。
 */
import type { Seat } from '../../shared/engine/types.ts'
import type { TableView } from './table-view.ts'

export interface ActionFeedback {
  seat: Seat
  text: string
}

/** 参与推断的状态快照（取与行动推进相关的字段） */
export interface StateSnapshot {
  phase: TableView['phase']
  callActor: number
  hasCalled: boolean
  callMultiplier: number
  robActor: number
  doublingActor: number
  doubled: [number, number, number]
  current: Seat
  lastActor: Seat | null
}

export function snapshotOf(view: TableView): StateSnapshot {
  return {
    phase: view.phase,
    callActor: view.callActor,
    hasCalled: view.hasCalled,
    callMultiplier: view.callMultiplier,
    robActor: view.robActor,
    doublingActor: view.doublingActor,
    doubled: [...view.doubled],
    current: view.current,
    lastActor: view.lastActor,
  }
}

/** 由相邻两次状态推进推断刚刚发生的行动；无法确定时返回 null */
export function inferAction(prev: StateSnapshot, view: TableView): ActionFeedback | null {
  if (view.phase === 'settled') return null

  // 首个叫地主：calling → robbing 且 hasCalled 由 false 变 true（叫牌动作发生在同一条消息）
  if (prev.phase === 'calling' && view.phase === 'robbing' && view.hasCalled && !prev.hasCalled && view.callerSeat !== null) {
    return { seat: view.callerSeat, text: '叫地主' }
  }

  // 叫地主：callActor 前进一格（不叫）
  if (view.callActor > prev.callActor && view.callActor > 0 && view.callActor <= 3) {
    const acted = view.callOrder[view.callActor - 1]
    if (acted === undefined) return null
    return { seat: acted, text: '不叫' }
  }

  // 抢地主：robActor 前进一格（含最后一家行动后进入加倍的同一消息）
  if (view.robActor > prev.robActor && view.robActor > 0 && view.robActor <= 3) {
    const acted = view.robOrder[view.robActor - 1]
    if (acted === undefined) return null
    return { seat: acted, text: view.callMultiplier > prev.callMultiplier ? '抢地主' : '不抢' }
  }

  // 加倍：doublingActor 前进一格（含最后一家行动后进入出牌的同一消息）
  if (view.doublingActor > prev.doublingActor && view.doublingActor > 0 && view.doublingActor <= 3) {
    const acted = view.doublingOrder[view.doublingActor - 1]
    if (acted === undefined) return null
    const choice = view.doubled[acted]
    return { seat: acted, text: choice === 2 ? '超级加倍' : choice === 1 ? '加倍' : '不加倍' }
  }

  // 出牌阶段：current 变了而 lastActor 没变，且上一手玩家不是刚刚重新领出 → 有人“过”
  if (
    view.phase === 'playing' && prev.phase === 'playing'
    && view.current !== prev.current
    && view.lastActor !== null
    && view.lastActor === prev.lastActor
    && ((view.current + 2) % 3) !== view.lastActor
  ) {
    return { seat: ((view.current + 2) % 3) as Seat, text: '过' }
  }

  return null
}
