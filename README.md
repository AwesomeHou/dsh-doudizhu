# 斗地主 · dsh-doudizhu

> 在等 DSH 回话的间隙，来一把斗地主。

一个运行在 **DeepSeek Harness Web GUI**（`http://127.0.0.1:3080`）里的斗地主插件。

- **M1**：3 人标准斗地主本地闭环 · **玩家 vs 机器人 ×2**，本地规则引擎与 localStorage 模拟 Token/资料。
- **M2（当前）**：3 人真人 **PVP**，由 Cloudflare 负责匹配、实时同步与服务端经济记账。
- **M3（后续）**：引入 **DSH Agent** —— 用自己的 DSH 或别人的 DSH 当牌友/对手（人机混桌、全 AI 观战对局）。

> **状态：M1 完成；M2 后端（Cloudflare Workers/Room DO/D1）已开发、部署并通过本地+线上 e2e，客户端在线模式（签到/匹配/WS 真人 PVP）已接入，待重启 GUI 实机复测。**
> 已包含 React/TypeScript 插件入口、浅色大厅/牌桌 UI、本地/在线双模式、Token/签到、默认头像选择、昵称编辑、规则引擎与单机/真人 PVP 对局。

## 快速导航

| 文档 | 说明 |
|---|---|
| [需求文档](docs/需求文档.md) | 产品范围、功能需求、非功能需求、验收标准 |
| [策划文档](docs/策划文档.md) | 玩法规则、Token 经济、段位数值、UI/UX、文案 |
| [架构设计](docs/架构设计.md) | DSH 插件 + Cloudflare 后端整体架构、数据模型、协议 |
| [路线图](docs/路线图.md) | M0–M4 里程碑与交付节奏 |
| [数据埋点](docs/数据埋点.md) | 访问统计方案（回应 Cloudflare 是否自动统计）+ 事件字典 |
| [美术资源规范](assets/README.md) | 美术资源目录、命名与规格约定 |
| [界面设计](DESIGN.md) | 现代化浅色工作台风格、颜色、布局与交互状态 |

## 仓库结构

```
dsh-doudizhu/
├── docs/            # 需求、策划、架构、路线图、埋点
├── src/             # DSH 插件入口与 React 客户端 UI
├── worker/          # Cloudflare 后端（Workers + Durable Objects + D1，规划中）
├── shared/          # 客户端与服务端共享的规则引擎、配置与协议
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

## 安装（给使用者）

仓库公开，构建产物 `lib/` 已随仓库提交，任何 DSH 用户可直接从 GitHub 安装。

**前置**：`dsh plugin` 命令依赖 **pnpm 在 PATH 中**（DSH 源码直接 `spawnSync("pnpm", ...)`）。没有 pnpm 会报 `'pnpm' 不是内部或外部命令`。安装 pnpm（二选一）：

```bash
npm install -g pnpm        # 已装 Node/npm 时
# 或
corepack enable pnpm       # Node 自带的 corepack
```

然后安装插件：

```bash
# 方式一（推荐）：GitHub 安装
dsh plugin --profile web add github:AwesomeHou/dsh-doudizhu

# 若提示 workspace root 报错（ERR_PNPM_ADDING_TO_ROOT），加 -w：
dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu
```

装完后**重启 `dsh web`**，刷新界面即可在右下角看到「🃏 斗地主」入口。

> 说明：
> - 插件的在线对战依赖部署在 Cloudflare 的后端（客户端内置默认 API 地址），无需使用者自建后端。
> - 本地机器人对局完全离线可用（M1 模式）。
> - 安装即把插件加入 profile 的 bundle 栈（`cordis.patch.yml`），卸载用 `dsh plugin --profile web remove dsh-doudizhu`。
> - 若安装报 `git-hosted plugins build on install via their prepare script ... allowBuilds` 的提示：那是 DSH 对 git 安装失败的**通用诊断**。本插件**没有 prepare/install 构建脚本**（`lib/` 预构建随包分发），pnpm 不会对它做构建拦截，因此无需添加 allowBuilds 条目；只要 pnpm 可用、重跑命令即可成功。

## 本地开发（给维护者）

- Node.js ≥ 20，npm。
- 安装依赖：`npm install`
- 类型检查：`npm run typecheck`
- 单元测试：`npm test`；本地/线上 PVP 联调：`npm run test:e2e`（需 `cd worker && npx wrangler dev`）
- 构建插件：`npm run build`（**改完源码必须重新构建，并把 `lib/` 一并提交**，分发依赖随仓库携带的构建产物）
- 插件安装（本地开发联调）：`dsh plugin --profile web add -w link:E:/dsh-plugin/dsh-doudizhu`
- 后端本地调试：`cd worker && wrangler dev`（需 Cloudflare 账号与 wrangler 配置）。

## 许可

MIT，见 [LICENSE](LICENSE)。
