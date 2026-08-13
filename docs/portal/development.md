# Portal Development

本页给出 Portal 的本地开发、Compose、connected 测试与恢复演练方法。connected 结果必须单独记录，不能用 unit 或静态 Demo 结果替代。

从 `vos/` 运行：

```sh
bun run dev:portal:demo
bun run --cwd apps/vos-portal typecheck
bun test apps/vos-portal/tests
bun run --cwd apps/vos-portal build:demo
bun run --cwd apps/vos-portal build
```

Production 需要 `DATABASE_URL`：

```sh
bun run --cwd apps/vos-portal migrate
bun run --cwd apps/vos-portal seed
bun run --cwd apps/vos-portal serve
```

`seed` 在生产环境必须额外显式设置 `VOS_PORTAL_ALLOW_SEED=1`。worker 必须通过
`DOCKER_HOST` 连接受限 Docker Socket Proxy，并提供 runner image、checkout/runner network
和资源上限；缺少任一边界时拒绝启动，不会连接共享 runner 或在宿主机执行学生代码。
pipeline worker 还必须连接 `VOS_WORKER_CONTROL_URL` （Compose 默认为
`http://vos-portal:8787/api/v1/internal/worker`）；它使用与 Portal 共享的
`VOS_PORTAL_MASTER_KEY` 派生每日轮换的 worker credential，缺少或校验失败不允许直接写入 pipeline。
Q&A worker 还必须提供 `VOS_QA_AGENT_ENDPOINT`、`VOS_QA_AGENT_TOKEN` 和
`VOS_PORTAL_MASTER_KEY`。模型、端点、价格和凭据由管理员控制面管理，不允许以 worker
环境变量绕过课程白名单或额度。`VOS_QA_AGENT_TOKEN` 必须与独立 `vos-agent` 的
`VOS_AGENT_SERVICE_TOKEN` 相同；非 loopback 的 `vos-agent` 缺少该 token 时拒绝启动。

Compose 生产基线通过 `https://localhost:8443` 提供 Portal，通过
`https://objects.localhost:8443` 提供签名对象 URL。必须设置数据库、MinIO、Gitea、
webhook 和 Portal 主密钥环境变量后执行：

```sh
export VOS_PORTAL_MASTER_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

主密钥必须是未填充的 32-byte base64url（43 个字符）；格式不符时 Portal 拒绝启动。
该密钥用于包封 OIDC、学校模型 Provider 与 BYOK 凭据，轮换前必须先完成密文重包封，不能直接替换。

```sh
docker compose --profile base --profile runner up -d
```

本地 Caddy 使用内部 CA。浏览器演示前应从 Caddy 数据卷导出并信任根证书；正式部署
必须将 Caddy 站点名和 `VOS_PORTAL_PUBLIC_ORIGIN`、`VOS_S3_PUBLIC_ENDPOINT` 一起替换
为真实 HTTPS 域名。应用代码和测试配置不得关闭 TLS 校验。API 与 PostgreSQL 不直接
发布到宿主网络。

以下连接式适配器测试只有显式传入测试端点时才会运行。本阶段不把它们列入交付门禁：

```sh
bun test apps/vos-portal/tests/postgres.integration.test.ts
bun test apps/vos-portal/tests/s3.integration.test.ts
bun test apps/vos-portal/tests/gitea.integration.test.ts
bun test apps/vos-portal/tests/project-provisioning.integration.test.ts
bun test apps/vos-portal/tests/project-provisioning-gitea.integration.test.ts
bun test apps/vos-portal/tests/course-control.integration.test.ts
bun test apps/vos-portal/tests/oidc.integration.test.ts
bun test apps/vos-portal/tests/qa-agent.integration.test.ts
bun test apps/vos-portal/tests/model-control.integration.test.ts
bun test apps/vos-portal/tests/runner-evidence.integration.test.ts
bun test apps/vos-portal/tests/docker-runner.integration.test.ts
bun test apps/vos-portal/tests/runner-load.integration.test.ts
bun test packages/vos-core/tests/portal-device.integration.test.ts
bun run --cwd apps/vos-portal test:teaching:connected
bun run --cwd apps/vos-portal test:runner:connected
```

项目供应的 PostgreSQL 测试覆盖并发幂等创建、五次失败后的终止调度、错误可见性和
人工重试。Gitea 连接测试还会从模板生成真实私有仓库、配置协作者与 webhook、通过
Contents API 产生 push，并把签名 delivery 送入 Portal；它们只在显式提供连接环境时
运行，不以 mock 结果替代 provider 验收。

课程控制连接测试覆盖并发幂等导入、发布、事务回滚快照、StageGate/rubric/AI policy
物化、`course.published` outbox 通知和带 quoted field 的分组名单。CSV 解析复用
`csv-parse` 的 browser ESM 构建，因此 Production repository 与离线 Demo 使用同一解析
语义且 Demo 不引入 Node `Buffer`。

OIDC 连接测试通过 `openid-client` 的受控 HTTPS transport 使用真实 RS256 ID Token，覆盖
provider secret 密文落库、API summary 不回显、成功登录、外部角色映射，以及 state、
issuer、audience 与 nonce 的拒绝路径。校园 issuer 的具体 client 注册仍属于部署配置。

runner evidence 连接测试使用受控 typed runner、真实 PostgreSQL 与 MinIO，覆盖 manifest
绑定、artifact checksum/size/path 门禁、内部对象上传、evidence projection 和谱系。该测试
不替代容器 runtime 验收。`docker-runner.integration.test.ts` 需显式设置
`VOS_TEST_DOCKER_RUNNER=1`，并使用真实 Gitea、Docker Engine 与 runner image 验证私有仓库
checkout、checkout/runner 网络切换、非 root、只读 rootfs、cap drop、内存/PID/tmpfs 磁盘
上限、Bearer 门禁、无外网和结束清理。该测试验证 Linux Docker Compose 首发基线，不等同
于 microVM 或 Kubernetes 证据。

`runner-load.integration.test.ts` 需显式设置 `VOS_TEST_RUNNER_LOAD=1`，在真实 PostgreSQL
创建 100 名学生、100 个项目和 100 个排队任务，验证 20 路 `SKIP LOCKED` 领取后并发启动
20 个真实隔离 runner。默认启动门限为 120 秒，可用 `VOS_RUNNER_LOAD_MAX_START_MS` 收紧；
该门限衡量任务环境就绪，不冒充课程 workload 的 QEMU 完成时间。
`test:runner:connected` 会在运行中的 Compose 服务旁创建受限 Docker socket proxy，将该压测
放入内部 runner/control 网络执行，并在结束时精确清理测试容器、仓库、网络和数据库 fixture。

`test:teaching:connected` 使用正在运行的 Compose PostgreSQL、Gitea、MinIO 与受限 Docker
runtime，覆盖真实教学闭环。测试不会创建第二套服务；它只创建带随机后缀且可精确清理的
课程、仓库、对象和 runner 网络。QA 源码 overlay 仅用于本地连接验证，不能替代最终镜像构建。

## Backup and restore

备份输出到 `VOS_BACKUP_DIR`（默认 `.tmp/portal-backups`），名称只能包含字母、数字、点、
下划线和连字符：

```sh
VOS_BACKUP_NAME=portal-20260718 docker compose --profile ops run --rm vos-ops backup
```

恢复是破坏性运维动作，只允许写入空对象 bucket，并要求名称绑定的显式确认。生产恢复应先
停止 Portal 与 worker，并使用隔离数据库和空 bucket 完成演练：

```sh
VOS_BACKUP_NAME=portal-20260718 \
VOS_RESTORE_CONFIRM=restore:portal-20260718 \
VOS_RESTORE_BUCKET=vos-artifacts-restore \
docker compose --profile ops run --rm vos-ops restore
```

backup 会先逐个验证数据库中 verified object 在源 bucket 的存在性和 SHA-256，再写入
`SHA256SUMS`；restore 会重新验证清单，恢复 PostgreSQL 与 MinIO 后再次逐对象校验。目标
bucket 非空、确认值不匹配、源对象缺失或任何 checksum 不一致都会终止。
GC 已删除对象的 tombstone（`deleted_at` 非空）保留在数据库中用于审计，但不属于可恢复对象集；
备份与恢复只校验仍存活的 verified object。

## Build Boundary

- `build` 在 `VOS_PORTAL_DEMO=1` 时失败。
- `build:demo` 在存在 `DATABASE_URL` 时失败。
- Demo bundle 扫描不得出现 Production API、数据库或 runner 配置。
- Production bundle 扫描不得出现 Demo storage key 或 Demo adapter chunk。
- `bun.lock` 不得固定到组织外的镜像站；容器构建使用官方 npm registry 并保留 tarball
  完整性校验。Portal 与 runner 镜像分别由 `Dockerfile` 和 `Runner.Dockerfile` 构建。
