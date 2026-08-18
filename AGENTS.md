# dsh-doudizhu 项目说明

- 项目定位：运行在 DeepSeek Harness Web GUI 中的斗地主插件。
- 当前状态：M1 本地闭环；玩家对机器人×2，资料、Token/签到使用 localStorage；M2 云端 PVP 尚未接入。
- 技术栈：Node.js 20+、TypeScript、React 18、Cordis、tsdown、Vitest。
- 规则引擎：`shared/engine/`；公共配置：`shared/config.ts`；客户端入口：`src/client/index.tsx`；主界面：`src/client/App.tsx`。
- 默认头像/牌背：源素材在 `assets/deepseek-blue.svg` 和 `assets/deepseek-black.svg`，客户端运行时使用 `src/client/brandAssets.ts` 的内嵌 Data URI。
- 常用命令：`npm install`、`npm run typecheck`、`npm test`、`npm run build`。
- 文档入口：`README.md`、`PRODUCT.md`、`DESIGN.md`、`docs/`；源码目录说明见 `src/README.md`。
- 变更约定：保持本地 M1 与 M2/M3 规划边界清晰；UI 改动同步 `DESIGN.md` 与 `docs/策划文档.md`；规则改动补充 `shared/engine/engine.test.ts`。
