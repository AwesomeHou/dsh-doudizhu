/**
 * 全局可配置数值（客户端/服务端共用；M1 本地模拟也用它）
 */
export interface TableConfig {
  id: string
  label: string
  base: number
  minBalance: number
}

export interface RankConfig {
  id: number
  name: string
  /** 段位门槛（Token 总余额下限） */
  min: number
}

export const CONFIG = {
  /** 每日签到 Token */
  dailyTokens: 200_000,
  /** 破产救济金 */
  rescueTokens: 100_000,
  /** 平台抽水率 */
  rakeRate: 0.05,
  /** 每手出牌倒计时（ms） */
  turnTimeoutMs: 25_000,
  /** 桌别（门槛=底注×N，保证救济金 100k 可回到最低桌） */
  tables: [
    { id: 'novice', label: '新手桌', base: 10_000, minBalance: 100_000 },
    { id: 'advanced', label: '进阶桌', base: 50_000, minBalance: 1_000_000 },
    { id: 'high', label: '高倍桌', base: 200_000, minBalance: 4_000_000 },
  ] as TableConfig[],
  /** 段位（按 Token 当前余额实时划分：达标即升，输钱即降） */
  ranks: [
    { id: 1, name: '小难梁', min: 0 },
    { id: 2, name: '牢梁', min: 500_000 },
    { id: 3, name: '梁子', min: 2_000_000 },
    { id: 4, name: '梁圣', min: 10_000_000 },
    { id: 5, name: '梁神', min: 50_000_000 },
    { id: 6, name: '梁祖', min: 200_000_000 },
  ] as RankConfig[],
} as const

export function tableById(id: string): TableConfig | undefined {
  return CONFIG.tables.find((t) => t.id === id)
}

export function rankForBalance(balance: number): RankConfig {
  let cur = CONFIG.ranks[0]!
  for (const r of CONFIG.ranks) {
    if (balance >= r.min) cur = r
  }
  return cur
}
