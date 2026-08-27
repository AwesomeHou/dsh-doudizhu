/**
 * 经济/桌别/段位配置测试 —— 锁定当前数值，防止无意改坏经济模型
 */
import { describe, expect, it } from 'vitest'
import { CONFIG, rankForBalance, tableById } from './config.ts'

describe('经济数值（v0.3.0 调整）', () => {
  it('签到与救济金均为 2000 Token', () => {
    expect(CONFIG.dailyTokens).toBe(2_000)
    expect(CONFIG.rescueTokens).toBe(2_000)
  })

  it('开局倍数为 15', () => {
    expect(CONFIG.startMultiplier).toBe(15)
  })

  it('叫地主/抢地主/加倍决策倒计时 5s', () => {
    expect(CONFIG.decisionTimeoutMs).toBe(5_000)
    expect(CONFIG.turnTimeoutMs).toBe(25_000)
  })

  it('桌别：新手场 15 / 普通场 80 / 高级场 480，门槛递增', () => {
    const [novice, normal, high] = CONFIG.tables
    expect(novice.base).toBe(15)
    expect(normal.base).toBe(80)
    expect(high.base).toBe(480)
    // 门槛严格递增
    const mins = CONFIG.tables.map((t) => t.minBalance)
    expect(mins).toEqual([...mins].sort((a, b) => a - b))
    // 新手场设上限 1千~15万
    expect(novice.minBalance).toBe(1_000)
    expect(novice.maxBalance).toBe(150_000)
    expect(normal.minBalance).toBe(5_000)
    expect(high.minBalance).toBe(40_000)
    expect(normal.maxBalance).toBeUndefined()
    expect(high.maxBalance).toBeUndefined()
  })

  it('救济金足以回到最低桌（2000 ≥ 新手场门槛 1000）', () => {
    expect(CONFIG.rescueTokens).toBeGreaterThanOrEqual(Math.min(...CONFIG.tables.map((t) => t.minBalance)))
  })

  it('段位门槛按新经济缩放：0/5k/20k/100k/500k/2M', () => {
    expect(CONFIG.ranks.map((r) => r.min)).toEqual([0, 5_000, 20_000, 100_000, 500_000, 2_000_000])
    // 严格递增
    const mins = CONFIG.ranks.map((r) => r.min)
    for (let i = 1; i < mins.length; i++) expect(mins[i]!).toBeGreaterThan(mins[i - 1]!)
  })

  it('rankForBalance 按新阈值判定', () => {
    expect(rankForBalance(0).name).toBe('小难梁')
    expect(rankForBalance(4_999).name).toBe('小难梁')
    expect(rankForBalance(5_000).name).toBe('牢梁')
    expect(rankForBalance(20_000).name).toBe('梁子')
    expect(rankForBalance(100_000).name).toBe('梁圣')
    expect(rankForBalance(2_000_000).name).toBe('梁祖')
  })

  it('tableById 命中', () => {
    expect(tableById('novice')?.base).toBe(15)
    expect(tableById('missing')).toBeUndefined()
  })
})
