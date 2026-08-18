# shared/ — 客户端与服务端共享代码

> **更新**：规则引擎已从原规划的 `src/engine` 迁移到 `shared/engine/`，客户端插件与 Cloudflare Worker 复用同一份实现。M1 起生效。

- `engine/` — 斗地主规则引擎（纯 TS、无 I/O、可单测）：
  - `types.ts` 牌/牌型/状态类型
  - `deck.ts` 发牌/洗牌
  - `compare.ts` 牌型比较（canBeat）
  - `valid.ts` 合法性判断（classify/legalPlays/buildPlay/hintPlay）
  - `scoring.ts` 结算（底注×倍数、抽水、账目守恒）
  - `bot.ts` 简单机器人决策（最小合法牌/先手甩牌）
  - `game.ts` 对局状态机（叫地主/出牌/结算的纯函数 reducer）
- `config.ts` — 段位阈值、桌别底注、rake、签到额等**可配置数值**（单点修改，双端生效）
- `protocol.ts` — （M2）WS 消息封装与版本号

> 原则：引擎必须纯函数、无 I/O，才能客户端/服务端双端复用且可靠单测。
