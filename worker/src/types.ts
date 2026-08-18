/**
 * worker/src/types.ts —— Worker 环境与共享类型
 */
import type { Seat } from '../../shared/engine/types.ts'

export interface Env {
  DB: D1Database
  KVPUBLIC: KVNamespace
  ROOM: DurableObjectNamespace
  QUEUE: DurableObjectNamespace
  AUTH_SECRET: string
  ANALYTICS_INGEST_KEY: string
  ADMIN_KEY: string
  /** 部署后客户端用到的后端基地址（如 https://dsh-doudizhu.xxx.workers.dev） */
  PUBLIC_API_ORIGIN?: string
}

/** KV 里房间的元数据 */
export interface RoomMeta {
  id: string
  tableId: string
  base: number
  createdAt: number
  players: Array<{
    uid: string
    seat: Seat
    nickname: string
    avatarId: string
    tokenBalance: number
  }>
}

/** 队列条目 */
export interface QueueEntry {
  uid: string
  nickname: string
  avatarId: string
  tokenBalance: number
  joinedAt: number
}
