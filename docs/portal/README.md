# VOS Portal

> 本目录记录暂留 Portal 的现有实现，不是本阶段的学生契约。Portal API、worker、Web UI 和静态 Demo 已冻结，只维持 typecheck、build 与 unit test；旧 connected teaching loop 不属于当前验收，也不能重新暴露成学生 CLI。

`vos/apps/vos-portal` 保留同源 Web、`/api/v1`、后台 worker 和独立静态 Demo。旧 Portal 前端已经退役，不存在生产兼容入口。`vos-server` 仍保留内部 HTTP 实现，但学生 CLI 已删除 `serve` 入口，只在进程内调用 `vos-agent/headless`；冻结的 worker connected 路径因此不属于当前可运行承诺。

## 运行模式

- Production（冻结前设计）：PostgreSQL 是业务真相源，MinIO 保存带校验和的对象，Gitea 提供仓库与 webhook，worker 原先通过隔离环境中的 `vos serve` 调用 VOS。恢复这条路径需要新的内部入口与完整 connected 复验。
- Demo：`bun run dev:portal:demo` 或 `bun run --cwd apps/vos-portal build:demo`。它只使用版本化 `localStorage`，不调用 API、模型、Gitea 或 runner。

```sh
cd vos
bun install --ignore-scripts
bun run dev:portal:demo
```

Production 首次启动必须显式迁移和 seed；数据库或 runner 不可用时不会回退到 Demo。

## 文档

- [架构](architecture.md)
- [API](api.md)
- [数据模型](data-model.md)
- [开发与验证](development.md)
- [交付状态](todo.md)
