# worker/ — Cloudflare 后端（规划中）

> ⚠️ 目录占位。正式代码从路线图 **M2** 起实现。以下为规划结构，对应 [docs/架构设计.md](../docs/架构设计.md) §3、§7 与 [docs/数据埋点.md](../docs/数据埋点.md)。

```
worker/
├── src/
│   ├── index.ts        # Hono 入口，路由装配（REST + WS 升级）
│   ├── auth.ts         # 匿名 UID → 自签 token
│   ├── room.ts         # Durable Object：对局房间（权威状态机 / WS / 断线托管）
│   ├── player.ts       # Durable Object：玩家（经济串行化）或 D1 事务
│   ├── economy.ts      # 结算 / 签到 / 抽水 / 流水
│   ├── analytics.ts    # 埋点 ingest + 聚合
│   ├── admin.ts        # 只读报表端点
│   └── types.ts        # 共享类型
├── migrations/         # D1 迁移（schema.sql）
├── wrangler.toml.example   # 配置模板（真实 wrangler.toml 已 gitignore）
├── package.json.example    # 依赖模板
└── README.md
```

## 本地开发（M2 起）

```bash
cd worker
cp wrangler.toml.example wrangler.toml   # 填入 account_id / D1 id
npm install
wrangler d1 migrations apply doudizhu --local   # 本地建表
wrangler dev                                  # 本地起 Worker
```

> 需要：Cloudflare 账号、安装 `wrangler`、`wrangler login`。生产部署前配置 secret：`AUTH_SECRET`、`ANALYTICS_INGEST_KEY`、`ADMIN_KEY`。
