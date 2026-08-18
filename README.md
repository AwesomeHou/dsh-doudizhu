# 斗地主 · dsh-doudizhu

> 在等 DSH 回话的间隙，来一把斗地主。

一个运行在 **DeepSeek Harness Web GUI**（`http://127.0.0.1:3080`）里的斗地主插件。

- **第一阶段（当前规划）**：3 人标准斗地主 · **玩家 vs 玩家（PVP）**，Cloudflare 云端负责匹配与实时对局同步。
- **第二阶段**：引入 **DSH Agent** —— 用自己的 DSH 或别人的 DSH 当牌友/对手（人机混桌、全 AI 观战对局）。

> ⚠️ **状态：M1 本地最小闭环开发中。**
> 当前已包含 React/TypeScript 插件入口、浅色大厅/牌桌 UI、本地 Token/签到、规则引擎与单机机器人对局；Cloudflare PVP 后端仍按路线图进入 M2。

## 快速导航

| 文档 | 说明 |
|---|---|
| [需求文档](docs/需求文档.md) | 产品范围、功能需求、非功能需求、验收标准 |
| [策划文档](docs/策划文档.md) | 玩法规则、Token 经济、段位数值、UI/UX、文案 |
| [架构设计](docs/架构设计.md) | DSH 插件 + Cloudflare 后端整体架构、数据模型、协议 |
| [路线图](docs/路线图.md) | M0–M4 里程碑与交付节奏 |
| [数据埋点](docs/数据埋点.md) | 访问统计方案（回应 Cloudflare 是否自动统计）+ 事件字典 |
| [美术资源规范](assets/README.md) | 美术资源目录、命名与规格约定 |

## 仓库结构

```
dsh-doudizhu/
├── docs/            # 需求、策划、架构、路线图、埋点
├── src/             # DSH 插件源码（client / engine / server 三部分，规划中）
├── worker/          # Cloudflare 后端（Workers + Durable Objects + D1，规划中）
├── shared/          # 客户端与服务端共享的类型/常量（规划中）
├── assets/          # 美术资源（扑克牌、头像、UI、音效）
├── scratch/         # 草稿文件夹（已 gitignore，不入库）
├── package.json     # DSH 插件清单（安装入口）
└── cordis.patch.yml # 插件挂载补丁
```

## 技术栈速览

- **客户端**：DSH 插件（Cordis + React + TypeScript），通过 `dsh.client.inject` 注入 Web GUI。
- **规则引擎**：纯 TypeScript，服务端与客户端共用，可单测。
- **后端**：Cloudflare Workers（Hono）+ Durable Objects（房间/实时同步）+ D1（持久化）+ KV/R2。
- **AI（第二阶段）**：牌位由「受控 DSH 客户端」接管，出牌决策走本地 headless 会话。

## 本地环境

- Node.js ≥ 20，pnpm。
- 插件安装（进入开发期后）：`dsh plugin --profile web add AwesomeHou/dsh-doudizhu`
- 后端本地调试：`cd worker && wrangler dev`（需 Cloudflare 账号与 wrangler 配置）。

## 许可

MIT，见 [LICENSE](LICENSE)。
