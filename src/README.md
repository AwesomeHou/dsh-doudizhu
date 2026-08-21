# src/ — DSH 插件源码

当前 M1（本地机器人对局）与 M2（Cloudflare 在线真人 PVP）均已实现；DSH Agent 桥接仍按路线图 M3 演进。

```
src/
├── index.ts          # Cordis 服务端插件入口；当前仅做加载确认
└── client/           # React 客户端 UI（注入 DSH Web GUI）
    ├── index.tsx     # 客户端挂载入口（body portal + 独立工作区 + createRoot）
    ├── App.tsx       # 大厅、本地/在线牌桌、结算与交互
    ├── api.ts        # 云端 REST / WebSocket 客户端（身份/签到/匹配/房间）
    ├── table-view.ts # 统一牌桌视图模型（本地引擎状态 ↔ 线上 WS 状态）
    └── brandAssets.ts # 内嵌默认头像/牌背 SVG Data URI
```

### 说明
- **双模式**：大厅左上角切换「本地练习 / 在线对战」；在线模式经 Cloudflare Worker 走服务端权威记账与 WS 实时对局。
- **牌桌共用**：`GameTableShell` 一套 UI 由 `TableView` 驱动，本地（引擎状态）与线上（WS 状态）各自生成视图。
- 在线 API 基地址默认线上 Worker（`src/client/api.ts`），可用 `localStorage['ddz:api']` 覆盖以便本地联调。

### 共享常量/类型
跨端（客户端 ↔ Cloudflare Worker）共用代码在 [../shared](../shared/README.md)：规则引擎 `shared/engine/`、桌别/段位/签到/抽水配置 `shared/config.ts`、WS 消息协议 `shared/protocol.ts`。
