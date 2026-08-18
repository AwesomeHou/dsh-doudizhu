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
.ddz-root{--dz-blue:#4d6bfe;--dz-blue-hover:#405de0;--dz-bg:#f5f7fa;--dz-panel:#fff;--dz-surface:#fff;--dz-table:#f7f8fb;--dz-line:#e4e7ed;--dz-text:#20242c;--dz-dim:#6f7684;--dz-red:#c53f4d;--dz-red-soft:#fff0f1;--dz-gold:#966813;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--dz-text);color-scheme:light;}
.ddz-btn{background:var(--dz-blue);border:0;border-radius:9px;color:#fff;font-size:14px;line-height:20px;padding:9px 18px;cursor:pointer;font-weight:650;transition:background-color .18s ease,transform .18s ease}
.ddz-btn:hover{background:var(--dz-blue-hover)}
.ddz-btn:active{transform:translateY(1px)}
.ddz-btn:focus-visible,.ddz-tab:focus-visible,.ddz-card:focus-visible,.ddz-float:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-btn:disabled{background:#b7becb;cursor:not-allowed}
.ddz-btn-ghost{background:var(--dz-panel);border:1px solid var(--dz-line);color:var(--dz-text)}
.ddz-btn-ghost:hover{background:#f7f8fb;color:var(--dz-text)}
.ddz-btn-red{background:var(--dz-red)}
.ddz-float{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:var(--dz-blue);color:#fff;border:0;border-radius:10px;padding:9px 14px;font-size:14px;line-height:20px;font-weight:650;cursor:pointer;box-shadow:0 7px 14px rgba(54,75,180,.25);transition:background-color .18s ease,transform .18s ease}
.ddz-float:hover{background:var(--dz-blue-hover);transform:translateY(-1px)}
.ddz-float-title{font-weight:650}
.ddz-float-subtitle{font-size:11px;line-height:16px;opacity:.82}
.ddz-overlay{position:fixed;inset:0;z-index:2147482999;background:rgba(28,32,42,.26);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
.ddz-modal{position:relative;background:var(--dz-panel);border-radius:18px;width:min(1180px,94vw);height:min(760px,92vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 42px rgba(26,32,47,.18)}
.ddz-corner-close{position:absolute;top:14px;right:16px;z-index:2;width:34px;height:34px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:var(--dz-dim);font-size:22px;line-height:1;cursor:pointer}
.ddz-corner-close:hover{background:#f2f4f8;color:var(--dz-text)}
.ddz-corner-close:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-table-exit{position:absolute;top:16px;left:16px;z-index:2;background:transparent;border:0;color:var(--dz-dim);font:inherit;font-size:13px;cursor:pointer;padding:6px 8px;border-radius:7px}
.ddz-table-exit:hover{background:#f2f4f8;color:var(--dz-text)}
.ddz-table-exit:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-body{flex:1;overflow:auto;padding:24px;background:var(--dz-surface)}
.ddz-row{display:flex;gap:10px;align-items:center}
.ddz-dim{color:var(--dz-dim)}
.ddz-rank{display:inline-block;background:#e9edff;color:#304bc5;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:700}
.ddz-card{width:44px;height:64px;border-radius:7px;background:#fff;color:#20242c;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;cursor:pointer;user-select:none;border:1px solid #d9dde5;box-shadow:0 1px 3px rgba(26,32,47,.12);transition:transform .14s ease,box-shadow .14s ease}
.ddz-card:hover{transform:translateY(-2px);box-shadow:0 4px 9px rgba(26,32,47,.14)}
.ddz-card.red{color:var(--dz-red)}
.ddz-card.sel{transform:translateY(-14px);box-shadow:0 0 0 2px var(--dz-blue),0 5px 10px rgba(77,107,254,.18)}
.ddz-seat{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:144px}
.ddz-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:18px}
.ddz-avatar.blue{background:#4d6bfe}
.ddz-avatar.black{background:#454b58}
.ddz-table{position:relative;flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:18px;background:var(--dz-table);border:1px solid var(--dz-line);border-radius:12px}
.ddz-played{min-height:56px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap}
.ddz-turn{color:#304bc5;font-weight:700}
.ddz-landlord-badge{background:var(--dz-red-soft);color:var(--dz-red);border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700}
.ddz-bottom{margin-top:6px;min-height:56px;display:flex;align-items:center;gap:6px}
.ddz-settle{text-align:center}
.ddz-big{font-size:26px;font-weight:800}
.ddz-input{background:#fff;border:1px solid var(--dz-line);border-radius:8px;color:var(--dz-text);padding:8px 10px;font-size:14px;width:200px}
.ddz-tab{appearance:none;background:#fff;border:1px solid var(--dz-line);color:var(--dz-text);border-radius:10px;padding:14px;cursor:pointer;text-align:left;min-width:0;flex:1;font:inherit}
.ddz-tab:hover{background:#fafbff;border-color:#cbd3ea}
.ddz-tab.on{border-color:var(--dz-blue);box-shadow:0 0 0 1px var(--dz-blue);background:#fbfcff}
.ddz-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#fff;color:var(--dz-text);border:1px solid var(--dz-blue);border-radius:10px;padding:10px 18px;font-size:14px;z-index:2147483001;box-shadow:0 8px 12px rgba(26,32,47,.14)}
.ddz-lobby{padding:30px 36px 36px}
.ddz-lobby-top{display:flex;justify-content:flex-start;align-items:flex-start;gap:24px;margin-bottom:46px}
.ddz-lobby-profile-stack{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.ddz-profile{gap:12px}
.ddz-profile-copy{display:flex;flex-direction:column;gap:2px}
.ddz-profile-name{font-size:15px;font-weight:700}
.ddz-profile-uid{font-size:12px}
.ddz-balance{gap:14px}
.ddz-balance-copy{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.ddz-lobby .ddz-balance-copy{align-items:flex-start}
.ddz-balance-label{font-size:12px;color:var(--dz-dim)}
.ddz-balance-value{font-size:20px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ddz-lobby-intro{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.ddz-section-title{font-size:16px;font-weight:700;letter-spacing:-.01em}
.ddz-lobby-subtitle{font-size:13px}
.ddz-table-grid{display:flex;gap:12px;align-items:stretch}
.ddz-table-grid .ddz-tab{min-height:92px}
.ddz-table-grid .ddz-tab>div:first-child{font-size:15px;margin-bottom:6px}
.ddz-lobby-actions{display:flex;align-items:center;gap:10px;margin-top:22px}
.ddz-helper{font-size:12px;margin-top:10px}
.ddz-table-screen{display:flex;flex-direction:column}
.ddz-table-reserved-bar{height:44px;flex:0 0 44px;visibility:hidden}
.ddz-game-table{min-height:0;gap:14px;padding:24px;background:#fbfcfd;border-color:#edf0f4;border-radius:18px}
.ddz-top-reveal{display:flex;justify-content:center;align-items:center;min-height:88px}
.ddz-reveal-cards{display:flex;align-items:center;gap:6px;padding:10px 12px;border:1px solid #cbd5ff;border-radius:12px;background:#f7f8ff}
.ddz-reveal-placeholder{font-size:12px;color:var(--dz-dim);padding:6px 12px;border-radius:999px;background:#eef1f6}
.ddz-table-middle{display:grid;grid-template-columns:minmax(144px,1fr) minmax(320px,1.6fr) minmax(144px,1fr);align-items:center;gap:18px;flex:1}
.ddz-table-center{min-height:188px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.ddz-table-center .ddz-played{min-height:82px}
.ddz-table-center .ddz-played .ddz-card{width:48px;height:68px}
.ddz-human-area{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.ddz-hand{display:flex;justify-content:center;flex-wrap:wrap;gap:4px;padding:2px 0}
.ddz-action-dock{order:-1;display:flex;justify-content:center;gap:10px;min-height:40px}
.ddz-action-status{font-size:13px;padding:10px 14px;border-radius:999px;background:#fff;border:1px solid var(--dz-line)}
.ddz-settle{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:100%}
.ddz-result-amount{font-size:32px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;margin:8px 0}
.ddz-seat{gap:8px}
.ddz-seat-chip{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border:1px solid var(--dz-line);border-radius:999px;background:rgba(255,255,255,.86);box-shadow:0 2px 6px rgba(26,32,47,.08)}
.ddz-seat-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.ddz-seat-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;white-space:nowrap}
.ddz-seat-meta{font-size:11px;color:var(--dz-dim);white-space:nowrap}
.ddz-seat-cards{font-size:11px;color:var(--dz-dim)}
.ddz-card-count{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef1f6}
@media (max-width:720px){.ddz-modal{width:100vw;height:100vh;border-radius:0}.ddz-body{padding:16px}.ddz-corner-close{top:10px;right:12px}.ddz-table-exit{top:10px;left:12px}.ddz-table-reserved-bar{height:36px;flex-basis:36px}.ddz-lobby{padding:20px 16px 24px}.ddz-lobby-top{align-items:flex-start;flex-direction:column;margin-bottom:32px}.ddz-balance{width:auto;justify-content:flex-start}.ddz-balance-copy{align-items:flex-start}.ddz-table-grid{flex-direction:column}.ddz-table-grid .ddz-tab{flex-basis:auto}.ddz-top-reveal{min-height:64px}.ddz-table-middle{grid-template-columns:1fr 1.5fr 1fr;gap:6px}.ddz-table-center{min-height:150px;order:0}.ddz-seat{min-width:0}.ddz-card{width:38px;height:56px;font-size:18px}.ddz-table{padding:12px}.ddz-float{right:12px;bottom:12px}}
@media (prefers-reduced-motion:reduce){.ddz-btn,.ddz-float,.ddz-card{transition:none}.ddz-card:hover,.ddz-float:hover{transform:none}.ddz-card.sel{transform:translateY(-8px)}}
`

/* ============================== 基础组件 ============================== */

function CardView({ card, selected, onClick }: { card: Card; selected?: boolean; onClick?: () => void }) {
  const isRed = card.s === 1 || card.s === 2 || card.r >= 13
  const label = cardName(card)
  return createElement('div', {
    className: 'ddz-card' + (isRed ? ' red' : '') + (selected ? ' sel' : ''),
    role: onClick ? 'button' : undefined,
    tabIndex: onClick ? 0 : undefined,
    'aria-label': onClick ? `选择${label}` : undefined,
    'aria-pressed': onClick ? selected : undefined,
    onClick,
    onKeyDown: onClick ? (event: { key: string }) => {
      if (event.key === 'Enter' || event.key === ' ') onClick()
    } : undefined,
  }, label)
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

  return createElement('div', { className: 'ddz-body ddz-lobby' },
    createElement('div', { className: 'ddz-lobby-top' },
      createElement('div', { className: 'ddz-lobby-profile-stack' },
        createElement('div', { className: 'ddz-profile ddz-row' },
          createElement(Avatar, { avatarId: profile.avatarId }),
          createElement('div', { className: 'ddz-profile-copy' },
            createElement('div', { className: 'ddz-profile-name' }, profile.nickname),
            createElement('div', { className: 'ddz-dim ddz-profile-uid' }, 'UID ' + profile.uid.slice(0, 8)),
          ),
          createElement('span', { className: 'ddz-rank' }, rank.name),
        ),
        createElement('div', { className: 'ddz-balance ddz-row' },
          createElement('div', { className: 'ddz-balance-copy' },
            createElement('div', { className: 'ddz-balance-label' }, 'Token 余额'),
            createElement('div', { className: 'ddz-balance-value' }, balance.toLocaleString()),
          ),
          createElement('button', {
            className: 'ddz-btn ddz-balance-btn',
            disabled: claimed,
            onClick: onClaim,
          }, claimed ? '今日已领' : `签到 +${CONFIG.dailyTokens.toLocaleString()}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-intro' },
      createElement('div', { className: 'ddz-section-title' }, '选择桌别'),
      createElement('div', { className: 'ddz-dim ddz-lobby-subtitle' }, '开局自动匹配 2 个本地机器人（M1 本地演示）'),
    ),
    createElement('div', { className: 'ddz-table-grid' },
      ...CONFIG.tables.map((t) =>
        createElement('button', {
          key: t.id,
          type: 'button',
          className: 'ddz-tab' + (tableId === t.id ? ' on' : ''),
          'aria-pressed': tableId === t.id,
          onClick: () => setTableId(t.id),
        },
          createElement('div', { style: { fontWeight: 700 } }, t.label),
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } },
            `底注 ${t.base.toLocaleString()} · 余额门槛 ${t.minBalance.toLocaleString()}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-actions' },
      createElement('button', { className: 'ddz-btn', disabled: balance < (tableById(tableId)?.base ?? 0), onClick: () => onStart(tableId) },
        '开始本地对局'),
      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onClose }, '最小化'),
    ),
    balance < (tableById(tableId)?.base ?? 0) &&
      createElement('div', { className: 'ddz-dim ddz-helper' },
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
  const hasConfirmedLandlord = state.phase !== 'calling' && state.landlord !== null

  return createElement('div', { className: 'ddz-body ddz-table-screen' },
    createElement('button', { className: 'ddz-table-exit', onClick: onExit }, '← 退出牌桌'),
    createElement('div', { className: 'ddz-table-reserved-bar', 'aria-hidden': true }),
    notice && createElement('div', { className: 'ddz-toast', onClick: () => setNotice(null) }, notice),

    createElement('div', { className: 'ddz-table ddz-game-table' },
      // 顶部揭示的地主底牌
      createElement('div', { className: 'ddz-top-reveal' },
        hasConfirmedLandlord
          ? createElement('div', { className: 'ddz-reveal-cards', 'aria-label': '已揭示的地主底牌' },
              ...state.bottom.map((card, i) => createElement(CardView, { key: i, card })),
            )
          : createElement('div', { className: 'ddz-reveal-placeholder' }, '底牌待揭示'),
      ),
      createElement('div', { className: 'ddz-table-middle', style: { justifyContent: 'space-between' } },
        createElement(SeatPanel, { view: botA!, state, isTurn: currentSeat === botA!.seat }),
        createElement('div', { className: 'ddz-table-center', style: { textAlign: 'center' } },
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
        createElement(SeatPanel, { view: botB!, state, isTurn: currentSeat === botB!.seat }),
      ),
      // 我的手牌与操作
      createElement('div', { className: 'ddz-human-area', style: { textAlign: 'center' } },
        createElement('div', { className: 'ddz-row ddz-hand', style: { justifyContent: 'center', flexWrap: 'wrap', gap: 4, paddingBottom: 4 } },
          ...sortedHand.map((c, i) =>
            createElement(CardView, {
              key: `${c.r}-${c.s}-${i}`,
              card: c,
              selected: selected.some((x) => x.r === c.r && x.s === c.s),
              onClick: () => toggleSelect(c),
            }),
          ),
        ),
        createElement('div', { className: 'ddz-action-dock ddz-row', style: { justifyContent: 'center', gap: 10, marginTop: 10 } },
          state.phase === 'calling'
            ? (isMyTurn
                ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                    createElement('button', { className: 'ddz-btn', onClick: () => humanAct({ type: 'call', call: true }) }, '叫地主'),
                    createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => humanAct({ type: 'call', call: false }) }, '不叫'),
                  )
                : createElement('span', { className: 'ddz-action-status ddz-dim' }, '等待叫地主…'))
            : (state.phase === 'playing'
                ? (isMyTurn
                    ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                        createElement('button', { className: 'ddz-btn', disabled: !canPlay(), onClick: () => humanAct({ type: 'play', cards: selected }) }, '出牌'),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: doHint }, '提示'),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', disabled: state.lastPlay === null, onClick: () => humanAct({ type: 'pass' }) }, '过'),
                      )
                    : createElement('span', { className: 'ddz-action-status ddz-turn' }, '对手思考中…'))
                : null),
        ),
      ),
    ),
  )
}

function SeatPanel(props: { view: SeatView; state: GameState; isTurn: boolean }) {
  const { view, state, isTurn } = props
  const handCount = state.hands[view.seat]!.length
  const role = state.phase !== 'calling' && state.landlord !== null ? roleOf(state, view.seat) : null
  return createElement('div', { className: 'ddz-seat' },
    createElement('div', { className: 'ddz-seat-chip' },
      createElement(Avatar, { avatarId: view.avatarId, size: 32 }),
      createElement('div', { className: 'ddz-seat-copy' },
        createElement('div', { className: 'ddz-seat-name', style: { gap: 6 } },
          createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, view.nickname),
          role === 'landlord' && createElement('span', { className: 'ddz-landlord-badge' }, '地主'),
          isTurn && createElement('span', { className: 'ddz-turn', style: { fontSize: 11 } }, '行动中'),
        ),
        createElement('div', { className: 'ddz-seat-meta' }, `剩 ${handCount} 张`),
      ),
    ),
    createElement('div', { className: 'ddz-seat-cards' },
      createElement('span', { className: 'ddz-card-count' }, handCount + ' 张手牌'),
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
    createElement('div', { className: 'ddz-result-amount' },
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
      createElement('span', { className: 'ddz-float-title' }, '🃏 斗地主'),
      createElement('span', { className: 'ddz-float-subtitle' }, '等待中，来一把')),
    open && createElement('div', { className: 'ddz-overlay', onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) setOpen(false) } },
      createElement('div', { className: 'ddz-modal' },
        createElement('button', { className: 'ddz-corner-close', 'aria-label': '关闭斗地主', onClick: () => setOpen(false) }, '×'),
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
