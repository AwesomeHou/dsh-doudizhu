import { describe, expect, it } from 'vitest'
import { applyAction, createGame } from '../../shared/engine/game.ts'
import { tableViewFromEngine } from './table-view.ts'
import { inferAction, snapshotOf } from './action-feedback.ts'

const SEAT_META = [0, 1, 2].map((seat) => ({
  nickname: `玩家${seat}`,
  avatarId: 'default-01',
  tokenBalance: 0,
}))

function viewOf(rng: () => number, actions: Array<{ seat: number; call?: boolean }> = []) {
  let state = createGame(rng)
  for (const a of actions) {
    state = applyAction(state, { type: 'call', seat: a.seat as 0 | 1 | 2, call: a.call ?? false })
  }
  return tableViewFromEngine(state, 0, SEAT_META)
}

describe('行动反馈推断：叫地主阶段', () => {
  it('首个玩家叫地主 → 叫地主', () => {
    const first = createGame(() => 0.1)
    const firstCaller = first.callOrder[0]!
    const prev = snapshotOf(tableViewFromEngine(first, 0, SEAT_META))
    const next = tableViewFromEngine(applyAction(first, { type: 'call', seat: firstCaller, call: true }), 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: firstCaller, text: '叫地主' })
  })

  it('已有叫分者后再叫 → 抢地主（callMultiplier 翻倍）', () => {
    const initial = createGame(() => 0.1)
    const [a, b, c] = initial.callOrder
    const afterFirstCall = applyAction(initial, { type: 'call', seat: a!, call: true })
    const afterRob = applyAction(afterFirstCall, { type: 'call', seat: b!, call: true })
    const prev = snapshotOf(tableViewFromEngine(afterFirstCall, 0, SEAT_META))
    const next = tableViewFromEngine(afterRob, 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: b!, text: '抢地主' })
  })

  it('无人叫过时放弃 → 不叫', () => {
    const initial = createGame(() => 0.1)
    const [a] = initial.callOrder
    const prev = snapshotOf(tableViewFromEngine(initial, 0, SEAT_META))
    const next = tableViewFromEngine(applyAction(initial, { type: 'call', seat: a!, call: false }), 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: a!, text: '不叫' })
  })

  it('有人叫过后放弃 → 不抢', () => {
    const initial = createGame(() => 0.1)
    const [a, b] = initial.callOrder
    const afterCall = applyAction(initial, { type: 'call', seat: a!, call: true })
    const afterPass = applyAction(afterCall, { type: 'call', seat: b!, call: false })
    const prev = snapshotOf(tableViewFromEngine(afterCall, 0, SEAT_META))
    const next = tableViewFromEngine(afterPass, 0, SEAT_META)
    expect(inferAction(prev, next)).toEqual({ seat: b!, text: '不抢' })
  })

  it('第三次行动后进入出牌阶段（callActor=3）仍能识别', () => {
    const initial = createGame(() => 0.1)
    const [a, b, c] = initial.callOrder
    const afterTwo = applyAction(applyAction(initial, { type: 'call', seat: a!, call: true }), { type: 'call', seat: b!, call: false })
    const afterThird = applyAction(afterTwo, { type: 'call', seat: c!, call: false })
    const prev = snapshotOf(tableViewFromEngine(afterTwo, 0, SEAT_META))
    const next = tableViewFromEngine(afterThird, 0, SEAT_META)
    expect(next.phase).toBe('playing')
    expect(inferAction(prev, next)).toEqual({ seat: c!, text: '不抢' })
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
      current: 1 as Seat,
      lastActor: 0 as Seat,
    }
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
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
      current: 0 as Seat, // 领出者 0 家当前行动
      lastActor: 0 as Seat,
    }
    // 0 家领出后：current 前进到 1，lastActor 仍是 0（领出者）→ passer=(1+2)%3=0===lastActor，排除
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
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
      current: 0 as Seat,
      lastActor: null,
    }
    const next = {
      phase: 'playing' as const,
      callActor: 3,
      hasCalled: true,
      callMultiplier: 1,
      current: 1 as Seat,
      lastActor: 0 as Seat,
      callOrder: [0, 1, 2] as Seat[],
      lastPlayCards: null,
    } as Parameters<typeof inferAction>[1]
    expect(inferAction(prev, next)).toBeNull()
  })

  it('结算阶段不推断', () => {
    const prev = { phase: 'playing' as const, callActor: 3, hasCalled: true, callMultiplier: 1, current: 0 as Seat, lastActor: 0 as Seat }
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
      current: view.current,
      lastActor: null,
    })
  })
})
