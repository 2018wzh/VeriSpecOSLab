# VOS Portal

`vos/apps/vos-portal` 是课程教学控制面，同时提供同源 Web、`/api/v1`、后台 worker 和独立静态 Demo。旧 Portal 前端已经退役，不存在生产兼容入口。

## 运行模式

- Production：PostgreSQL 是业务真相源，MinIO 保存带校验和的对象，Gitea 提供仓库与 webhook，worker 通过隔离环境中的 `vos serve` 调用 VOS。
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
