# src/ — 插件源码（规划中）

> ⚠️ 当前为目录占位，正式代码从路线图 **M1** 起实现。以下为规划结构，与 [docs/架构设计.md](../docs/架构设计.md) §2.2 对应。

```
src/
├── index.ts        # Cordis 服务端插件入口（注册服务/工具、本地 DSH Agent 桥接）
├── config.ts       # 可配置项默认值（段位阈值、底注、rake 等）
├── engine/         # 斗地主规则引擎（纯 TS，可单测）
│   ├── deck.ts     # 发牌/洗牌
│   ├── types.ts    # 牌、牌型、对局状态
│   ├── valid.ts    # 出牌合法性
│   ├── compare.ts  # 牌型比较
│   └── scoring.ts  # 倍数/结算
├── client/         # React 客户端 UI（DSH GUI 内注入）
│   ├── index.tsx   # 客户端入口（slots 注册）
│   ├── Lobby.tsx   # 大厅
│   ├── GameTable.tsx # 牌桌
│   ├── Settle.tsx  # 结算页
│   ├── Wallet.tsx  # Token 流水
│   └── api.ts      # REST/WS 客户端封装
├── agent/          # (Phase 2) DSH Agent 桥接（headless 决策调用、提示词模板）
└── i18n/           # zh/en 文案（沿用 DSH locale 机制）
```

### 共享常量/类型
跨端（客户端 ↔ Cloudflare Worker）共用的常量与类型放 [../shared](../shared/README.md)：协议消息、段位阈值、桌别配置、牌型定义。
