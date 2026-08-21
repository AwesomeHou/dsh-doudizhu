/**
 * worker/src/room.ts —— Durable Object：对局房间
 * - WebSocket 网关：每个座位一条连接；消息由服务端权威校验（复用 shared/engine）
 * - 个性化广播：每个玩家只看到自己的手牌，其他人只显示手牌数
 * - 断线/超时托管：当前玩家无连接或 25s 超时 → 引擎自动出牌
 * - 结算：写 D1 流水/对局记录 → 广播 settle → 清理房间 KV
 */
import { botCall, botMove } from '../../shared/engine/bot.ts'
import { applyAction, createGame, roleOf, type GameState } from '../../shared/engine/game.ts'
import type { Card, Seat } from '../../shared/engine/types.ts'
import { settle } from '../../shared/engine/scoring.ts'
import { CONFIG } from '../../shared/config.ts'
import type { ClientMsg, GameStateForPlayer, ServerMsg, WireCard } from '../../shared/protocol.ts'
import { PROTOCOL_VERSION } from '../../shared/protocol.ts'
import { addLedger, recordMatch } from './db.ts'
import { clearRoom } from './queue.ts'
import type { Env, RoomMeta } from './types.ts'

interface SeatState {
  uid: string
  ws: WebSocket | null
  nickname: string
  avatarId: string
  tokenBalance: number
  connected: boolean
}

const TURN_MS = CONFIG.turnTimeoutMs
const AUTO_DISCONNECT_MS = 8_000

export class Room {
  private env: Env
  private state: DurableObjectState
  private meta: RoomMeta | null = null
  private seats: (SeatState | null)[] = [null, null, null]
  private game: GameState | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private settled = false

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    // 调试端点：查看房间内部状态
    if (url.searchParams.get('debug') === '1') {
      return Response.json({
        phase: this.game?.phase ?? null,
        current: this.game?.current ?? null,
        finished: this.game?.finished ?? false,
        redeal: this.game?.redeal ?? false,
        landlord: this.game?.landlord ?? null,
        callActor: this.game?.callActor ?? null,
        multiplier: this.game?.multiplier ?? null,
        seats: this.seats.map((s) => s ? { uid: s.uid.slice(0, 8), connected: s.connected } : null),
        metaId: this.meta?.id ?? null,
        dlog: await this.state.storage.get<Array<string>>('dlog') ?? [],
      })
    }
    const uid = url.searchParams.get('uid')
    const seatRaw = url.searchParams.get('seat')
    const roomId = url.pathname.split('/').pop() ?? ''
    if (!uid || seatRaw === null || !roomId) return new Response('bad request', { status: 400 })
    const seat = Number(seatRaw) as Seat
    if (seat < 0 || seat > 2) return new Response('bad seat', { status: 400 })

    if (!this.meta) {
      const { getRoomMeta } = await import('./queue.ts')
      this.meta = await getRoomMeta(this.env, roomId)
    }
    if (!this.meta) return new Response('room not found', { status: 404 })
    // 在 fetch 阶段（返回 101 之前）完成所有 await：open() 里 acceptWebSocket 之后
    // 不能再 await（DO 休眠会打断 101 握手，导致后续连接失败）
    if (!this.game) {
      const saved = await this.state.storage.get<GameState>('game')
      this.game = saved ?? createGame()
    }
    // DO 休眠后内存状态（this.seats/this.meta/this.game）会丢失，只有 storage 与
    // 已接受 WS 存活：从 getWebSockets() 重建座位绑定。
    this.rebuildSeats()
    return this.open(request, uid, seat)
  }

  /** 从运行时仍存活/已接受的 WebSocket 重建座位绑定（hibernation 唤醒后调用） */
  private rebuildSeats(): void {
    this.seats = [null, null, null]
    const sockets = this.state.getWebSockets()
    for (const ws of sockets) {
      const tag = ws.deserializeAttachment() as { seat: number; uid: string } | null
      if (!tag || tag.seat < 0 || tag.seat > 2) continue
      const p = this.meta?.players.find((x) => x.seat === tag.seat)
      this.seats[tag.seat] = {
        uid: tag.uid,
        ws,
        nickname: p?.nickname ?? `座位${tag.seat}`,
        avatarId: p?.avatarId ?? 'default-01',
        tokenBalance: p?.tokenBalance ?? 0,
        connected: true,
      }
    }
  }

  /** 定位 ws 对应的座位（先重建，保证 hibernation 后仍能命中） */
  private seatOf(ws: WebSocket): Seat {
    this.rebuildSeats()
    const seat = this.seats.findIndex((s) => s && s.ws === ws)
    return seat as Seat
  }

  private async open(request: Request, uid: string, seat: Seat): Promise<Response> {
    // 校验 uid 是否属于该房间的该座位
    const player = this.meta!.players.find((p) => p.uid === uid && p.seat === seat)
    if (!player) return new Response('not a member of this room seat', { status: 403 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    // hibernation API：acceptWebSocket 后消息经 webSocketMessage/webSocketClose 回调，
    // 而不是 addEventListener（混用会收不到消息）；附件用于休眠后重建座位映射
    server.serializeAttachment({ seat, uid })
    this.state.acceptWebSocket(server)
    this.seats[seat] = {
      uid,
      ws: server,
      nickname: player.nickname,
      avatarId: player.avatarId,
      tokenBalance: player.tokenBalance,
      connected: true,
    }
    this.broadcastState()
    this.startTurnTimer()
    return new Response(null, { status: 101, webSocket: client })
  }

  /** hibernation 回调：收到客户端消息 */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat < 0) return
    await this.onMessage(seat, typeof message === 'string' ? message : new TextDecoder().decode(message))
  }

  /** hibernation 回调：连接关闭 */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat < 0) return
    await this.onClose(seat)
  }

  /** hibernation 回调：连接错误 */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat < 0) return
    await this.onClose(seat)
  }

  private async onMessage(seat: Seat, raw: string): Promise<void> {
    if (!this.game || this.settled) return
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      this.send(seat, { v: 1, t: 'error', d: { message: 'bad message' } })
      return
    }
    if (msg.v !== PROTOCOL_VERSION) return
    // 调试日志：记录最近收到的消息
    try {
      const prev = (await this.state.storage.get<Array<string>>('dlog')) ?? []
      prev.push(`seat${seat} ${msg.t} @${Date.now()}`)
      await this.state.storage.put('dlog', prev.slice(-30))
    } catch { /* ignore */ }
    try {
      switch (msg.t) {
        case 'call':
          this.game = applyAction(this.game, { type: 'call', seat, call: Boolean((msg.d as { call: boolean }).call) })
          break
        case 'play': {
          const cards = (msg.d as { cards: WireCard[] }).cards
          this.game = applyAction(this.game, { type: 'play', seat, cards: cards as Card[] })
          break
        }
        case 'pass':
          this.game = applyAction(this.game, { type: 'pass', seat })
          break
        case 'ping':
          // 延迟探测：原样回 ts，客户端算 RTT
          this.send(seat, { v: PROTOCOL_VERSION, t: 'pong', d: { ts: (msg.d as { ts: number }).ts } })
          return
        default:
          return
      }
    } catch (err) {
      console.log(`[room] reject ${msg.t} from seat ${seat}:`, err instanceof Error ? err.message : err)
      this.send(seat, { v: 1, t: 'error', d: { message: err instanceof Error ? err.message : 'invalid move' } })
      return
    }

    if (this.game.redeal) {
      // 无人叫地主 → 重开（不发钱）
      this.game = createGame()
    }
    await this.state.storage.put('game', this.game)
    if (this.game.finished) {
      await this.finish()
      return
    }
    this.broadcastState()
    this.startTurnTimer()
  }

  private async onClose(seat: Seat): Promise<void> {
    const s = this.seats[seat]
    if (s) s.connected = false
    this.broadcastState()
    // 轮到自己但断线 → 尽快托管
    if (this.game && !this.game.finished && this.game.current === seat) {
      this.clearTimer()
      this.turnTimer = setTimeout(() => void this.autoAct(seat), AUTO_DISCONNECT_MS)
    }
  }

  private startTurnTimer(): void {
    this.clearTimer()
    if (!this.game || this.game.finished || this.game.phase === 'settled') return
    const seat = this.game.current
    const connected = this.seats[seat]?.connected ?? false
    const delay = connected ? TURN_MS : AUTO_DISCONNECT_MS
    this.turnTimer = setTimeout(() => void this.autoAct(seat), delay)
  }

  private async autoAct(seat: Seat): Promise<void> {
    if (!this.game || this.game.finished || this.game.current !== seat) return
    try {
      if (this.game.phase === 'calling') {
        const call = botCall(this.game.hands[seat]!)
        this.game = applyAction(this.game, { type: 'call', seat, call })
      } else {
        const move = botMove(this.game.hands[seat]!, this.game.lastPlay)
        this.game = move === null
          ? applyAction(this.game, { type: 'pass', seat })
          : applyAction(this.game, { type: 'play', seat, cards: move })
      }
    } catch {
      return
    }
    if (this.game.redeal) this.game = createGame()
    await this.state.storage.put('game', this.game)
    if (this.game.finished) {
      await this.finish()
      return
    }
    this.broadcastState()
    this.startTurnTimer()
  }

  private async finish(): Promise<void> {
    if (this.settled) return
    this.settled = true
    this.clearTimer()
    const game = this.game!
    const meta = this.meta!
    const s = settle(game.landlord!, game.winner!, meta.base, game.multiplier, CONFIG.rakeRate)

    // 服务端权威落账
    const balances: Record<string, number> = {}
    const playerRows: Array<Record<string, unknown>> = []
    for (let i = 0; i < 3; i++) {
      const st = this.seats[i]
      if (!st) continue
      const delta = s.deltas[i]
      try {
        balances[st.uid] = await addLedger(this.env, st.uid, delta >= 0 ? 'game_in' : 'game_out', delta, meta.id)
      } catch {
        balances[st.uid] = st.tokenBalance + delta
      }
      playerRows.push({
        uid: st.uid, seat: i, role: roleOf(game, i as Seat),
        result: game.winner === roleOf(game, i as Seat) ? 'win' : 'lose', delta,
      })
    }
    await recordMatch(this.env, {
      id: meta.id, tableId: meta.tableId, baseStake: meta.base,
      multiplier: game.multiplier, rake: s.rake, players: playerRows, winner: game.winner!,
    })

    const springText = game.spring === 'none' ? '无' : game.spring === 'landlord' ? '春天' : '反春'
    for (let i = 0; i < 3; i++) {
      const st = this.seats[i]
      if (!st || !st.ws) continue
      const uid = st.uid
      const msg: ServerMsg = {
        v: 1, t: 'settle',
        d: {
          winner: game.winner!, spring: springText, multiplier: game.multiplier, rake: s.rake,
          myDelta: s.deltas[i], balance: st.tokenBalance, balance_after: balances[uid] ?? st.tokenBalance + s.deltas[i],
        },
      }
      this.send(i as Seat, msg)
    }
    await clearRoom(this.env, meta.id, meta.players.map((p) => p.uid))
  }

  private stateFor(seat: Seat): GameStateForPlayer {
    const game = this.game!
    const meta = this.meta!
    // 叫地主阶段的 landlord 只是当前最高叫分者，只有进入出牌阶段才正式确定。
    const landlord = game.phase === 'calling' ? null : game.landlord
    return {
      phase: game.phase,
      seat,
      hand: game.hands[seat]!.map((c) => ({ r: c.r, s: c.s })),
      bottom: landlord === null ? [] : game.bottom.map((c) => ({ r: c.r, s: c.s })),
      landlord,
      hasCalled: game.landlord !== null,
      current: game.current,
      callOrder: game.callOrder,
      callActor: game.callActor,
      callMultiplier: game.callMultiplier,
      lastPlayCards: game.lastPlayCards ? game.lastPlayCards.map((c) => ({ r: c.r, s: c.s })) : null,
      lastActor: game.lastActor,
      multiplier: game.multiplier,
      bombCount: game.bombCount,
      spring: game.spring,
      seats: meta.players.map((p) => {
        const s = this.seats[p.seat]
        return {
          seat: p.seat, uid: p.uid, nickname: p.nickname, avatarId: p.avatarId,
          count: game.hands[p.seat]!.length,
          role: landlord === null ? null : roleOf(game, p.seat),
          connected: s?.connected ?? false,
          tokenBalance: p.tokenBalance,
        }
      }),
      turnStartedAt: Date.now(),
      turnTimeoutMs: TURN_MS,
      finished: game.finished,
      winner: game.winner,
    }
  }

  private broadcastState(): void {
    if (!this.game) return
    for (let i = 0; i < 3; i++) {
      const s = this.seats[i]
      if (s?.ws && s.connected) {
        this.send(i as Seat, { v: 1, t: 'state', d: this.stateFor(i as Seat) })
      }
    }
  }

  private send(seat: Seat, msg: ServerMsg): void {
    const s = this.seats[seat]
    try {
      if (s?.ws && s.connected) s.ws.send(JSON.stringify(msg))
    } catch { /* socket gone */ }
  }

  private clearTimer(): void {
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer)
      this.turnTimer = null
    }
  }
}
