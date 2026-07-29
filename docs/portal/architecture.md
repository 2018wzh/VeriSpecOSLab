# Portal Architecture

## 边界

`apps/vos-portal` 包含 client、server、worker、storage、domain 和 demo。Web 与 API 同源部署；worker 是同一应用镜像的独立进程。Portal 不读取学生 checkout、不解析 ToolchainSpec、不直接执行 QEMU，也不在 API 容器中访问容器运行时。

```text
Browser -> Caddy TLS -> Portal Web/API -> PostgreSQL + MinIO + Gitea
                                     -> transactional outbox / SKIP LOCKED queue
                    -> signed object URL -> MinIO
Worker  -> authenticated internal control API -> isolated runner -> authenticated vos serve -> evidence/object report
Worker  -> project outbox -> Gitea template/collaborators/webhook -> project activation
Gitea   -> signed push webhook -> commit ledger + member notifications
Teacher -> manifest dry-run/import -> immutable version -> transactional publish/rollback
Worker  -> course.published outbox -> course-member notifications
Worker  -> qa.agent.requested -> authenticated vos-agent knowledgebase_qa -> answer + audit
Admin   -> encrypted model Provider + course/member monthly quota -> usage ledger
Browser -> OIDC provider -> one-time state/PKCE/nonce -> Portal session
Browser -> role-bound invite redemption -> course membership + audit
Browser -> accessible contexts -> explicitly selected project dashboard/Q&A
```

共享 wire schema 位于 `vos-core/portal-contracts`。Production HTTP transport 与 Demo localStorage repository 实现同一 `PortalRepository`，因此复用路由、组件和领域 contract。

## 失败与安全

- PostgreSQL、policy snapshot、runner HTTP 或 evidence upload 失败均明确终止，不允许本地或 mock fallback。
- student/staff/system visibility 在 repository 查询和序列化层强制执行。
- mutation 使用同源检查、CSRF、RBAC、资源归属、按 endpoint 隔离的幂等键和审计原因；
  `audit_events` 触发器在同一事务创建 outbox，worker 以至少一次语义投递到结构化日志。
- Caddy 是 Compose 唯一 Web 入口；API 容器只 `expose` 到内部网络。Portal 公共来源由 `VOS_PORTAL_PUBLIC_ORIGIN` 固定，不能根据不可信代理头推断。
- 对象先以 `pending` 登记；MinIO HEAD 返回的 SHA-256、metadata、大小与 MIME 全部匹配后才转为 `verified` 并进入 manifest。
- worker 通过 `dockerode` 连接仅在 `runtime-control` 内部网络可见的 Docker Socket Proxy；API 容器没有 Docker API 或 socket 访问路径。每个任务创建一个短生命周期容器，在仅连接 Gitea 的内部 checkout 网络取得完整 commit 后，先断开 checkout 网络，再接入无外网的 runner 网络并启动单项目 `vos serve`。
- pipeline worker 不直接写入 Portal 的 run/evidence 表。它以每日轮换、worker ID 绑定的 bearer credential 调用内部 lease、heartbeat、start、evidence 和 complete contract；控制面在同一数据库事务中强制 lease ownership、对象计数、证据通过门禁、审计与 outbox。对象由 worker 上传后，API 再用 MinIO HEAD 校验 key、SHA-256、大小和 MIME，才接受 evidence report。
- runner 使用非 root UID、只读 rootfs、default seccomp、`no-new-privileges`、全 capability drop、CPU/内存/PID/超时限制和有大小上限的项目 tmpfs。checkout token 只进入短生命周期 Docker exec 环境，仓库 remote 不保存凭据；执行阶段无法访问 Gitea、Portal、MinIO 或公网。
- 每个 `vos serve` 使用独立高熵 Bearer token；非 loopback server 缺少 token 时拒绝启动。worker 只接受配置的 Gitea origin、完整 40/64 位 commit SHA 和配置的 runner image，不存在宿主机命令 fallback。
- 项目供应由 outbox 租约驱动；Gitea 仓库、协作者和 webhook 均使用 provider 查询实现幂等。项目只有在三者成功后才从 `provisioning` 进入 `active`。
- Gitea push 使用原始小写十六进制 HMAC-SHA256 `X-Gitea-Signature` 校验，delivery ID 去重；无效签名、未知仓库、非法 ref 或 commit SHA 均 fail-fast。
- 课程发布和回滚以 manifest snapshot 为边界；rollback 创建新版本并在同一事务中物化实验、StageGate、rubric、AI policy、审计与 outbox，不修改旧快照。
- `course.published` 由 worker 租约消费；失败采用指数退避，五次后停在 `infinity` 并保留结构化错误，不会阻塞其他 outbox topic。
- OIDC discovery、PKCE 和 token 校验复用 `openid-client`；数据库只保存 state hash 和 AES-256-GCM 包封的短期 flow secret。provider secret 使用同一主密钥包封、AAD 绑定、只写不回显，配置变更与审计记录在同一事务提交。
- Q&A 提交在 PostgreSQL 中锁定课程额度，按保守 Token 上限预留请求与费用；课程和可选成员额度均在并发事务下强制执行。worker 只调用带 Bearer service token 的 `vos-agent` typed task API，通过由相同 service token 派生的 AES-GCM 会话 envelope 传递已解封的单次 Provider 配置。课程 allowed_models 与 reservation 在领取后重新校验，公网搜索工具被禁用，成功后结算实际 usage，终止失败释放预留；provider/contract/policy 失败不会生成伪回答。
- runner 终态不是成功证据；worker 还必须取得 versioned manifest，校验 run/project/commit/policy 绑定，并在每个 artifact 通过路径、单对象 50 MiB、总计 250 MiB 与 SHA-256 门禁后写入 MinIO。数据库只保存验证后的 S3 URI、checksum、visibility 和 lineage。
- Demo 由编译期模式生成独立产物，Production bundle 不包含 localStorage adapter。
