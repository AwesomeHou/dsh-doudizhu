/**
 * dsh-doudizhu 客户端主界面（M1 本地模式）
 * - 浮动入口按钮 + 全屏对局面板（body portal）
 * - 大厅：昵称/头像/段位/余额、每日签到、桌别选择
 * - 牌桌：叫地主/抢地主 → 出牌/过/提示 → 结算
 * - 经济：localStorage 模拟余额/签到（M2 起由云端接管）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createElement } from 'react'
import { CONFIG, rankForBalance, tableById } from '../../shared/config.ts'
import { cardName, sortHand } from '../../shared/engine/deck.ts'
import { applyAction, createGame, roleOf, type GameState } from '../../shared/engine/game.ts'
import { settle } from '../../shared/engine/scoring.ts'
import { classify, hintPlay } from '../../shared/engine/valid.ts'
import { canBeat } from '../../shared/engine/compare.ts'
import { botMove } from '../../shared/engine/bot.ts'
import type { Card, Role, Seat } from '../../shared/engine/types.ts'

/* ============================== 样式 ============================== */

const STYLE = `
.ddz-root{--dz-blue:#4d6bfe;--dz-bg:#0f1115;--dz-panel:#171a21;--dz-line:#262b36;--dz-text:#e6e8ee;--dz-dim:#8a91a0;--dz-red:#f0555d;--dz-gold:#e6b64c;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--dz-text);}
.ddz-btn{background:var(--dz-blue);border:0;border-radius:8px;color:#fff;font-size:14px;padding:8px 16px;cursor:pointer;font-weight:600}
.ddz-btn:hover{filter:brightness(1.1)}
.ddz-btn:disabled{opacity:.4;cursor:not-allowed}
.ddz-btn-ghost{background:transparent;border:1px solid var(--dz-line);color:var(--dz-text)}
.ddz-btn-red{background:var(--dz-red)}
.ddz-float{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#4d6bfe,#3b4fd6);color:#fff;border:0;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.ddz-overlay{position:fixed;inset:0;z-index:2147482999;background:rgba(5,6,9,.72);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)}
.ddz-modal{background:var(--dz-panel);border:1px solid var(--dz-line);border-radius:16px;width:min(960px,94vw);height:min(660px,92vh);display:flex;flex-direction:column;overflow:hidden}
.ddz-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dz-line);font-weight:700}
.ddz-body{flex:1;overflow:auto;padding:16px}
.ddz-row{display:flex;gap:10px;align-items:center}
.ddz-dim{color:var(--dz-dim)}
.ddz-rank{display:inline-block;background:linear-gradient(135deg,#3a4fd6,#24367e);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700}
.ddz-card{width:44px;height:64px;border-radius:6px;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;cursor:pointer;user-select:none;border:1px solid #d6d9e0;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .1s}
.ddz-card.red{color:var(--dz-red)}
.ddz-card.sel{transform:translateY(-14px);box-shadow:0 0 0 2px var(--dz-blue)}
.ddz-card-back{width:36px;height:54px;border-radius:5px;background:repeating-linear-gradient(45deg,#4d6bfe 0 6px,#3b4fd6 6px 12px);border:1px solid #2c3aa0}
.ddz-card-back.blue{background:repeating-linear-gradient(45deg,#4d6bfe 0 6px,#3b4fd6 6px 12px)}
.ddz-card-back.black{background:repeating-linear-gradient(45deg,#2c2c2c 0 6px,#1a1a1a 6px 12px)}
.ddz-seat{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:120px}
.ddz-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:18px}
.ddz-avatar.blue{background:linear-gradient(135deg,#4d6bfe,#24367e)}
.ddz-avatar.black{background:linear-gradient(135deg,#2c2c2c,#0b0b0d)}
.ddz-table{position:relative;flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:18px;background:radial-gradient(120% 100% at 50% 0%,#1b2233,#0f1115 70%);border-radius:12px}
.ddz-played{min-height:56px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap}
.ddz-turn{color:var(--dz-gold);font-weight:700}
.ddz-landlord-badge{background:var(--dz-red);border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700}
.ddz-bottom{margin-top:6px;min-height:56px;display:flex;align-items:center;gap:6px}
.ddz-settle{text-align:center}
.ddz-big{font-size:26px;font-weight:800}
.ddz-input{background:#0c0e13;border:1px solid var(--dz-line);border-radius:8px;color:var(--dz-text);padding:8px 10px;font-size:14px;width:200px}
.ddz-tab{background:transparent;border:1px solid var(--dz-line);color:var(--dz-text);border-radius:10px;padding:14px;cursor:pointer;text-align:left;min-width:200px}
.ddz-tab.on{border-color:var(--dz-blue);box-shadow:0 0 0 1px var(--dz-blue)}
.ddz-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#1c2333;border:1px solid var(--dz-blue);border-radius:10px;padding:10px 18px;font-size:14px;z-index:2147483001;box-shadow:0 6px 20px rgba(0,0,0,.5)}
`

/* ============================== 基础组件 ============================== */

function CardView({ card, selected, onClick }: { card: Card; selected?: boolean; onClick?: () => void }) {
  const isRed = card.s === 1 || card.s === 2 || card.r >= 13
  const label = cardName(card)
  return createElement('div', {
    className: 'ddz-card' + (isRed ? ' red' : '') + (selected ? ' sel' : ''),
    onClick,
  }, label)
}

function Back({ color }: { color: 'blue' | 'black' }) {
  return createElement('div', { className: `ddz-card-back ${color}` })
}

function Avatar({ avatarId, size = 40 }: { avatarId: string; size?: number }) {
  const blue = avatarId === 'default-01' || avatarId === 'default-01.svg'
  const cls = blue ? 'blue' : 'black'
  const glyph = blue ? 'B' : 'K'
  return createElement('div', { className: `ddz-avatar ${cls}`, style: { width: size, height: size, fontSize: size * 0.45 } }, glyph)
}

function seatLabel(seat: Seat, humanSeat: Seat): string {
  if (seat === humanSeat) return '你'
  return ['下家', '上家'][seat < humanSeat ? 0 : 1] ?? '对手'
}

/* ============================== 本地档案 / 经济 ============================== */

interface Profile {
  uid: string
  nickname: string
  avatarId: string
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem('ddz:profile')
    if (raw) return JSON.parse(raw) as Profile
  } catch { /* ignore */ }
  const profile: Profile = {
    uid: crypto.randomUUID(),
    nickname: '斗地主玩家' + Math.floor(1000 + Math.random() * 9000),
    avatarId: Math.random() < 0.5 ? 'default-01' : 'default-02',
  }
  localStorage.setItem('ddz:profile', JSON.stringify(profile))
  return profile
}

function loadBalance(): number {
  try { return Number(localStorage.getItem('ddz:balance') ?? 100_000) } catch { return 100_000 }
}
function saveBalance(v: number): void { localStorage.setItem('ddz:balance', String(v)) }

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/* ============================== 大厅 ============================== */

function Lobby(props: {
  profile: Profile
  balance: number
  onClaim: () => void
  claimed: boolean
  onStart: (tableId: string) => void
  onClose: () => void
}) {
  const { profile, balance, onClaim, claimed, onStart, onClose } = props
  const rank = rankForBalance(balance)
  const [tableId, setTableId] = useState(CONFIG.tables[0]!.id)

  return createElement('div', { className: 'ddz-body' },
    createElement('div', { className: 'ddz-row', style: { justifyContent: 'space-between', marginBottom: 16 } },
      createElement('div', { className: 'ddz-row' },
        createElement(Avatar, { avatarId: profile.avatarId }),
        createElement('div', null,
          createElement('div', { style: { fontWeight: 700 } }, profile.nickname),
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } }, 'UID ' + profile.uid.slice(0, 8)),
        ),
        createElement('span', { className: 'ddz-rank' }, rank.name),
      ),
      createElement('div', { className: 'ddz-row' },
        createElement('div', null,
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } }, 'Token 余额'),
          createElement('div', { style: { fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, balance.toLocaleString()),
        ),
        createElement('button', {
          className: 'ddz-btn',
          disabled: claimed,
          onClick: onClaim,
        }, claimed ? '今日已领' : `签到 +${CONFIG.dailyTokens.toLocaleString()}`),
      ),
    ),
    createElement('div', { className: 'ddz-dim', style: { marginBottom: 10 } }, '选择桌别，开局自动匹配 2 个本地机器人（M1 本地演示）'),
    createElement('div', { className: 'ddz-row', style: { flexWrap: 'wrap' } },
      ...CONFIG.tables.map((t) =>
        createElement('div', {
          key: t.id,
          className: 'ddz-tab' + (tableId === t.id ? ' on' : ''),
          onClick: () => setTableId(t.id),
        },
          createElement('div', { style: { fontWeight: 700 } }, t.label),
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } },
            `底注 ${t.base.toLocaleString()} · 余额门槛 ${t.minBalance.toLocaleString()}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-row', style: { marginTop: 18 } },
      createElement('button', { className: 'ddz-btn', disabled: balance < (tableById(tableId)?.base ?? 0), onClick: () => onStart(tableId) },
        '开始本地对局'),
      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onClose }, '最小化'),
    ),
    balance < (tableById(tableId)?.base ?? 0) &&
      createElement('div', { className: 'ddz-dim', style: { marginTop: 8, fontSize: 12 } },
        '余额不足该桌底注，先签到或换低倍桌'),
  )
}

/* ============================== 牌桌 ============================== */

const HUMAN_SEAT: Seat = 0

interface SeatView {
  seat: Seat
  nickname: string
  avatarId: string
  isHuman: boolean
}

const SEATS: SeatView[] = [
  { seat: 0, nickname: '你', avatarId: 'default-01', isHuman: true },
  { seat: 1, nickname: '机器人·蓝', avatarId: 'default-01', isHuman: false },
  { seat: 2, nickname: '机器人·黑', avatarId: 'default-02', isHuman: false },
]

function botCallDecision(hand: Card[], random: () => number): boolean {
  const strong = hand.filter((x) => x.r >= 12).length >= 1 || hand.filter((x) => x.r >= 9).length >= 3
  return strong || random() < 0.3
}

function Table(props: {
  tableId: string
  base: number
  balance: number
  onExit: () => void
  onFinished: (deltas: [number, number, number], multiplier: number, winner: string, spring: string, landlord: Seat, rake: number) => void
}) {
  const { tableId, base, balance, onExit, onFinished } = props
  const [state, setState] = useState<GameState>(() => createGame())
  const [selected, setSelected] = useState<Card[]>([])
  const [busy, setBusy] = useState(false)
  const randomRef = useRef(Math.random)
  const [notice, setNotice] = useState<string | null>(null)

  const humanHand = state.hands[HUMAN_SEAT]!
  const sortedHand = useMemo(() => sortHand(humanHand), [humanHand])

  // 机器人自动行动
  useEffect(() => {
    if (state.finished || state.redeal || state.phase === 'settled') return
    if (state.current === HUMAN_SEAT) return
    const timer = window.setTimeout(() => {
      const seat = state.current
      if (state.phase === 'calling') {
        const call = botCallDecision(state.hands[seat]!, randomRef.current)
        setState((s) => {
          try { return applyAction(s, { type: 'call', seat, call }) } catch { return s }
        })
      } else {
        const move = botMove(state.hands[seat]!, state.lastPlay)
        setState((s) => {
          try {
            return move === null
              ? applyAction(s, { type: 'pass', seat })
              : applyAction(s, { type: 'play', seat, cards: move })
          } catch { return s }
        })
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [state])

  // 结算
  useEffect(() => {
    if (!state.finished || !state.settlement) return
    const t = window.setTimeout(() => {
      const s = settle(state.landlord!, state.winner!, base, state.multiplier, CONFIG.rakeRate)
      const winnerText = state.winner === 'landlord' ? '地主胜' : '农民胜'
      const springText = state.spring === 'none' ? '无' : state.spring === 'landlord' ? '春天' : '反春'
      onFinished(s.deltas, s.multiplier, winnerText, springText, state.landlord!, s.rake)
    }, 900)
    return () => window.clearTimeout(t)
  }, [state.finished, state.settlement, state.winner, state.multiplier, state.spring, state.landlord, base, onFinished])

  // 重新发牌（无人叫）
  useEffect(() => {
    if (state.redeal) {
      const t = window.setTimeout(() => setState(createGame()), 800)
      return () => window.clearTimeout(t)
    }
  }, [state.redeal])

  const toggleSelect = (card: Card) => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT) return
    setSelected((prev) => {
      const idx = prev.findIndex((x) => x.r === card.r && x.s === card.s)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, card]
    })
  }

  const canPlay = (): boolean => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT || selected.length === 0) return false
    const play = classify(selected)
    if (!play) return false
    if (!canBeat(play, state.lastPlay)) return false
    return selected.every((c) => humanHand.some((x) => x.r === c.r && x.s === c.s))
  }

  const humanAct = (action: { type: 'play'; cards: Card[] } | { type: 'pass' } | { type: 'call'; call: boolean }) => {
    try {
      if (action.type === 'call') {
        setState((s) => applyAction(s, { type: 'call', seat: HUMAN_SEAT, call: action.call }))
        setBusy(true)
        window.setTimeout(() => setBusy(false), 300)
      } else if (action.type === 'pass') {
        setState((s) => applyAction(s, { type: 'pass', seat: HUMAN_SEAT }))
        setSelected([])
      } else {
        setState((s) => applyAction(s, { type: 'play', seat: HUMAN_SEAT, cards: action.cards }))
        setSelected([])
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  const doHint = () => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT) return
    const h = hintPlay(humanHand, state.lastPlay)
    if (!h) {
      setNotice('没有能压过的牌，过吧')
      return
    }
    setSelected(h)
  }

  const isMyTurn = state.phase === 'calling' ? state.callOrder[state.callActor] === HUMAN_SEAT : state.current === HUMAN_SEAT

  const otherSeats = SEATS.filter((s) => s.seat !== HUMAN_SEAT)
  const [botA, botB] = otherSeats
  const currentSeat = state.current

  return createElement('div', { className: 'ddz-body' },
    createElement('div', { className: 'ddz-head', style: { margin: '-16px -16px 12px' } },
      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onExit }, '← 退出'),
      createElement('span', null, tableById(tableId)?.label ?? tableId),
      createElement('span', { className: 'ddz-dim' }, `底注 ${base.toLocaleString()} · 倍数 ×${state.multiplier} · 炸弹 ${state.bombCount}`),
      createElement('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, `余额 ${balance.toLocaleString()}`),
    ),
    notice && createElement('div', { className: 'ddz-toast', onClick: () => setNotice(null) }, notice),

    createElement('div', { className: 'ddz-table' },
      // 上家（botB）
      createElement(SeatPanel, { view: botB!, state, isTurn: currentSeat === botB!.seat }),
      createElement('div', { className: 'ddz-row', style: { justifyContent: 'space-between' } },
        createElement(SeatPanel, { view: botA!, state, isTurn: currentSeat === botA!.seat }),
        createElement('div', { style: { textAlign: 'center' } },
          state.landlord !== null
            ? createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', gap: 8, marginBottom: 4 } },
                createElement('span', { className: 'ddz-landlord-badge' }, '地主'),
                createElement('span', { className: 'ddz-dim', style: { fontSize: 12 } }, SEATS[state.landlord]!.nickname),
              )
            : createElement('div', { className: 'ddz-dim', style: { fontSize: 12, marginBottom: 4 } }, '叫地主中…'),
          createElement('div', { className: 'ddz-played' },
            state.lastPlayCards && state.lastPlayCards.length > 0
              ? createElement('div', { className: 'ddz-row' },
                  ...state.lastPlayCards.map((card, i) => createElement(CardView, { key: i, card })),
                )
              : createElement('span', { className: 'ddz-dim' }, state.phase === 'playing' ? '领出' : ''),
          ),
          state.phase === 'playing' && state.lastActor !== null &&
            createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } },
              `${SEATS[state.lastActor]!.nickname} 出了 ${state.lastPlay?.kind ?? ''}`),
        ),
        createElement('div', { style: { width: 120 } }),
      ),
      // 底牌
      state.landlord !== null &&
        createElement('div', { className: 'ddz-bottom', style: { justifyContent: 'center' } },
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12, marginRight: 6 } }, '底牌'),
          ...state.bottom.map((c, i) => createElement(CardView, { key: i, card: c })),
        ),
      // 我的手牌与操作
      createElement('div', { style: { textAlign: 'center' } },
        createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', flexWrap: 'wrap', gap: 4, paddingBottom: 4 } },
          ...sortedHand.map((c, i) =>
            createElement(CardView, {
              key: `${c.r}-${c.s}-${i}`,
              card: c,
              selected: selected.some((x) => x.r === c.r && x.s === c.s),
              onClick: () => toggleSelect(c),
            }),
          ),
        ),
        createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', gap: 10, marginTop: 10 } },
          state.phase === 'calling'
            ? (isMyTurn
                ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                    createElement('button', { className: 'ddz-btn', onClick: () => humanAct({ type: 'call', call: true }) }, '叫地主'),
                    createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => humanAct({ type: 'call', call: false }) }, '不叫'),
                  )
                : createElement('span', { className: 'ddz-dim' }, '等待叫地主…'))
            : (state.phase === 'playing'
                ? (isMyTurn
                    ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                        createElement('button', { className: 'ddz-btn', disabled: !canPlay(), onClick: () => humanAct({ type: 'play', cards: selected }) }, '出牌'),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: doHint }, '提示'),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', disabled: state.lastPlay === null, onClick: () => humanAct({ type: 'pass' }) }, '过'),
                      )
                    : createElement('span', { className: 'ddz-turn' }, '对手思考中…'))
                : null),
        ),
      ),
    ),
  )
}

function SeatPanel(props: { view: SeatView; state: GameState; isTurn: boolean }) {
  const { view, state, isTurn } = props
  const handCount = state.hands[view.seat]!.length
  const role = state.landlord !== null ? roleOf(state, view.seat) : null
  return createElement('div', { className: 'ddz-seat' },
    createElement('div', { className: 'ddz-row' },
      createElement(Avatar, { avatarId: view.avatarId, size: 32 }),
      createElement('div', null,
        createElement('div', { className: 'ddz-row', style: { gap: 6 } },
          createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, view.nickname),
          role === 'landlord' && createElement('span', { className: 'ddz-landlord-badge' }, '地主'),
          isTurn && createElement('span', { className: 'ddz-turn', style: { fontSize: 11 } }, '行动中'),
        ),
        createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } }, `剩 ${handCount} 张`),
      ),
    ),
    createElement('div', { className: 'ddz-row', style: { gap: 2, flexWrap: 'wrap', justifyContent: 'center' } },
      ...Array.from({ length: Math.min(handCount, 12) }, (_, i) => createElement(Back, { key: i, color: view.avatarId === 'default-02' ? 'black' : 'blue' })),
      handCount > 12 && createElement('span', { className: 'ddz-dim', style: { fontSize: 11 } }, `+${handCount - 12}`),
    ),
  )
}

/* ============================== 结算 ============================== */

function Settle(props: {
  result: {
    deltas: [number, number, number]
    multiplier: number
    winner: string
    spring: string
    landlord: Seat
    rake: number
  }
  balance: number
  onExit: () => void
}) {
  const { result, balance, onExit } = props
  const myDelta = result.deltas[HUMAN_SEAT]
  const win = myDelta > 0
  return createElement('div', { className: 'ddz-settle ddz-body' },
    createElement('div', { className: 'ddz-big', style: { color: win ? 'var(--dz-gold)' : 'var(--dz-red)' } },
      win ? '🎉 你赢了' : myDelta === 0 ? '平局' : '这局输了'),
    createElement('div', { className: 'ddz-dim', style: { margin: '10px 0' } },
      `${result.winner} · ${result.spring === 'none' ? '无春天' : result.spring} · 总倍数 ×${result.multiplier} · 抽水 ${result.rake.toLocaleString()}`),
    createElement('div', { style: { fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '12px 0' } },
      `${myDelta > 0 ? '+' : ''}${myDelta.toLocaleString()}`),
    createElement('div', { className: 'ddz-dim' }, `当前余额 ${balance.toLocaleString()}`),
    createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', gap: 10, marginTop: 18 } },
      createElement('button', { className: 'ddz-btn', onClick: onExit }, '返回大厅'),
    ),
  )
}

/* ============================== 应用根 ============================== */

export function DoudizhuApp() {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [balance, setBalance] = useState(() => loadBalance())
  const [claimed, setClaimed] = useState(() => localStorage.getItem('ddz:claim') === todayKey())
  const [screen, setScreen] = useState<'lobby' | 'table' | 'settle'>('lobby')
  const [tableId, setTableId] = useState(CONFIG.tables[0]!.id)
  const [result, setResult] = useState<{
    deltas: [number, number, number]; multiplier: number; winner: string; spring: string; landlord: Seat; rake: number
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const claim = () => {
    if (claimed) return
    const next = balance + CONFIG.dailyTokens
    setBalance(next)
    saveBalance(next)
    localStorage.setItem('ddz:claim', todayKey())
    setClaimed(true)
    setNotice(`每日签到 +${CONFIG.dailyTokens.toLocaleString()}`)
  }

  const start = (tid: string) => {
    setTableId(tid)
    setResult(null)
    setScreen('table')
  }

  const onFinished = useCallback((
    deltas: [number, number, number], multiplier: number, winner: string, spring: string, landlord: Seat, rake: number,
  ) => {
    setResult({ deltas, multiplier, winner, spring, landlord, rake })
    const next = Math.max(0, balance + deltas[HUMAN_SEAT])
    setBalance(next)
    saveBalance(next)
    setScreen('settle')
  }, [balance])

  return createElement('div', { className: 'ddz-root' },
    createElement('style', null, STYLE),
    notice && createElement('div', { className: 'ddz-toast', onClick: () => setNotice(null) }, notice),
    createElement('button', { className: 'ddz-float', onClick: () => setOpen((v) => !v) },
      '🃏 斗地主', createElement('span', { style: { fontSize: 11, opacity: .8 } }, '等待中，来一把')),
    open && createElement('div', { className: 'ddz-overlay', onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) setOpen(false) } },
      createElement('div', { className: 'ddz-modal' },
        createElement('div', { className: 'ddz-head' },
          createElement('span', { style: { fontSize: 16 } }, '🃏 斗地主'),
          createElement('span', { className: 'ddz-rank' }, rankForBalance(balance).name),
          createElement('span', { className: 'ddz-dim', style: { fontSize: 12, marginLeft: 'auto' } }, 'M1 本地演示 · 云端对局即将到来'),
          createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => setOpen(false) }, '关闭'),
        ),
        screen === 'lobby' && createElement(Lobby, {
          profile, balance, claimed, onClaim: claim,
          onStart: start, onClose: () => setOpen(false),
        }),
        screen === 'table' && createElement(Table, {
          tableId, base: tableById(tableId)?.base ?? 0, balance,
          onExit: () => setScreen('lobby'),
          onFinished,
        }),
        screen === 'settle' && result && createElement(Settle, {
          result, balance, onExit: () => setScreen('lobby'),
        }),
      ),
    ),
  )
}
