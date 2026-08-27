import { describe, expect, it } from 'vitest'
import { applyAction, createGame } from '../../shared/engine/game.ts'
import { tableViewFromEngine } from './table-view.ts'

const SEAT_META = [0, 1, 2].map((seat) => ({
  nickname: `玩家${seat}`,
  avatarId: 'default-01',
  tokenBalance: 0,
}))

/** 推进发牌直到进入叫地主阶段 */
function dealAll(state: ReturnType<typeof createGame>) {
  let g = state
  while (g.phase === 'dealing' && g.dealRound < 3) g = applyAction(g, { type: 'deal' })
  if (g.phase === 'dealing' && g.dealRound >= 3) g = applyAction(g, { type: 'start' })
  return g
}

describe('牌桌视图的阶段状态', () => {
  it('发牌阶段：不显示地主、不揭示底牌，手牌随轮次增长', () => {
    const initial = createGame(() => 0.1)
    const afterDeal = applyAction(initial, { type: 'deal' })
    const view = tableViewFromEngine(afterDeal, 0, SEAT_META)

    expect(view.phase).toBe('dealing')
    expect(view.dealRound).toBe(1)
    expect(view.landlord).toBeNull()
    expect(view.hasCalled).toBe(false)
    expect(view.bottom).toEqual([])
    expect(view.myHand).toHaveLength(6)
    expect(view.seats.every((seat) => seat.role === null)).toBe(true)
  })

  it('抢地主阶段：不显示地主/农民标，也不揭示底牌', () => {
    const initial = dealAll(createGame(() => 0.1))
    const firstCaller = initial.callOrder[0]!
    const state = applyAction(initial, { type: 'call', seat: firstCaller, call: true })
    const view = tableViewFromEngine(state, 0, SEAT_META)

    expect(view.phase).toBe('robbing')
    expect(view.landlord).toBeNull() // 抢地主结束（加倍阶段起）才显示地主
    expect(view.hasCalled).toBe(true)
    expect(view.bottom).toEqual([]) // 底牌未揭示
    expect(view.seats.every((seat) => seat.role === null)).toBe(true)
  })

  it('进入出牌阶段后才显示最终地主和底牌', () => {
    const initial = dealAll(createGame(() => 0.1))
    const [firstCaller, secondCaller, thirdCaller] = initial.callOrder
    let state = applyAction(initial, { type: 'call', seat: firstCaller!, call: true })
    // 抢地主：其余两家不抢，回到叫地主的人也不抢
    state = applyAction(state, { type: 'call', seat: secondCaller!, call: false })
    state = applyAction(state, { type: 'call', seat: thirdCaller!, call: false })
    state = applyAction(state, { type: 'call', seat: firstCaller!, call: false })
    // 加倍：都不加倍
    while (state.phase === 'doubling') {
      const seat = state.doublingOrder[state.doublingActor]!
      state = applyAction(state, { type: 'double', seat, choice: 0 })
    }
    const view = tableViewFromEngine(state, 0, SEAT_META)

    expect(view.phase).toBe('playing')
    expect(view.landlord).toBe(firstCaller)
    expect(view.hasCalled).toBe(true)
    expect(view.bottom).toHaveLength(3)
    expect(view.seats.find((seat) => seat.seat === firstCaller)?.role).toBe('landlord')
  })

  it('明牌座位的完整手牌下发到视图', () => {
    const initial = createGame(() => 0.1)
    const afterDeal = applyAction(initial, { type: 'deal' }) // 第 1 轮
    const state = applyAction(afterDeal, { type: 'ming', seat: 1 })
    const view = tableViewFromEngine(state, 0, SEAT_META)
    expect(view.revealed[1]).toBe(true)
    expect(view.seats[1]?.hand).toHaveLength(6)
    expect(view.seats[2]?.hand).toBeUndefined()
  })
})
