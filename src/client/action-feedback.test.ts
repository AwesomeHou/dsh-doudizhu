import { describe, expect, it } from 'vitest'
import { applyAction, createGame } from '../../shared/engine/game.ts'
import { tableViewFromEngine } from './table-view.ts'
import { inferAction, snapshotOf } from './action-feedback.ts'
import type { Seat } from '../../shared/engine/types.ts'

const SEAT_META = [0, 1, 2].map((seat) => ({
  nickname: `玩家${seat}`,
  avatarId: 'default-01',
  tokenBalance: 0,
}))

function viewOf(rng: () => number, actions: Array<{ seat: number; call?: boolean }> = []) {
  let state = dealAll(createGame(rng))
  for (const a of actions) {
    state = applyAction(state, { type: 'call', seat: a.seat as 0 | 1 | 2, call: a.call ?? false })
  }
  return tableViewFromEngine(state, 0, SEAT_META)
}

describe('行动反馈推断：叫地主/抢地主/加倍', () => {
  it('首个玩家叫地主（calling → robbing）→ 叫地主', () => {
    const first = dealAll(createGame(() => 0.1))
    const firstCaller = first.callOrder[0]!
    const prev = snapshotOf(tableViewFromEngine(first, 0, SEAT_META))
    const next = tableViewFromEngine(applyAction(first, { type: 'call', seat: firstCaller, call: true }), 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: firstCaller, text: '叫地主' })
  })

  it('叫地主阶段有人放弃 → 不叫', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [a] = initial.callOrder
    const prev = snapshotOf(tableViewFromEngine(initial, 0, SEAT_META))
    const next = tableViewFromEngine(applyAction(initial, { type: 'call', seat: a!, call: false }), 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: a!, text: '不叫' })
  })

  it('抢地主（robActor 前进且倍数翻倍）→ 抢地主', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [a, b] = initial.callOrder
    const afterCall = applyAction(initial, { type: 'call', seat: a!, call: true })
    const afterRob = applyAction(afterCall, { type: 'call', seat: b!, call: true })
    const prev = snapshotOf(tableViewFromEngine(afterCall, 0, SEAT_META))
    const next = tableViewFromEngine(afterRob, 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: b!, text: '抢地主' })
  })

  it('抢地主不抢 → 不抢', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [a, b] = initial.callOrder
    const afterCall = applyAction(initial, { type: 'call', seat: a!, call: true })
    const afterPass = applyAction(afterCall, { type: 'call', seat: b!, call: false })
    const prev = snapshotOf(tableViewFromEngine(afterCall, 0, SEAT_META))
    const next = tableViewFromEngine(afterPass, 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: b!, text: '不抢' })
  })

  it('抢地主最后一家行动后进入加倍仍能识别', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [a, b, c] = initial.callOrder
    const afterCall = applyAction(initial, { type: 'call', seat: a!, call: true })
    const afterB = applyAction(afterCall, { type: 'call', seat: b!, call: false })
    const afterC = applyAction(afterB, { type: 'call', seat: c!, call: false })
    // 抢地主顺序：下家(b)、再下家(c)、最后回到叫地主的人(a)
    const afterA = applyAction(afterC, { type: 'call', seat: a!, call: false })
    const prev = snapshotOf(tableViewFromEngine(afterC, 0, SEAT_META))
    const next = tableViewFromEngine(afterA, 0, SEAT_META)
    expect(next.phase).toBe('doubling')
    expect(inferAction(prev, next)).toEqual({ seat: a!, text: '不抢' })
  })

  it('加倍：超级加倍/加倍/不加倍', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [a, b, c] = initial.callOrder
    let state = applyAction(initial, { type: 'call', seat: a!, call: true })
    state = applyAction(state, { type: 'call', seat: b!, call: false })
    state = applyAction(state, { type: 'call', seat: c!, call: false })
    state = applyAction(state, { type: 'call', seat: a!, call: false })
    // 现在进入加倍阶段
    const firstDouble = applyAction(state, { type: 'double', seat: state.doublingOrder[0]!, choice: 2 })
    const prev1 = snapshotOf(tableViewFromEngine(state, 0, SEAT_META))
    const next1 = tableViewFromEngine(firstDouble, 0, SEAT_META)
    expect(inferAction(prev1, next1)).toEqual({ seat: state.doublingOrder[0]!, text: '超级加倍' })

    const secondDouble = applyAction(firstDouble, { type: 'double', seat: firstDouble.doublingOrder[1]!, choice: 1 })
    const prev2 = snapshotOf(tableViewFromEngine(firstDouble, 0, SEAT_META))
    const next2 = tableViewFromEngine(secondDouble, 0, SEAT_META)
    expect(inferAction(prev2, next2)).toEqual({ seat: firstDouble.doublingOrder[1]!, text: '加倍' })
  })
})

describe('行动反馈推断：出牌阶段', () => {
  it('current 前进而 lastActor 未变 → 有人过', () => {
    // 直接构造：A 刚出过牌（lastActor=A），current 从 B 移到 C（B 过了）
    const prev = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 1 as Seat,
      lastActor: 0 as Seat,
    }
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 2 as Seat,
      lastActor: 0 as Seat,
      callOrder: [0, 1, 2] as Seat[],
      lastPlayCards: null,
    } as Parameters<typeof inferAction>[1]
    expect(inferAction(prev, next)).toEqual({ seat: 1 as Seat, text: '过' })
  })

  it('重新领出（刚行动者就是 lastActor）→ 不当作“过”', () => {
    const prev = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 0 as Seat,
      lastActor: 0 as Seat,
    }
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 1 as Seat,
      lastActor: 0 as Seat,
      callOrder: [0, 1, 2] as Seat[],
      lastPlayCards: null,
    } as Parameters<typeof inferAction>[1]
    expect(inferAction(prev, next)).toBeNull()
  })

  it('出牌（lastActor 变化）→ 无气泡推断', () => {
    const prev = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 0 as Seat,
      lastActor: null,
    }
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      robActor: 3,
      doublingActor: 3,
      doubled: [0, 0, 0] as [number, number, number],
      current: 1 as Seat,
      lastActor: 0 as Seat,
      callOrder: [0, 1, 2] as Seat[],
      lastPlayCards: null,
    } as Parameters<typeof inferAction>[1]
    expect(inferAction(prev, next)).toBeNull()
  })

  it('结算阶段不推断', () => {
    const prev = { phase: 'playing' as const, callActor: 3, hasCalled: true, callMultiplier: 1, robActor: 3, doublingActor: 3, doubled: [0, 0, 0] as [number, number, number], current: 0 as Seat, lastActor: 0 as Seat }
    const next = { ...prev, phase: 'settled' as const } as Parameters<typeof inferAction>[1]
    expect(inferAction(prev, next)).toBeNull()
  })
})

describe('行动反馈推断：辅助函数', () => {
  it('snapshotOf 提取与行动相关的字段', () => {
    const view = viewOf(() => 0.1)
    const snapshot = snapshotOf(view)
    expect(snapshot).toEqual({
      phase: 'calling',
      callActor: 0,
      hasCalled: false,
      callMultiplier: 1,
      robActor: 0,
      doublingActor: 0,
      doubled: [0, 0, 0],
      current: view.current,
      lastActor: null,
    })
  })
})

/** 推进发牌直到进入叫地主阶段 */
function dealAll(state: ReturnType<typeof createGame>) {
  let g = state
  while (g.phase === 'dealing' && g.dealRound < 3) g = applyAction(g, { type: 'deal' })
  if (g.phase === 'dealing' && g.dealRound >= 3) g = applyAction(g, { type: 'start' })
  return g
}
