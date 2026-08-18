/**
 * 斗地主规则引擎 —— 出牌合法性
 */
import { canBeat } from './compare.ts'
import { BJ, SJ, type Card, type Play, type PlayKind, type Rank } from './types.ts'

/** 按点数聚合手牌 */
export function groupByRank(hand: Card[]): Map<Rank, Card[]> {
  const m = new Map<Rank, Card[]>()
  for (const c of hand) {
    const arr = m.get(c.r)
    if (arr) arr.push(c)
    else m.set(c.r, [c])
  }
  return m
}

/** 是否连续且不含 2/王（可用于顺子/连对/飞机） */
function isRun(ranks: Rank[], base: number): boolean {
  return ranks.length === base && ranks.every((r) => r <= 11) && ranks[ranks.length - 1]! - ranks[0]! === base - 1
}

/**
 * 识别一手牌是什么牌型；非法返回 null。
 * 这是"合法性"的第一道校验：由服务端权威裁决，客户端只做预判。
 */
export function classify(cards: Card[]): Play | null {
  const n = cards.length
  if (n === 0) return null
  const byRank = groupByRank(cards)
  // [点数, 张数] 升序
  const groups: Array<[Rank, number]> = [...byRank.entries()]
    .map(([r, arr]) => [r, arr.length] as [Rank, number])
    .sort((a, b) => a[0] - b[0])
  const minRank = groups[0]![0]
  const maxRank = groups[groups.length - 1]![0]
  const ranks = groups.map((g) => g[0])
  const allCount = (c: number) => groups.every((g) => g[1] === c)

  // 王炸
  if (n === 2 && groups.length === 2 && minRank === SJ && maxRank === BJ) {
    return { kind: 'rocket', rank: BJ, length: 2 }
  }
  // 炸弹
  if (n === 4 && groups.length === 1 && groups[0]![1] === 4) {
    return { kind: 'bomb', rank: groups[0]![0], length: 4 }
  }
  // 单张
  if (n === 1) return { kind: 'single', rank: groups[0]![0], length: 1 }
  // 对子
  if (n === 2 && groups.length === 1 && groups[0]![1] === 2) {
    return { kind: 'pair', rank: groups[0]![0], length: 2 }
  }
  // 三张
  if (n === 3 && groups.length === 1 && groups[0]![1] === 3) {
    return { kind: 'triple', rank: groups[0]![0], length: 3 }
  }
  // 三带一
  if (n === 4 && groups.length === 2) {
    const t = groups.find((g) => g[1] === 3)
    const o = groups.find((g) => g[1] !== 3)!
    if (t && o[1] === 1) return { kind: 'triple_one', rank: t[0], length: 4 }
  }
  // 三带二
  if (n === 5 && groups.length === 2) {
    const t = groups.find((g) => g[1] === 3)
    const o = groups.find((g) => g[1] !== 3)!
    if (t && o[1] === 2) return { kind: 'triple_pair', rank: t[0], length: 5 }
  }
  // 四带二：6 张 = 4 + 1 对 或 4 + 2 单
  if (n === 6 && groups.length >= 2 && groups.some((g) => g[1] === 4)) {
    const f = groups.find((g) => g[1] === 4)!
    const rest = groups.filter((g) => g[1] !== 4)
    if (rest.length === 1 && rest[0]![1] === 2) return { kind: 'four_two', rank: f[0], length: 6 }
    if (rest.every((g) => g[1] === 1)) return { kind: 'four_two', rank: f[0], length: 6 }
  }
  // 四带两对：8 张 = 4 + 2 对
  if (n === 8 && groups.length === 3 && groups.some((g) => g[1] === 4)) {
    const f = groups.find((g) => g[1] === 4)!
    const rest = groups.filter((g) => g[1] !== 4)
    if (rest.length === 2 && rest.every((g) => g[1] === 2)) return { kind: 'four_pair_two', rank: f[0], length: 8 }
  }
  // 顺子：≥5 张连续单牌（不含 2/王）
  if (n >= 5 && allCount(1) && maxRank <= 11 && isRun(ranks, n)) {
    return { kind: 'straight', rank: minRank, length: n }
  }
  // 连对：≥3 组连续对子
  if (n >= 6 && n % 2 === 0 && groups.length === n / 2 && allCount(2) && maxRank <= 11 && isRun(ranks, groups.length)) {
    return { kind: 'pair_straight', rank: minRank, length: n }
  }
  // 飞机（纯）：≥2 组连续三张
  if (n >= 6 && n % 3 === 0 && allCount(3) && maxRank <= 11 && isRun(ranks, groups.length)) {
    return { kind: 'airplane', rank: minRank, length: n }
  }
  // 飞机带单：4k 张 = k 组连续三张 + k 张单
  if (n >= 8 && n % 4 === 0) {
    const triples = groups.filter((g) => g[1] === 3)
    const wings = groups.filter((g) => g[1] === 1)
    const tripleRanks = triples.map((g) => g[0])
    if (
      triples.length >= 2 && wings.length === triples.length
      && maxRank <= 11 && isRun(tripleRanks, triples.length)
    ) {
      return { kind: 'airplane_single', rank: tripleRanks[0]!, length: n }
    }
  }
  // 飞机带对：5k 张 = k 组连续三张 + k 对
  if (n >= 10 && n % 5 === 0) {
    const triples = groups.filter((g) => g[1] === 3)
    const pairs = groups.filter((g) => g[1] === 2)
    const tripleRanks = triples.map((g) => g[0])
    if (
      triples.length >= 2 && pairs.length === triples.length
      && maxRank <= 11 && isRun(tripleRanks, triples.length)
    ) {
      return { kind: 'airplane_pair', rank: tripleRanks[0]!, length: n }
    }
  }
  return null
}

/** 手牌能否构造出指定牌型描述（只看张数满足，不看具体能取到哪几张） */
function hasEnoughFor(hand: Card[], play: Play): boolean {
  const counts = groupByRank(hand)
  const cnt = (r: Rank) => counts.get(r)?.length ?? 0
  const countsOf: Array<[Rank, number]> = [...counts.entries()].map(([r, arr]) => [r, arr.length])
  const tripleRanks: Rank[] = []
  for (const [r, c] of countsOf) if (c >= 3 && r <= 11) tripleRanks.push(r)
  tripleRanks.sort((a, b) => a - b)
  const pairRanks: Rank[] = []
  for (const [r, c] of countsOf) if (c >= 2) pairRanks.push(r)
  pairRanks.sort((a, b) => a - b)

  switch (play.kind) {
    case 'single': return cnt(play.rank) >= 1
    case 'pair': return cnt(play.rank) >= 2
    case 'triple': return cnt(play.rank) >= 3
    case 'triple_one': return cnt(play.rank) >= 3 && hand.length >= 4
    case 'triple_pair': return cnt(play.rank) >= 3 && pairRanks.some((r) => r !== play.rank && cnt(r) >= 2)
    case 'straight': {
      for (let r = play.rank; r < play.rank + play.length; r++) if (cnt(r) < 1) return false
      return true
    }
    case 'pair_straight': {
      const k = play.length / 2
      for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 2) return false
      return true
    }
    case 'airplane': {
      const k = play.length / 3
      for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false
      return true
    }
    case 'airplane_single': {
      const k = play.length / 4
      for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false
      const wings = hand.length - 3 * k
      return wings >= k
    }
    case 'airplane_pair': {
      const k = play.length / 5
      for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false
      const used = new Set<Rank>()
      for (let r = play.rank; r < play.rank + k; r++) used.add(r)
      const freePairs = pairRanks.filter((r) => !used.has(r)).length
      return freePairs >= k
    }
    case 'four_two': return cnt(play.rank) >= 4 && hand.length >= 6
    case 'four_pair_two': {
      const used = new Set([play.rank])
      return cnt(play.rank) >= 4 && pairRanks.filter((r) => !used.has(r)).length >= 2
    }
    case 'bomb': return cnt(play.rank) >= 4
    case 'rocket': return cnt(SJ) >= 1 && cnt(BJ) >= 1
  }
}

/** 手牌可构造的全部牌型描述（升序：越靠前越"小"） */
export function legalPlays(hand: Card[], last: Play | null): Play[] {
  const counts = groupByRank(hand)
  const cnt = (r: Rank) => counts.get(r)?.length ?? 0
  const ranks = [...counts.keys()].sort((a, b) => a - b)
  const candidates: Play[] = []

  // 普通牌型（rank ≤ 11 顺子类）
  for (const r of ranks) {
    candidates.push({ kind: 'single', rank: r, length: 1 })
    if (cnt(r) >= 2) candidates.push({ kind: 'pair', rank: r, length: 2 })
    if (cnt(r) >= 3) {
      candidates.push({ kind: 'triple', rank: r, length: 3 })
      candidates.push({ kind: 'triple_one', rank: r, length: 4 })
      if (ranks.some((o) => o !== r && cnt(o) >= 2)) candidates.push({ kind: 'triple_pair', rank: r, length: 5 })
    }
    if (cnt(r) >= 4) {
      candidates.push({ kind: 'bomb', rank: r, length: 4 })
      candidates.push({ kind: 'four_two', rank: r, length: 6 })
      if (ranks.filter((o) => o !== r && cnt(o) >= 2).length >= 2) {
        candidates.push({ kind: 'four_pair_two', rank: r, length: 8 })
      }
    }
  }
  // 顺子
  for (let start = 0; start <= 11; start++) {
    let len = 0
    while (start + len <= 11 && cnt(start + len) >= 1) len++
    for (let n = 5; n <= len; n++) candidates.push({ kind: 'straight', rank: start, length: n })
  }
  // 连对
  for (let start = 0; start <= 11; start++) {
    let len = 0
    while (start + len <= 11 && cnt(start + len) >= 2) len++
    for (let n = 3; n <= len; n++) candidates.push({ kind: 'pair_straight', rank: start, length: 2 * n })
  }
  // 飞机
  for (let start = 0; start <= 11; start++) {
    let len = 0
    while (start + len <= 11 && cnt(start + len) >= 3) len++
    for (let n = 2; n <= len; n++) {
      const triples = 3 * n
      candidates.push({ kind: 'airplane', rank: start, length: triples })
      if (hand.length - triples >= n) candidates.push({ kind: 'airplane_single', rank: start, length: 4 * n })
      const used = new Set<Rank>()
      for (let i = 0; i < n; i++) used.add(start + i)
      const freePairs = ranks.filter((r) => !used.has(r) && cnt(r) >= 2).length
      if (freePairs >= n) candidates.push({ kind: 'airplane_pair', rank: start, length: 5 * n })
    }
  }
  // 王炸
  if (cnt(SJ) >= 1 && cnt(BJ) >= 1) candidates.push({ kind: 'rocket', rank: BJ, length: 2 })

  // 去重 + 过滤（能构造且能压过 last）
  const seen = new Set<string>()
  const out: Play[] = []
  for (const p of candidates) {
    const key = `${p.kind}:${p.rank}:${p.length}`
    if (seen.has(key)) continue
    seen.add(key)
    if (hasEnoughFor(hand, p) && canBeat(p, last)) out.push(p)
  }
  return out
}

/** 从手牌中取出一手符合描述的牌；取不到返回 null */
export function buildPlay(hand: Card[], play: Play): Card[] | null {
  const counts = groupByRank(hand)
  const take = (r: Rank, n: number): Card[] | null => {
    const arr = counts.get(r)
    return arr && arr.length >= n ? arr.slice(0, n) : null
  }
  const pickWings = (count: number, used: Set<Rank>, mode: 'single' | 'pair'): Card[] | null => {
    const res: Card[] = []
    for (const [r, cards] of counts) {
      if (used.has(r)) continue
      if (mode === 'pair') {
        if (cards.length >= 2) { res.push(cards[0]!, cards[1]!) }
      } else {
        res.push(cards[0]!)
      }
      if (res.length >= count) return res.slice(0, count)
    }
    return res.length >= count ? res.slice(0, count) : null
  }

  switch (play.kind) {
    case 'single': return take(play.rank, 1)
    case 'pair': return take(play.rank, 2)
    case 'triple': return take(play.rank, 3)
    case 'triple_one': {
      const t = take(play.rank, 3); if (!t) return null
      const w = pickWings(1, new Set([play.rank]), 'single'); if (!w) return null
      return [...t, ...w]
    }
    case 'triple_pair': {
      const t = take(play.rank, 3); if (!t) return null
      const w = pickWings(2, new Set([play.rank]), 'pair'); if (!w) return null
      return [...t, ...w]
    }
    case 'straight': {
      const out: Card[] = []
      for (let r = play.rank; r < play.rank + play.length; r++) {
        const x = take(r, 1); if (!x) return null
        out.push(x[0]!)
      }
      return out
    }
    case 'pair_straight': {
      const out: Card[] = []
      const k = play.length / 2
      for (let r = play.rank; r < play.rank + k; r++) {
        const x = take(r, 2); if (!x) return null
        out.push(...x)
      }
      return out
    }
    case 'airplane': {
      const out: Card[] = []
      const k = play.length / 3
      for (let r = play.rank; r < play.rank + k; r++) {
        const x = take(r, 3); if (!x) return null
        out.push(...x)
      }
      return out
    }
    case 'airplane_single': {
      const out: Card[] = []
      const used = new Set<Rank>()
      const k = play.length / 4
      for (let r = play.rank; r < play.rank + k; r++) {
        const x = take(r, 3); if (!x) return null
        out.push(...x); used.add(r)
      }
      const w = pickWings(k, used, 'single'); if (!w) return null
      return [...out, ...w]
    }
    case 'airplane_pair': {
      const out: Card[] = []
      const used = new Set<Rank>()
      const k = play.length / 5
      for (let r = play.rank; r < play.rank + k; r++) {
        const x = take(r, 3); if (!x) return null
        out.push(...x); used.add(r)
      }
      const w = pickWings(k, used, 'pair'); if (!w) return null
      return [...out, ...w]
    }
    case 'four_two': {
      const f = take(play.rank, 4); if (!f) return null
      const used = new Set([play.rank])
      const pw = pickWings(2, used, 'pair'); if (pw) return [...f, ...pw]
      const sw = pickWings(2, used, 'single'); if (sw) return [...f, ...sw]
      return null
    }
    case 'four_pair_two': {
      const f = take(play.rank, 4); if (!f) return null
      const used = new Set([play.rank])
      const w1 = pickWings(2, used, 'pair'); if (!w1) return null
      const w2 = pickWings(2, used, 'pair'); if (!w2) return null
      return [...f, ...w1, ...w2]
    }
    case 'bomb': return take(play.rank, 4)
    case 'rocket': {
      const sj = hand.find((c) => c.r === SJ)
      const bj = hand.find((c) => c.r === BJ)
      return sj && bj ? [sj, bj] : null
    }
  }
}

/**
 * 提示：从手牌中找一手"能压过 last 的最小牌"。
 * - last 为空（领出）：尽可能甩出更长的顺子/飞机，其次三带/对子/单张（简单贪心）。
 * - last 非空：升序找第一手能压过的牌；实在不行返回 null（表示该过）。
 */
export function hintPlay(hand: Card[], last: Play | null): Card[] | null {
  if (!last) {
    // 领出：优先甩长牌
    const dumpOrder: PlayKind[] = ['airplane', 'pair_straight', 'straight', 'airplane_pair', 'airplane_single', 'triple_pair', 'triple_one', 'triple', 'pair', 'single']
    for (const kind of dumpOrder) {
      const plays = legalPlays(hand, null).filter((p) => p.kind === kind).sort((a, b) => b.length - a.length || b.rank - a.rank)
      for (const p of plays) {
        const c = buildPlay(hand, p)
        if (c) return c
      }
    }
    return null
  }
  const plays = legalPlays(hand, last).sort((a, b) => strengthOf(a) - strengthOf(b))
  for (const p of plays) {
    const c = buildPlay(hand, p)
    if (c) return c
  }
  return null
}

/** 牌型强度（越小越容易先出），用于提示/机器人排序 */
export function strengthOf(p: Play): number {
  const order: PlayKind[] = ['single', 'pair', 'triple', 'triple_one', 'triple_pair', 'straight', 'pair_straight', 'airplane', 'airplane_single', 'airplane_pair', 'four_two', 'four_pair_two', 'bomb', 'rocket']
  return order.indexOf(p.kind) * 100 + p.rank
}
