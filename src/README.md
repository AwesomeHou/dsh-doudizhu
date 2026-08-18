# src/ — DSH 插件源码

当前 M1 已实现插件生命周期入口与 React 客户端本地演示；云端 API、DSH Agent 桥接和独立业务模块仍按路线图后续阶段演进。

```
src/
├── index.ts          # Cordis 服务端插件入口；M1 仅做加载确认
└── client/           # React 客户端 UI（注入 DSH Web GUI）
    ├── index.tsx     # 客户端挂载入口
    ├── App.tsx       # 大厅、牌桌、结算与本地交互
    └── brandAssets.ts # 内嵌默认头像/牌背 SVG Data URI
```

### 共享常量/类型
跨端（客户端 ↔ Cloudflare Worker）共用的常量、类型与规则引擎放 [../shared](../shared/README.md)。当前牌型/对局代码位于 `shared/engine/`，桌别、段位、签到、抽水与倒计时配置位于 `shared/config.ts`。
