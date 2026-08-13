# Portal 部署

Portal 是单校自托管控制面。Compose 的 `base`、`runner`、`test`、`ops` profiles
分别提供基础服务、隔离测评、连接式测试和备份恢复；生产入口只有 Caddy，Portal、
PostgreSQL、MinIO、Worker control 和 Docker socket proxy 不发布到公网。

## 首次启动

先设置部署机密（不要提交到仓库）：

```sh
export VOS_PORTAL_DB_PASSWORD='change-me'
export VOS_GITEA_DB_PASSWORD='change-me-too'
export VOS_MINIO_ROOT_USER='vosminio'
export VOS_MINIO_ROOT_PASSWORD='change-a-long-password'
export VOS_PORTAL_MASTER_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
export VOS_GITEA_INTERNAL_TOKEN='change-gitea-internal-token'
export VOS_GITEA_SECRET_KEY='change-gitea-secret-key'
export VOS_GITEA_TOKEN='provisioned-gitea-token'
export VOS_GITEA_WEBHOOK_SECRET='change-webhook-secret'
export VOS_QA_AGENT_ENDPOINT='http://vos-agent.internal:8787'
export VOS_QA_AGENT_TOKEN='same-as-vos-agent-service-token'
export VOS_PORTAL_PUBLIC_ORIGIN='https://portal.example.edu'
```

`VOS_QA_AGENT_ENDPOINT` 指向单独部署在内部网络的 `vos-agent`，不通过 Caddy 发布。
`VOS_PORTAL_MASTER_KEY` 必须是未填充的 32-byte base64url；轮换前先完成密文
重包封。启动、迁移和 seed 必须显式执行：

```sh
docker compose --profile base --profile runner up -d
docker compose --profile base run --rm migrate
VOS_PORTAL_ALLOW_SEED=1 docker compose --profile base run --rm vos-portal seed
```

检查公开的 `https://portal.example.edu/healthz` 与 `/readyz`；Prometheus 从内部网络
抓取 `http://vos-portal:8787/metrics`（Caddy 对公网返回 404）。依赖不可用时服务
必须失败并留下 trace/audit 记录，不切换静态 Demo 或宿主机执行。

## 隔离与运维

Runner 以非 root 用户运行，只读 rootfs、无 capabilities、`no-new-privileges`、
默认 seccomp、CPU/内存/PID/磁盘/超时上限。它仅在 checkout 阶段访问 Gitea，取得
完整 commit 后断开 checkout 网络，再进入无公网的 runner 网络；运行阶段没有 Gitea、
Portal、MinIO 或模型密钥。

备份恢复使用 ops profile；恢复前停止 Portal/Worker，并要求空目标 bucket 和显式确认：

```sh
VOS_BACKUP_NAME=portal-20260813 docker compose --profile ops run --rm vos-ops backup
VOS_BACKUP_NAME=portal-20260813 \
VOS_RESTORE_CONFIRM=restore:portal-20260813 \
VOS_RESTORE_BUCKET=vos-artifacts-restore \
docker compose --profile ops run --rm vos-ops restore
```

备份会校验数据库中每个存活 verified object 的大小和 SHA-256；恢复后再次校验。生产
故障不得使用 Demo 兜底。
