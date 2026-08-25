/**
 * src/client/action-feedback.ts —— 角色行动反馈推断（纯函数，可单测）
 *
 * 线上协议不直接下发“谁刚做了什么”，客户端靠相邻两次状态快照（state 消息）的推进
 * 推断刚刚发生的行动，并在各座位前显示气泡（叫地主/抢地主/不抢/不叫/过）。
 *
 * 推断依据：
 * - 叫地主阶段：`callActor` 前进一格 → `callOrder[callActor-1]` 刚行动；
 *   - `hasCalled` false→true → 首个叫地主；
 *   - `callMultiplier` 增大 → 抢地主（引擎规则：已有叫分者后再“叫”即为抢，×2）；
 *   - 其余 → 不叫/不抢（视当时是否已有人叫过）。
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
  current: Seat
  lastActor: Seat | null
}

export function snapshotOf(view: TableView): StateSnapshot {
  return {
    phase: view.phase,
    callActor: view.callActor,
    hasCalled: view.hasCalled,
    callMultiplier: view.callMultiplier,
    current: view.current,
    lastActor: view.lastActor,
  }
}

/** 由相邻两次状态推进推断刚刚发生的行动；无法确定时返回 null */
export function inferAction(prev: StateSnapshot, view: TableView): ActionFeedback | null {
  if (view.phase === 'settled') return null

  // 叫地主阶段（含第三次行动后进入出牌阶段的同一条消息）：callActor 前进一格
  if (view.callActor > prev.callActor && view.callActor > 0 && view.callActor <= 3) {
    const acted = view.callOrder[view.callActor - 1]
    if (acted === undefined) return null
    let text: string
    if (view.hasCalled && !prev.hasCalled) text = '叫地主'
    else if (view.callMultiplier > prev.callMultiplier) text = '抢地主'
    else text = view.hasCalled ? '不抢' : '不叫'
    return { seat: acted, text }
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
