import { describe, expect, it } from 'vitest'
import { applyAction, createGame } from '../../shared/engine/game.ts'
import { tableViewFromEngine } from './table-view.ts'

const SEAT_META = [0, 1, 2].map((seat) => ({
  nickname: `玩家${seat}`,
  avatarId: 'default-01',
  tokenBalance: 0,
}))

describe('牌桌视图的叫地主阶段', () => {
  it('不会把当前最高叫分者显示成地主，也不会揭示底牌', () => {
    const initial = createGame(() => 0.1)
    const firstCaller = initial.callOrder[0]!
    const state = applyAction(initial, { type: 'call', seat: firstCaller, call: true })
    const view = tableViewFromEngine(state, 0, SEAT_META)

    expect(view.phase).toBe('calling')
    expect(view.landlord).toBeNull()
    expect(view.bottom).toEqual([])
    expect(view.seats.every((seat) => seat.role === null)).toBe(true)
  })

  it('全部叫地主结束后才显示最终地主和底牌', () => {
    const initial = createGame(() => 0.1)
    const [firstCaller, secondCaller, thirdCaller] = initial.callOrder
    let state = applyAction(initial, { type: 'call', seat: firstCaller!, call: true })
    state = applyAction(state, { type: 'call', seat: secondCaller!, call: false })
    state = applyAction(state, { type: 'call', seat: thirdCaller!, call: false })
    const view = tableViewFromEngine(state, 0, SEAT_META)

    expect(view.phase).toBe('playing')
    expect(view.landlord).toBe(firstCaller)
    expect(view.bottom).toHaveLength(3)
    expect(view.seats.find((seat) => seat.seat === firstCaller)?.role).toBe('landlord')
  })
})
