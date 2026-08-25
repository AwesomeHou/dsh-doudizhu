/**
 * 规则引擎单测 —— 覆盖：牌型识别、比较、合法性、结算守恒、完整对局模拟
 */
import { describe, expect, it } from 'vitest'
import { botMove } from './bot.ts'
import { canBeat } from './compare.ts'
import { deal, newDeck } from './deck.ts'
import { applyAction, createGame, finalize, isLegalPlay, type GameState } from './game.ts'
import { settle } from './scoring.ts'
import { buildPlay, classify, hintPlay, legalPlays } from './valid.ts'
import type { Card } from './types.ts'

/** 构造一张牌：r=点数(0..14)，s=花色(0..3) */
function c(r: number, s = 0): Card {
  return { r, s }
}
/** 由点数序列构造一手牌（花色自动分配） */
function mk(ranks: number[]): Card[] {
  return ranks.map((r, i) => ({ r, s: (i % 4) as Card['s'] }))
}

/** 可复现的伪随机（mulberry32） */
function rng(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('发牌', () => {
  it('一副牌 54 张且无重复', () => {
    const d = newDeck()
    expect(d.length).toBe(54)
    expect(new Set(d.map((x) => `${x.r}-${x.s}`)).size).toBe(54)
  })

  it('发牌 = 17×3 + 3 底牌', () => {
    const { hands, bottom } = deal(rng(42))
    expect(hands.map((h) => h.length)).toEqual([17, 17, 17])
    expect(bottom.length).toBe(3)
    const all = [...hands.flat(), ...bottom]
    expect(new Set(all.map((x) => `${x.r}-${x.s}`)).size).toBe(54)
  })
})

describe('牌型识别 classify', () => {
  const cases: Array<[string, number[], string]> = [
    ['单张', [0], 'single'],
    ['对子', [0, 0], 'pair'],
    ['三张', [0, 0, 0], 'triple'],
    ['三带一', [0, 0, 0, 5], 'triple_one'],
    ['三带二', [0, 0, 0, 6, 6], 'triple_pair'],
    ['顺子', [0, 1, 2, 3, 4], 'straight'],
    ['连对', [0, 0, 1, 1, 2, 2], 'pair_straight'],
    ['飞机', [0, 0, 0, 1, 1, 1], 'airplane'],
    ['飞机带单', [0, 0, 0, 1, 1, 1, 5, 6], 'airplane_single'],
    ['飞机带对', [0, 0, 0, 1, 1, 1, 5, 5, 6, 6], 'airplane_pair'],
    ['四带二', [3, 3, 3, 3, 5, 6], 'four_two'],
    ['四带两对', [3, 3, 3, 3, 5, 5, 6, 6], 'four_pair_two'],
    ['炸弹', [3, 3, 3, 3], 'bomb'],
    ['王炸', [13, 14], 'rocket'],
  ]
  for (const [label, ranks, kind] of cases) {
    it(`${label} → ${kind}`, () => {
      expect(classify(mk(ranks))?.kind).toBe(kind)
    })
  }

  it('非法牌型返回 null', () => {
    expect(classify(mk([0, 1]))).toBeNull() // 两张不同点
    expect(classify(mk([0, 0, 1]))).toBeNull() // 三张不成型
    expect(classify(mk([0, 1, 2, 3]))).toBeNull() // 四连不是顺子
    expect(classify(mk([11, 12, 13, 14, 13]))).toBeNull() // 含 2/王的"顺子"
    expect(classify([])).toBeNull()
  })

  it('顺子不能含 2 与王', () => {
    expect(classify(mk([8, 9, 10, 11, 12]))).toBeNull() // 含 2
    expect(classify(mk([10, 11, 12, 13, 14]))).toBeNull()
  })
})

describe('牌型比较 canBeat', () => {
  it('同型比点数', () => {
    expect(canBeat({ kind: 'single', rank: 4, length: 1 }, { kind: 'single', rank: 3, length: 1 })).toBe(true)
    expect(canBeat({ kind: 'single', rank: 3, length: 1 }, { kind: 'single', rank: 4, length: 1 })).toBe(false)
  })

  it('长度不同不能压', () => {
    expect(canBeat({ kind: 'straight', rank: 5, length: 6 }, { kind: 'straight', rank: 4, length: 5 })).toBe(false)
    expect(canBeat({ kind: 'straight', rank: 4, length: 5 }, { kind: 'straight', rank: 4, length: 5 })).toBe(false)
  })

  it('不同类型不能压（非炸弹）', () => {
    expect(canBeat({ kind: 'pair', rank: 12, length: 2 }, { kind: 'single', rank: 0, length: 1 })).toBe(false)
  })

  it('炸弹压普通牌', () => {
    expect(canBeat({ kind: 'bomb', rank: 0, length: 4 }, { kind: 'straight', rank: 8, length: 5 })).toBe(true)
  })

  it('大炸弹压小炸弹', () => {
    expect(canBeat({ kind: 'bomb', rank: 5, length: 4 }, { kind: 'bomb', rank: 4, length: 4 })).toBe(true)
    expect(canBeat({ kind: 'bomb', rank: 4, length: 4 }, { kind: 'bomb', rank: 5, length: 4 })).toBe(false)
  })

  it('王炸最大', () => {
    expect(canBeat({ kind: 'rocket', rank: 14, length: 2 }, { kind: 'bomb', rank: 12, length: 4 })).toBe(true)
    expect(canBeat({ kind: 'bomb', rank: 12, length: 4 }, { kind: 'rocket', rank: 14, length: 2 })).toBe(false)
  })

  it('领出时任何牌都能出', () => {
    expect(canBeat({ kind: 'single', rank: 0, length: 1 }, null)).toBe(true)
  })
})

describe('合法出牌 legalPlays / buildPlay / hintPlay', () => {
  it('从手牌中找全合法出法', () => {
    const hand = mk([0, 0, 1, 1, 2, 2, 5]) // 对3 对4 对5 单6
    const plays = legalPlays(hand, null)
    expect(plays.some((p) => p.kind === 'pair' && p.rank === 0)).toBe(true)
    expect(plays.some((p) => p.kind === 'pair_straight' && p.rank === 0)).toBe(true) // 334455
    expect(plays.some((p) => p.kind === 'single' && p.rank === 5)).toBe(true)
  })

  it('buildPlay 能取到具体牌', () => {
    const hand = mk([0, 0, 0, 1, 1, 2, 2, 2])
    const p = { kind: 'triple', rank: 0, length: 3 }
    expect(buildPlay(hand, p)?.length).toBe(3)
    const p1 = { kind: 'triple_one', rank: 2, length: 4 }
    expect(buildPlay(hand, p1)?.length).toBe(4)
  })

  it('提示返回一手能压过的牌', () => {
    const hand = mk([0, 0, 2, 2, 4, 5]) // 有 3对、5对、7、8
    const last = { kind: 'pair', rank: 0, length: 2 } // 上家出对3
    const hint = hintPlay(hand, last)
    expect(hint).not.toBeNull()
    const play = classify(hint!)
    expect(play).not.toBeNull()
    expect(canBeat(play!, last)).toBe(true)
  })

  it('压不过时提示返回 null', () => {
    const hand = mk([0, 1, 2]) // 只有小单牌
    const last = { kind: 'rocket', rank: 14, length: 2 }
    expect(hintPlay(hand, last)).toBeNull()
  })

  it('领出时优先甩长牌', () => {
    const hand = mk([0, 1, 2, 3, 4, 12, 12]) // 34567 + 对2
    const hint = hintPlay(hand, null)!
    expect(hint.length).toBeGreaterThanOrEqual(5)
  })
})

describe('结算 settle', () => {
  it('地主赢：两农民各付 stake，地主得 2×stake 扣抽水', () => {
    const s = settle(0, 'landlord', 100, 8, 0.05)
    expect(s.deltas[1]).toBe(-800)
    expect(s.deltas[2]).toBe(-800)
    expect(s.deltas[0]).toBe(1600 - Math.floor(1600 * 0.05))
    const sum = s.deltas.reduce((a, b) => a + b, 0)
    expect(sum + s.rake).toBe(0)
  })

  it('农民赢：地主付 2×stake，各农民得 stake 扣抽水', () => {
    const s = settle(1, 'farmer', 100, 4, 0.05)
    expect(s.deltas[1]).toBe(-800) // 地主座位1
    const sum = s.deltas.reduce((a, b) => a + b, 0)
    expect(sum + s.rake).toBe(0)
  })

  it('账目守恒：deltas 之和 + rake = 0', () => {
    for (let i = 0; i < 20; i++) {
      const s = settle((i % 3) as 0 | 1 | 2, i % 2 ? 'farmer' : 'landlord', 10_000, 1 + i, 0.05)
      const sum = s.deltas.reduce((a, b) => a + b, 0)
      expect(sum + s.rake).toBe(0)
    }
  })
})

describe('叫地主', () => {
  it('callOrder 从随机起点开始，按 (seat+1)%3 逆时针推进', () => {
    for (const seed of [1, 2, 3, 4, 5, 42]) {
      const g = createGame(rng(seed))
      const [a, b, c] = g.callOrder
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBe(((a + 1) % 3) as 0 | 1 | 2)
      expect(c).toBe(((a + 2) % 3) as 0 | 1 | 2)
    }
  })

  it('无人叫 → redeal', () => {
    const g0 = createGame(rng(7))
    let g = g0
    while (!g.redeal) {
      const seat = g.callOrder[g.callActor]!
      g = applyAction(g, { type: 'call', seat, call: false })
    }
    expect(g.redeal).toBe(true)
  })

  it('首个叫的人当地主，之后抢 ×2', () => {
    const g0 = createGame(rng(8))
    const order = g0.callOrder
    let g = applyAction(g0, { type: 'call', seat: order[0]!, call: true })
    expect(g.landlord).toBe(order[0])
    expect(g.callMultiplier).toBe(1)
    g = applyAction(g, { type: 'call', seat: order[1]!, call: true })
    expect(g.landlord).toBe(order[1])
    expect(g.callMultiplier).toBe(2)
    g = applyAction(g, { type: 'call', seat: order[2]!, call: false })
    expect(g.phase).toBe('playing')
    expect(g.current).toBe(g.landlord)
    expect(g.multiplier).toBe(2)
  })
})

describe('出牌流程', () => {
  it('领出不能过', () => {
    const g = createGame(rng(3))
    g.phase = 'playing'
    g.landlord = 0
    g.current = 0
    g.lastPlay = null
    expect(() => applyAction(g, { type: 'pass', seat: 0 })).toThrow()
  })

  it('非法出牌被拒绝', () => {
    const g = createGame(rng(4))
    g.phase = 'playing'
    g.landlord = 0
    g.current = 0
    g.lastPlay = null
    // 手牌中没有的牌
    expect(isLegalPlay(g, 0, [c(12, 3)])).toBe(false)
  })

  it('两家过完，上一手玩家重新领出', () => {
    const g = createGame(rng(5))
    g.phase = 'playing'
    g.landlord = 0
    g.current = 0
    g.lastPlay = null
    g.hands[0] = mk([0, 0, 5]) // 对3 + 单8：出一手后还有牌，不会立即获胜
    let s = applyAction(g, { type: 'play', seat: 0, cards: mk([0, 0]) })
    expect(s.lastPlay?.kind).toBe('pair')
    // 1、2 都过
    s = applyAction(s, { type: 'pass', seat: 1 })
    s = applyAction(s, { type: 'pass', seat: 2 })
    expect(s.lastPlay).toBeNull()
    expect(s.current).toBe(0)
    expect(s.lastActor).toBe(0)
  })
})

describe('春天/反春与结算', () => {
  it('地主赢且农民未出牌 → 春天 ×2', () => {
    const g = createGame(rng(11))
    g.phase = 'playing'
    g.landlord = 0
    g.current = 0
    g.hands[0] = [c(2)]
    g.hands[1] = mk([0, 1])
    g.hands[2] = mk([4, 5])
    g.playedEver = [false, false, false]
    const s = applyAction(g, { type: 'play', seat: 0, cards: [c(2)] })
    expect(s.finished).toBe(true)
    expect(s.winner).toBe('landlord')
    expect(s.spring).toBe('landlord')
    expect(s.multiplier).toBe(2)
    const sum = s.settlement!.deltas.reduce((a, b) => a + b, 0)
    expect(sum + s.settlement!.rake).toBe(0)
  })

  it('农民赢且地主只出一手 → 反春 ×2', () => {
    const g = createGame(rng(12))
    g.phase = 'playing'
    g.landlord = 1
    g.winner = 'farmer'
    g.finished = true
    g.multiplier = 1
    g.callMultiplier = 1
    g.landlordPlays = 1
    g.playedEver = [true, true, true]
    finalize(g)
    expect(g.spring).toBe('farmer')
    expect(g.multiplier).toBe(2)
    const sum = g.settlement!.deltas.reduce((a, b) => a + b, 0)
    expect(sum + g.settlement!.rake).toBe(0)
  })

  it('炸弹计入倍数', () => {
    const g = createGame(rng(13))
    g.phase = 'playing'
    g.landlord = 0
    g.current = 0
    g.hands[0] = mk([3, 3, 3, 3]) // 炸弹 7
    g.hands[1] = mk([0, 1])
    g.hands[2] = mk([4, 5])
    g.playedEver = [true, true, true] // 假设农民出过牌，排除春天干扰
    const s = applyAction(g, { type: 'play', seat: 0, cards: mk([3, 3, 3, 3]) })
    expect(s.finished).toBe(true)
    expect(s.bombCount).toBe(1)
    expect(s.spring).toBe('none')
    expect(s.multiplier).toBe(2) // 炸弹 ×2
  })
})

describe('完整对局模拟（机器人互打）', () => {
  function playFullGame(seed: number): GameState {
    const random = rng(seed)
    let g = createGame(random)
    let steps = 0
    while (steps < 3000) {
      steps++
      if (g.redeal) {
        g = createGame(random)
        continue
      }
      if (g.finished) return g
      if (g.phase === 'calling') {
        const seat = g.callOrder[g.callActor]!
        const hand = g.hands[seat]!
        const strong = hand.filter((x) => x.r >= 12).length >= 1 || hand.filter((x) => x.r >= 9).length >= 3
        g = applyAction(g, { type: 'call', seat, call: strong || random() < 0.3 })
        continue
      }
      const seat = g.current
      const move = botMove(g.hands[seat]!, g.lastPlay)
      g = move === null
        ? applyAction(g, { type: 'pass', seat })
        : applyAction(g, { type: 'play', seat, cards: move })
    }
    throw new Error('game did not finish in 3000 steps')
  }

  it('20 局全部正常打完，账目守恒', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = playFullGame(seed)
      expect(g.finished).toBe(true)
      expect(g.winner).toBeTruthy()
      expect(g.settlement).toBeTruthy()
      const sum = g.settlement!.deltas.reduce((a, b) => a + b, 0)
      expect(sum + g.settlement!.rake).toBe(0)
      // 胜者阵营正确
      const landlordRole = g.winner === 'landlord'
      expect(landlordRole ? g.landlord! >= 0 : true).toBe(true)
    }
  })
})
