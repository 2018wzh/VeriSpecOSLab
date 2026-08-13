# Portal API

Portal Web、CLI 与 Worker 共享本页所述的版本化 contract。旧顶级在线命令不会恢复；公开 CLI 入口均位于 `vos portal`。

Portal Web 与控制面同源，所有当前应用接口位于 `/api/v1`。生产请求使用
`Secure`、`HttpOnly`、`SameSite=Strict` session cookie；mutation 还必须携带
同源 `Origin` 和与 `vos_csrf` cookie 一致的 `X-CSRF-Token`。

## 当前实现的端点

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/revoke
POST /api/v1/auth/device/code
POST /api/v1/auth/device/token
POST /api/v1/auth/device/approve
GET  /api/v1/auth/service-tokens
POST /api/v1/auth/service-tokens
POST /api/v1/auth/service-tokens/{token_id}/revoke
GET  /api/v1/auth/me
GET  /api/v1/auth/oidc/providers
GET  /api/v1/auth/oidc/{provider_id}/start
GET  /api/v1/auth/oidc/{provider_id}/callback
GET  /api/v1/auth/oauth/providers
GET  /api/v1/auth/oauth/{provider_id}/start
GET  /api/v1/auth/oauth/{provider_id}/callback
GET  /api/v1/admin/oidc/providers
POST /api/v1/admin/oidc/providers
GET  /api/v1/admin/oauth/providers
POST /api/v1/admin/oauth/providers
GET  /api/v1/admin/system/status
GET  /api/v1/admin/model-providers
PUT  /api/v1/admin/model-providers
GET  /api/v1/admin/model-quotas
PUT  /api/v1/admin/model-quotas
GET  /api/v1/contexts
GET  /api/v1/dashboard?project_id={project_id}
GET  /api/v1/openapi.json
POST /api/v1/courses/import/dry-run
POST /api/v1/courses/import
GET  /api/v1/courses/{course_id}/versions
POST /api/v1/courses/{course_id}/publish
POST /api/v1/courses/{course_id}/rollback
POST /api/v1/courses/{course_id}/state
POST /api/v1/enrollment/csv
GET  /api/v1/enrollment/invites?course_id={course_id}
POST /api/v1/enrollment/invites
POST /api/v1/enrollment/invites/redeem
POST /api/v1/projects
GET  /api/v1/projects/provisioning/options
GET  /api/v1/projects/{project_id}/provisioning
POST /api/v1/projects/{project_id}/provision/retry
GET  /api/v1/projects/{project_id}/binding
GET  /api/v1/projects/{project_id}/vos-policy
GET  /api/v1/projects/{project_id}/objects/manifest
POST /api/v1/projects/{project_id}/objects/uploads
POST /api/v1/objects/{object_id}/complete
POST /api/v1/objects/{object_id}/download
POST /api/v1/pipelines
GET  /api/v1/pipelines/{run_id}
GET  /api/v1/pipelines/{run_id}/events
POST /api/v1/pipelines/{run_id}/cancel
GET  /api/v1/pipelines/{run_id}/evidence
GET  /api/v1/pipelines/{run_id}/reproduction
POST /api/v1/reviews
POST /api/v1/grades/calculate
POST /api/v1/grades/adjust
POST /api/v1/grades/transition
GET  /api/v1/appeals?project_id={project_id}
POST /api/v1/appeals
POST /api/v1/appeals/{appeal_id}/transition
POST /api/v1/ai/qa
GET  /api/v1/ai/qa/{thread_id}
GET  /api/v1/ai/audits
GET  /api/v1/ai/credentials
POST /api/v1/ai/credentials
POST /api/v1/ai/credentials/{credential_id}/revoke
POST /api/v1/internal/gitea/webhook
GET  /healthz
```

对象上传端点登记预期 checksum、大小、MIME、visibility 和 lineage，并返回最多
15 分钟有效的 SigV4 PUT URL。上传完成后必须调用 `complete`；服务端通过 MinIO
HEAD 校验元数据，未验证对象不会出现在 manifest 或 evidence。`download` 重新执行
归属和 visibility 检查后返回短期 GET URL。三个 POST 均要求幂等键；webhook 使用
Gitea HMAC 签名和 delivery ID 去重，不接受 Portal session。

项目创建只接受已发布实验版本、活跃课程、有效成员和私有 Gitea 仓库请求。API 在
同一事务中创建 `provisioning` 项目、仓库供应记录、成员关系、审计记录和 outbox
事件；worker 幂等创建模板仓库、成员权限与 push webhook 后才激活项目。连续五次
失败后任务停止自动调度，教师必须填写理由并使用重试端点重新入队。学生只能看到
脱敏失败信息，原始 provider 错误仅对课程团队可见。

课程清单先经过 strict Zod dry-run，再写入不可变草稿版本。发布会物化新的 experiment、
StageGate、rubric 和 AI policy 快照；回滚不会重写历史，而是在同一事务中复制历史内容
并发布一个带 `rollback_of` 的新版本。CSV 名单使用 RFC 兼容解析器，支持 quoted field、
BOM、分组和最多 10000 行；存在任一行错误时 apply 不会产生部分写入。项目候选成员和
服务端创建校验都只接受所选实验课程内的活跃学生。教师还可通过
`/courses/{course_id}/groups` 创建和调整小组；repository 强制课程归属、活跃学生、
同课程唯一小组成员关系、乐观 revision、幂等键与审计理由，助教仅可读取。静态 Demo
执行相同 contract 和角色投影，并以版本化 localStorage schema 持久化调整。

`GET /contexts` 只返回 actor 可访问的课程/项目组合；dashboard 的可选 `project_id`
会在 repository 层重新执行项目成员或活跃课程团队校验。Web shell 显式选择上下文，问答提交
同时携带选中的 project，不能静默回落到数据库中的第一个项目。

教师可创建仅限 `student` 或 `ta` 的课程邀请码，并限制 5 分钟至 180 天有效期及 1–500
次使用次数。明文 code 由主密钥和幂等键确定性派生，只在创建响应返回；数据库、审计和
幂等响应只保存 SHA-256 摘要或非敏感 summary。兑换在课程与邀请码行锁内校验课程状态、
过期、撤销、次数和账户全局角色，原子写入成员关系、兑换事实、计数与审计；同一用户重复
兑换不会重复消耗次数。

登录使用 Argon2id 密码摘要。服务端从 session 解析 actor，在 repository 查询
和证据序列化时执行资源归属与 visibility 投影；学生成绩视图只包含本人的个人调整。
审核动作写入 `pipeline_reviews` 与追加式 `pipeline_review_events`；补跑会创建带 `retry_of`
的新 run，不覆盖失败证据。评分和申诉每次转换均创建新快照。上述 mutation 使用 actor、
幂等键按 HTTP method 与 API path 做服务端命名空间隔离，请求摘要在同一事务内去重；每条
审计记录由数据库触发器在同一事务生成 `audit.recorded` outbox。请求失败返回带 `trace_id` 的错误
envelope。

OIDC 使用 `openid-client` 执行 discovery、Authorization Code + PKCE、issuer/audience
和 ID Token 校验。state 只以 SHA-256 保存并通过单条条件更新一次性消费；PKCE verifier
与 nonce 使用 AES-256-GCM 包封并绑定 provider AAD。管理员提交的 client secret 同样只
保存密文且 API 永不回显；外部角色只能映射为 teacher、ta 或 student，不能授予 admin。

OAuth 2.0 使用独立的 `/auth/oauth` 与 `/admin/oauth` 命名空间。管理员显式登记 HTTPS
authorization/token/UserInfo endpoint；Portal 使用 `openid-client` 的 Authorization Code
grant 与 PKCE，但不要求 ID Token，随后只在服务端以短生命周期 access token 请求 UserInfo。
UserInfo 的 configured subject claim 绑定 `(issuer, subject)` 账户；access token 不进入
cookie、数据库、日志或审计 payload。OAuth 同样使用一次性 state、同源最终 Web session
和不可授予 admin 的课程角色映射。

管理员可签发最长 24 小时的自动化 service token。scope 只允许 `project:read`、
`pipeline:write` 和 `evidence:read`，未显式映射的 API 一律拒绝。创建幂等重放会从服务端
主密钥重新派生同一 token；PostgreSQL 的 session 和 idempotency 表均不保存 token 明文。

课程问答先选择满足已发布 `allowed_models` 的启用 Provider，并在同一事务内写入 user
message、按课程/成员月度额度创建 usage reservation 与 `qa.agent.requested` outbox。worker
重新校验 reservation、policy 和 Provider 后，将短生命周期加密 Provider envelope 交给受
service token 保护的 `vos-agent` `knowledgebase_qa` profile；WebSearch/WebFetch 被显式禁用。
assistant message、引用、实际 Token/费用结算、Agent 审计与 outbox 完成标记在同一事务提交；
终止失败会释放 reservation。Provider 凭据只写不回显，Demo 不保存任何真实凭据。
`GET /ai/qa/{thread_id}/events` 使用浏览器原生 EventSource 推送完整 typed transcript，连接中断
由 EventSource 自动重连；静态 Demo 通过本地 adapter 回放同一契约且不建立网络连接。

设计提交使用 `/projects/{project_id}/design-submissions` 创建和读取不可变修订，提交 commit
必须存在于项目 commit ledger 且必须属于项目当前 StageGate。课程团队通过
`/design-submissions/{submission_id}/review` 执行 `submitted → review → passed/frozen` 或
`changes_requested` 转换；内容修订、状态事件、审计原因、反馈与成员通知都保留关联。
`PATCH /notifications/{notification_id}` 只能修改当前 actor 自己通知的已读状态并写入审计。
课程团队通过 `/courses/{course_id}/operations` 读取班级级项目矩阵；单次投影聚合成员、当前
StageGate、最近 run、失败数、设计审核、成绩快照和开放申诉，学生角色无法读取该接口。

BYOK credential 只在已发布课程策略同时允许 `allow_byok` 且 provider 位于
`allowed_models` 时接受。密钥由 Portal 主密钥通过 AES-256-GCM 包封，只写不回显；列表
仅返回 owner、provider、label、末四位和撤销时间。创建和撤销执行 owner 校验、事务幂等与
审计，静态 Demo 对保存和撤销操作直接拒绝。pipeline 可引用 owner 的有效凭据；只有持有
有效 PostgreSQL pipeline 租约的 worker 能创建 60–900 秒解封租约。明文密钥不进入容器环境、
命令参数或审计 payload；worker 使用 runner 随机访问令牌派生的一次性 AES-GCM key，将密文
envelope 经受限 Docker exec 投影到 tmpfs 并在容器内解密。运行结束、凭据撤销、租约过期或
过期 worker 恢复都会删除临时文件并撤销租约。

## Runner API 边界

worker 只调用短生命周期容器内专用 runner HTTP 服务的 typed API：

```http
POST /api/v1/verify/runs
GET  /api/v1/runs/{run_id}
POST /api/v1/runs/{run_id}/cancel
```

worker 使用内部 control API 获取 PostgreSQL `FOR UPDATE SKIP LOCKED` 租约，轮询期间以 heartbeat 续租并以
start/evidence/complete contract 回写 Portal run。内部 API 要求 daily-rotated worker bearer、worker ID 一致、lease ownership 及对象/证据计数一致。终态后必须读取 `/manifest` 和白名单 `/artifacts`：manifest 与 Portal 的
project、commit、policy snapshot 绑定，artifact 逐个校验路径、大小和 SHA-256，再由
worker 通过 MinIO 内部客户端上传并通过 API 的 MinIO HEAD 校验后写入 evidence/object lineage。HTTP、超时、manifest
矛盾、checksum 或对象存储错误都会明确标记基础设施失败，不会回退到宿主命令。新 worker
会领取已过期的 `leased/running` 租约，先按受管标签清理残留容器，再将 run 明确标记为
`infra_failure`、撤销模型凭据租约并记录恢复审计；清理失败时保持可重试状态且不伪造终态。

worker 不接受共享的静态 runner endpoint。它为每个完整 commit SHA 创建短生命周期任务
容器：checkout 期间容器只接入 Gitea 网络，随后先断开 checkout 网络，再接入内部 runner
网络并以非 root 身份启动旧 runner HTTP 服务。除 `/health` 外，所有 runner API（包括
OpenAPI、run、manifest 和 artifact）都要求该任务独立的 Bearer token。

校园 issuer 的实际注册和 BYOK runner 解封 connected 复验仍属于部署/产品验收范围；对象保留由 `gc`
命令执行数据库策略查询、MinIO 删除、软删除和审计。状态必须以 `todo.md` 为准，不能从
本页推断所有产品门禁已经完成。
