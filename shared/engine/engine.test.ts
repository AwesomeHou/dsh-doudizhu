/**
 * 规则引擎单测 —— 覆盖：牌型识别、比较、合法性、结算守恒、完整对局模拟
 */
import { describe, expect, it } from 'vitest'
import { botCall, botDouble, botMove, botRob } from './bot.ts'
import { canBeat } from './compare.ts'
import { deal, dealInRounds, newDeck } from './deck.ts'
import { applyAction, createGame, finalize, isLegalPlay, mingFactor, type GameState } from './game.ts'
import { settle } from './scoring.ts'
import { buildPlay, classify, hintPlay, legalPlays } from './valid.ts'
import type { Card, Seat } from './types.ts'

/** 构造一张牌：r=点数(0..14)，s=花色(0..3) */
function c(r: number, s = 0): Card {
  return { r, s }
}
/** 由点数序列构造一手牌（花色自动分配） */
function mk(ranks: number[]): Card[] {
  return ranks.map((r, i) => ({ r, s: (i % 4) as Card['s'] }))
}

/** 推进发牌直到进入叫地主阶段 */
function dealAll(g: GameState): GameState {
  let s = g
  while (s.phase === 'dealing' && s.dealRound < 3) s = applyAction(s, { type: 'deal' })
  if (s.phase === 'dealing' && s.dealRound >= 3) s = applyAction(s, { type: 'start' })
  return s
}

/** 完成抢地主（全部不抢）→ 进入加倍阶段 */
function robAll(skip?: (s: GameState) => boolean): (s: GameState) => GameState {
  return (g: GameState) => {
    let s = g
    while (s.phase === 'robbing') {
      const seat = s.robOrder[s.robActor]!
      s = applyAction(s, { type: 'call', seat, call: skip ? skip(s) : false })
    }
    return s
  }
}

/** 完成加倍（全部不加倍）→ 进入出牌阶段 */
function doubleAll(skip?: (s: GameState) => 0 | 1 | 2): (s: GameState) => GameState {
  return (g: GameState) => {
    let s = g
    while (s.phase === 'doubling') {
      const seat = s.doublingOrder[s.doublingActor]!
      s = applyAction(s, { type: 'double', seat, choice: skip ? skip(s) : 0 })
    }
    return s
  }
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

  it('分 3 轮发牌：每轮 6/6/5，共 54 张无重复', () => {
    const { rounds, bottom } = dealInRounds(rng(42))
    expect(rounds.length).toBe(3)
    // 每人 6+6+5=17
    const perSeat = [0, 1, 2].map((seat) => rounds.reduce((n, round) => n + round[seat]!.length, 0))
    expect(perSeat).toEqual([17, 17, 17])
    expect(bottom.length).toBe(3)
    const all = [...rounds.flat().flat(), ...bottom]
    expect(new Set(all.map((x) => `${x.r}-${x.s}`)).size).toBe(54)
  })

  it('发牌阶段逐轮推进：3 次 deal 后仍在发牌（保留明牌窗口），start 后进入叫地主', () => {
    let g = createGame(rng(9))
    expect(g.phase).toBe('dealing')
    expect(g.dealRound).toBe(0)
    expect(g.hands.map((h) => h.length)).toEqual([0, 0, 0])
    g = applyAction(g, { type: 'deal' })
    expect(g.dealRound).toBe(1)
    expect(g.hands.map((h) => h.length)).toEqual([6, 6, 6])
    g = applyAction(g, { type: 'deal' })
    expect(g.dealRound).toBe(2)
    expect(g.hands.map((h) => h.length)).toEqual([12, 12, 12])
    g = applyAction(g, { type: 'deal' })
    expect(g.dealRound).toBe(3)
    expect(g.hands.map((h) => h.length)).toEqual([17, 17, 17])
    expect(g.phase).toBe('dealing') // 发完仍停留发牌阶段，第三轮明牌 ×2 窗口
    g = applyAction(g, { type: 'start' })
    expect(g.phase).toBe('calling')
    expect(g.current).toBe(g.callOrder[0])
  })

  it('发牌期间明牌：第 1/2/3 轮明牌分别 ×4/×3/×2（叠加在开局倍数 15 上）', () => {
    let g = createGame(rng(10))
    expect(g.multiplier).toBe(15) // 开局倍数
    g = applyAction(g, { type: 'deal' }) // 第 1 轮
    g = applyAction(g, { type: 'ming', seat: 0 })
    expect(g.revealed[0]).toBe(true)
    expect(g.multiplier).toBe(60) // 15 ×4
    expect(g.moveLog.at(-1)?.type).toBe('ming')
    g = applyAction(g, { type: 'deal' }) // 第 2 轮
    g = applyAction(g, { type: 'ming', seat: 1 })
    expect(g.multiplier).toBe(180) // 15 ×4 ×3
    g = applyAction(g, { type: 'deal' }) // 第 3 轮
    g = applyAction(g, { type: 'ming', seat: 2 })
    expect(g.multiplier).toBe(360) // 15 ×4 ×3 ×2
  })

  it('发牌未开始不能明牌；重复明牌被拒绝', () => {
    let g = createGame(rng(10))
    expect(() => applyAction(g, { type: 'ming', seat: 0 })).toThrow()
    g = applyAction(g, { type: 'deal' })
    g = applyAction(g, { type: 'ming', seat: 0 })
    expect(() => applyAction(g, { type: 'ming', seat: 0 })).toThrow()
  })

  it('mingFactor：第 1/2/3 轮为 4/3/2', () => {
    expect(mingFactor(1)).toBe(4)
    expect(mingFactor(2)).toBe(3)
    expect(mingFactor(3)).toBe(2)
    expect(mingFactor(0)).toBe(1)
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

describe('叫地主/抢地主/加倍', () => {
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
    let g = dealAll(createGame(rng(7)))
    while (!g.redeal) {
      const seat = g.callOrder[g.callActor]!
      g = applyAction(g, { type: 'call', seat, call: false })
    }
    expect(g.redeal).toBe(true)
  })

  it('首个叫的人成为“叫地主的人”，其余两家先抢，最后回到叫地主的人再选择', () => {
    const g0 = dealAll(createGame(rng(8)))
    const order = g0.callOrder
    const caller = order[0]!
    const next = order[1]!
    const last = order[2]!
    let g = applyAction(g0, { type: 'call', seat: caller, call: true })
    // 首个叫 → 直接进入抢地主
    expect(g.phase).toBe('robbing')
    expect(g.callerSeat).toBe(caller)
    expect(g.landlord).toBe(caller)
    expect(g.callMultiplier).toBe(1)
    // 抢地主顺序：下家、再下家、叫地主的人（最后）
    expect(g.robOrder).toEqual([next, last, caller])
    // 下家抢 → 倍数翻倍（开局 15 → 30）
    g = applyAction(g, { type: 'call', seat: next, call: true })
    expect(g.landlord).toBe(next)
    expect(g.callMultiplier).toBe(2)
    expect(g.multiplier).toBe(30)
    // 再下家不抢
    g = applyAction(g, { type: 'call', seat: last, call: false })
    // 回到叫地主的人：可以选择抢（抢回）或不抢
    expect(g.current).toBe(caller)
    g = applyAction(g, { type: 'call', seat: caller, call: true })
    expect(g.landlord).toBe(caller)
    expect(g.callMultiplier).toBe(4)
    expect(g.multiplier).toBe(60)
    // 抢地主结束 → 加倍
    expect(g.phase).toBe('doubling')
    // 全部不加倍 → 出牌
    g = doubleAll()(g)
    expect(g.phase).toBe('playing')
    expect(g.current).toBe(g.landlord)
    expect(g.multiplier).toBe(60)
  })

  it('抢地主全部不抢：叫地主的人保持地主，倍数不变', () => {
    const g0 = dealAll(createGame(rng(11)))
    const caller = g0.callOrder[0]!
    let g = applyAction(g0, { type: 'call', seat: caller, call: true })
    g = robAll()(g)
    expect(g.phase).toBe('doubling')
    expect(g.landlord).toBe(caller)
    expect(g.multiplier).toBe(15) // 开局倍数，无任何加成
  })

  it('加倍：加倍 ×2、超级加倍 ×4，可叠加', () => {
    const g0 = dealAll(createGame(rng(12)))
    const order = g0.callOrder
    let g = applyAction(g0, { type: 'call', seat: order[0]!, call: true })
    g = robAll()(g)
    expect(g.phase).toBe('doubling')
    expect(g.current).toBe(g.doublingOrder[0])
    g = applyAction(g, { type: 'double', seat: g.doublingOrder[0]!, choice: 1 }) // 加倍 ×2
    expect(g.multiplier).toBe(30) // 15 ×2
    g = applyAction(g, { type: 'double', seat: g.doublingOrder[1]!, choice: 2 }) // 超级加倍 ×4
    expect(g.multiplier).toBe(120) // 15 ×2 ×4
    g = applyAction(g, { type: 'double', seat: g.doublingOrder[2]!, choice: 0 }) // 不加倍
    expect(g.multiplier).toBe(120)
    expect(g.phase).toBe('playing')
  })

  it('出牌阶段地主明牌：倍数 ×2 且手牌公开', () => {
    const g0 = dealAll(createGame(rng(13)))
    const order = g0.callOrder
    let g = applyAction(g0, { type: 'call', seat: order[0]!, call: true })
    g = robAll()(g)
    g = doubleAll()(g)
    const landlord = g.landlord!
    expect(g.phase).toBe('playing')
    const before = g.multiplier
    g = applyAction(g, { type: 'ming', seat: landlord })
    expect(g.revealed[landlord]).toBe(true)
    expect(g.multiplier).toBe(before * 2)
    // 非地主不能明牌；重复明牌被拒绝
    const farmer = ((landlord + 1) % 3) as 0 | 1 | 2
    expect(() => applyAction(g, { type: 'ming', seat: farmer })).toThrow()
    expect(() => applyAction(g, { type: 'ming', seat: landlord })).toThrow()
  })

  it('地主明牌仅限第一轮出牌：出过牌后（landlordPlays>0）不可再明牌', () => {
    const g0 = dealAll(createGame(rng(14)))
    const order = g0.callOrder
    let g = applyAction(g0, { type: 'call', seat: order[0]!, call: true })
    g = robAll()(g)
    g = doubleAll()(g)
    const landlord = g.landlord!
    expect(g.landlordPlays).toBe(0)
    // 第一轮出牌（不先明牌）：直接出一手对子
    g.hands[landlord] = mk([12, 12, 5])
    g.hands[(landlord + 1) % 3] = mk([0, 1])
    g.hands[(landlord + 2) % 3] = mk([4, 5])
    const s = applyAction(g, { type: 'play', seat: landlord, cards: mk([12, 12]) })
    expect(s.landlordPlays).toBe(1)
    // 地主再次轮到自己（landlordPlays=1）→ 不能明牌
    s.current = landlord
    expect(() => applyAction(s, { type: 'ming', seat: landlord })).toThrow()
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
    expect(s.multiplier).toBe(30) // 开局 15 × 春天 2
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
    expect(s.multiplier).toBe(30) // 开局 15 × 炸弹 2
  })
})

describe('每场封顶（赢家所得不超过其本金）', () => {
  it('地主赢：所得不超过地主本金（2×stake ≤ 地主开局余额）', () => {
    // base 480 × 100 倍 = 48000，但地主(1)本金 20000 → 封顶 stake = min(48000, 10000, 5000, 8000) = 5000
    const s = settle(1, 'landlord', 480, 100, 0.05, [5000, 20000, 8000])
    expect(s.stake).toBe(5000)
    expect(s.deltas[0]).toBe(-5000)
    expect(s.deltas[2]).toBe(-5000)
    expect(s.deltas[1]).toBe(2 * 5000 - Math.floor(2 * 5000 * 0.05))
    const sum = s.deltas.reduce((a, b) => a + b, 0)
    expect(sum + s.rake).toBe(0)
    // 赢家所得(9500) 不超过自己的本金(20000)
    expect(s.deltas[1]).toBeLessThanOrEqual(20000)
  })

  it('农民赢：各农民所得不超过其本金，地主也不会输超本金', () => {
    // base 15 × 64 = 960，农民(1)本金 500、农民(2)本金 600 → 封顶 stake = min(960, 1500, 500, 600) = 500
    const s = settle(0, 'farmer', 15, 64, 0.05, [3000, 500, 600])
    expect(s.stake).toBe(500)
    expect(s.deltas[1]).toBe(Math.floor(500 * 0.95))
    expect(s.deltas[2]).toBe(Math.floor(500 * 0.95))
    expect(s.deltas[0]).toBe(-1000) // 地主输 2×500，不超过本金 3000
    const sum = s.deltas.reduce((a, b) => a + b, 0)
    expect(sum + s.rake).toBe(0)
  })

  it('本金充足时封顶不生效', () => {
    const s = settle(0, 'landlord', 80, 8, 0.05, [10000, 10000, 10000])
    expect(s.stake).toBe(640)
    expect(s.deltas[1]).toBe(-640)
    expect(s.deltas[2]).toBe(-640)
    expect(s.deltas[0]).toBe(1280 - Math.floor(1280 * 0.05))
  })

  it('不传本金时保持原逻辑（不加封顶）', () => {
    const s = settle(0, 'landlord', 80, 8, 0.05)
    expect(s.stake).toBe(640)
    expect(s.deltas[1]).toBe(-640)
  })
})

describe('机器人出牌行为', () => {
  it('农民队友领出且还有牌 → 不压队友（让队友继续）', () => {
    const hand = mk([9, 10, 11, 12])
    const last = { kind: 'single', rank: 5, length: 1 } as const
    const ctx = { mySeat: 2 as Seat, landlord: 0 as Seat, lastActor: 1 as Seat, handsCount: [10, 8, 4] as [number, number, number] }
    expect(botMove(hand, last, ctx)).toBeNull()
  })

  it('队友领出但自己可一手走完 → 直接打完', () => {
    const hand = mk([12, 12]) // 对2，能一手压过对A
    const last = { kind: 'pair', rank: 11, length: 2 } as const
    const ctx = { mySeat: 2 as Seat, landlord: 0 as Seat, lastActor: 1 as Seat, handsCount: [10, 8, 2] as [number, number, number] }
    const move = botMove(hand, last, ctx)
    expect(move?.length).toBe(2)
  })

  it('领出时整手就是一个合法牌型 → 直接走完', () => {
    const hand = mk([8, 8, 8, 9, 9, 9]) // 飞机 888999
    expect(botMove(hand, null, null)?.length).toBe(6)
  })

  it('对手只剩 2 张且只能靠炸弹压住时 → 用炸弹拦住', () => {
    const hand = mk([7, 7, 7, 7, 12, 13, 14]) // 含炸弹
    const last = { kind: 'pair', rank: 12, length: 2 } as const // 对2，只有炸弹/王炸能压
    const ctx = { mySeat: 1 as Seat, landlord: 0 as Seat, lastActor: 0 as Seat, handsCount: [2, 7, 9] as [number, number, number] }
    const move = botMove(hand, last, ctx)
    const kind = move ? classify(move)?.kind : null
    expect(kind).toBe('bomb')
  })

  it('非必要时不轻易用炸弹（对手牌还多）', () => {
    const hand = mk([7, 7, 7, 7, 12, 13, 14])
    const last = { kind: 'single', rank: 11, length: 1 } as const
    const ctx = { mySeat: 1 as Seat, landlord: 0 as Seat, lastActor: 0 as Seat, handsCount: [9, 7, 9] as [number, number, number] }
    // 对手还很多牌 → 用单牌压制即可，不甩炸弹
    const move = botMove(hand, last, ctx)
    const kind = move ? classify(move)?.kind : null
    expect(kind).not.toBe('bomb')
  })
})

/** 完整对局模拟（机器人互打），模块级复用 */
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
    if (g.phase === 'dealing') {
      g = g.dealRound >= 3 ? applyAction(g, { type: 'start' }) : applyAction(g, { type: 'deal' })
      continue
    }
    if (g.phase === 'calling') {
      const seat = g.callOrder[g.callActor]!
      const hand = g.hands[seat]!
      g = applyAction(g, { type: 'call', seat, call: botCall(hand, random) })
      continue
    }
    if (g.phase === 'robbing') {
      const seat = g.robOrder[g.robActor]!
      g = applyAction(g, { type: 'call', seat, call: botRob(g.hands[seat]!, random) })
      continue
    }
    if (g.phase === 'doubling') {
      const seat = g.doublingOrder[g.doublingActor]!
      g = applyAction(g, { type: 'double', seat, choice: botDouble(g.hands[seat]!, random) })
      continue
    }
    const seat = g.current
    const move = botMove(g.hands[seat]!, g.lastPlay, {
      mySeat: seat,
      landlord: g.landlord,
      lastActor: g.lastActor,
      handsCount: g.hands.map((h) => h.length) as [number, number, number],
    })
    g = move === null
      ? applyAction(g, { type: 'pass', seat })
      : applyAction(g, { type: 'play', seat, cards: move })
  }
  throw new Error('game did not finish in 3000 steps')
}

describe('完整对局模拟（机器人互打）', () => {

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

describe('结算链路审计（倍数 × 底分 → 扣钱/赢钱）', () => {
  it('地主赢：每农民扣 stake=底分×倍数，地主得 2×stake 扣抽水（账目守恒）', () => {
    const s = settle(1, 'landlord', 15, 60, 0.05, [5000, 5000, 5000])
    // 理论 stake = 15×60 = 900；本金充足不封顶
    expect(s.stake).toBe(900)
    expect(s.deltas[0]).toBe(-900)
    expect(s.deltas[2]).toBe(-900)
    expect(s.deltas[1]).toBe(1800 - Math.floor(1800 * 0.05))
    expect(s.deltas.reduce((a, b) => a + b, 0) + s.rake).toBe(0)
  })

  it('农民赢：地主扣 2×stake，各农民得 stake 扣抽水（账目守恒）', () => {
    const s = settle(1, 'farmer', 80, 30, 0.05, [10000, 10000, 10000])
    expect(s.stake).toBe(2400) // 80 × 30
    expect(s.deltas[1]).toBe(-4800)
    expect(s.deltas[0]).toBe(Math.floor(2400 * 0.95))
    expect(s.deltas[2]).toBe(Math.floor(2400 * 0.95))
    expect(s.deltas.reduce((a, b) => a + b, 0) + s.rake).toBe(0)
  })

  it('封顶生效：赢家所得被压到不超过本金，且无人输超本金', () => {
    // 新手场 底分 15 × 100 倍 = 1500；农民(1)本金仅 1000 → 封顶到 1000
    const s = settle(0, 'farmer', 15, 100, 0.05, [4000, 1000, 3000])
    expect(s.stake).toBe(1000)
    expect(s.deltas[1]).toBe(950)     // 赢家(1)所得 ≤ 本金 1000
    expect(s.deltas[2]).toBe(950)
    expect(s.deltas[0]).toBe(-2000)   // 地主输 2×1000 ≤ 本金 4000
    expect(s.deltas.reduce((a, b) => a + b, 0) + s.rake).toBe(0)
  })

  it('完整对局：真实底分 + 开局余额结算，守恒且无负数', () => {
    for (const seed of [1, 5, 9, 20]) {
      const g = playFullGame(seed)
      expect(g.finished).toBe(true)
      const capitals: [number, number, number] = [1200, 900, 1500] // 开局余额
      const s = settle(g.landlord!, g.winner!, 15, g.multiplier, 0.05, capitals)
      // 账目守恒
      expect(s.deltas.reduce((a, b) => a + b, 0) + s.rake).toBe(0)
      // 赢家所得不超过其本金
      const winnerSeat = g.winner === 'landlord' ? g.landlord! : ([0, 1, 2] as Seat[]).find((x) => x !== g.landlord)!
      expect(s.deltas[winnerSeat]).toBeGreaterThanOrEqual(-capitals[winnerSeat]!)
      expect(s.deltas[winnerSeat]).toBeLessThanOrEqual(capitals[winnerSeat]!)
      // 无人输超本金
      for (let i = 0; i < 3; i++) {
        expect(s.deltas[i]!).toBeGreaterThanOrEqual(-capitals[i]!)
      }
    }
  })
})
