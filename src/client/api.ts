/**
 * src/client/api.ts —— M2 云端 API / WebSocket 客户端
 * 基地址默认线上 Worker；可用 localStorage 'ddz:api' 覆盖（本地联调用 http://127.0.0.1:8787）
 */
import { APP_VERSION, PROTOCOL_VERSION, type HealthInfo } from '../../shared/protocol.ts'

const DEFAULT_API = 'https://dsh-doudizhu.1546567314.workers.dev'

export function apiBase(): string {
  return (localStorage.getItem('ddz:api') ?? DEFAULT_API).replace(/\/+$/, '')
}

function authToken(): string | null {
  return localStorage.getItem('ddz:token')
}

/** 服务器健康/版本信息（进入在线模式前做协议兼容性检查） */
export function health(): Promise<HealthInfo> {
  return req('/api/health')
}

async function req<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authToken()
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`)
  }
  return data as T
}

export interface PublicPlayer {
  uid: string
  nickname: string
  avatarId: string
  balance: number
  peakBalance: number
  rank: string
  rankId: number
}

/** 换取 token（服务端同时建档） */
export async function auth(uid: string): Promise<{ token: string; player: PublicPlayer }> {
  const r = await req<{ token: string; player: PublicPlayer }>('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ uid }),
  })
  localStorage.setItem('ddz:token', r.token)
  return r
}

export function getMe(): Promise<{ player: PublicPlayer }> {
  return req('/api/me')
}

export function updateProfile(nickname: string, avatarId: string): Promise<{ player: PublicPlayer }> {
  return req('/api/me/profile', { method: 'PUT', body: JSON.stringify({ nickname, avatarId }) })
}

export function claimDaily(): Promise<{ amount: number; balance: number }> {
  return req('/api/daily', { method: 'POST' })
}

/** 破产救济（每日一次，余额低于最低桌门槛时可领） */
export function rescue(): Promise<{ amount: number; balance: number }> {
  return req('/api/rescue', { method: 'POST' })
}

export type QueueResult =
  | { status: 'waiting'; count: number }
  | { status: 'matched'; roomId: string }

export function joinQueue(tableId: string): Promise<QueueResult> {
  return req('/api/lobby/queue', { method: 'POST', body: JSON.stringify({ tableId }) })
}

export function pollQueue(tableId: string): Promise<QueueResult> {
  return req(`/api/lobby/status?tableId=${encodeURIComponent(tableId)}`)
}

export function leaveQueue(tableId: string): Promise<{ ok: true }> {
  return req('/api/lobby/queue', { method: 'DELETE', body: JSON.stringify({ tableId }) })
}

/** 连接对局房间 WebSocket（token/协议/应用版本走查询参数，浏览器可行） */
export function connectRoom(roomId: string): WebSocket {
  const base = apiBase().replace(/^http/, 'ws')
  const token = authToken()
  const params = new URLSearchParams({
    token: token ?? '',
    protocol: String(PROTOCOL_VERSION),
    app: APP_VERSION,
  })
  return new WebSocket(`${base}/ws/room/${encodeURIComponent(roomId)}?${params.toString()}`)
}
