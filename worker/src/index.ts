// dsh-doudizhu Worker 入口 —— 连通性脚手架（M0）
// 仅提供健康检查，用于验证「本机 wrangler ↔ Cloudflare 账号」连通。
// 正式后端（房间/经济/埋点等）从路线图 M2 起在此扩展。
import { Hono } from 'hono'

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true, service: 'dsh-doudizhu', ts: Date.now() }))

export default app
