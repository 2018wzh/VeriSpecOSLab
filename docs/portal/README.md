# VOS Portal

本目录记录 VOS Portal 的生产架构、API、部署与 connected 验收。离线 v2 学生主链保持不变；公开在线入口只存在于 `vos portal ...` 命名空间。

`vos/apps/vos-portal` 提供同源 Web、Fastify `/api/v1` 控制面、后台 worker、隔离 Runner 和独立静态 Demo。Runner 通过专用内部入口启动 `vos-server`，不向学生恢复 `serve` 命令。

## 运行模式

- Production：PostgreSQL 是业务真相源，MinIO 保存带校验和的对象，Gitea 提供仓库与 webhook，worker 通过隔离环境中的专用 runner server 调用 VOS。
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
- [部署与恢复](deployment.md)
- [CLI 使用](../manual/vos/07-portal-workflow.md)
- [交付状态](todo.md)
