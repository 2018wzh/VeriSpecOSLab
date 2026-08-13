# Portal Data Model

PostgreSQL migration 是持久化模型的唯一真相源，共享 Zod schema 是 HTTP wire contract 的唯一真相源。

主要聚合：

- identity：users、sessions、OIDC identity 与课程角色；
- course：courses、course_manifest_versions、experiments、stage_gates、rubric/AI policy 快照、course_memberships 与 course_groups；
- project：projects、project_members、project_repositories、project_commit_ledger、design_submissions、policy snapshot 与冻结 commit；
- authoritative assessment：assessment_submissions 将 submission、project、stage、commit、Spec/config/manifest hash、policy snapshot、提交人、run 与终态时间绑定；普通 public run 不写入该表；
- evidence：pipeline_runs、evidence_records、object_refs；
- teaching：score_snapshots、member_adjustments、appeals、notifications；
- AI：qa_threads、qa_messages、对象引用与审计事件；
- model control：model_providers、model_quota_policies 与追加式 model_usage_ledger；
- operations：audit_events、outbox_events、idempotency_keys。

所有时间使用 `timestamptz`，金额/分数使用 `numeric`，外键列都有索引。活跃记录使用 partial index，队列通过 `FOR UPDATE SKIP LOCKED` 原子领取，深分页使用 `(created_at, id)` cursor。

`004_project_provisioning.sql` 允许项目在供应期间暂时没有 `repo_url`，并以
`project_repositories` 保存 Gitea 模板、目标仓库、provider ID、尝试次数和最后错误。
outbox 增加显式租约；达到重试上限后使用 PostgreSQL `infinity` 停止自动领取，教师
审计重试会把同一事件恢复为立即可领取。push delivery 和 commit ledger 都有唯一约束，
因此 webhook 重放不会产生重复提交或通知。

`005_course_control.sql` 增加不可变课程清单版本、唯一 draft/published 投影、发布版本
指针、课程成员、单课程单分组约束、rubric 项和 AI policy 快照。CSV apply 在一个事务
内创建 OIDC-ready 无密码账号、课程角色和分组；任何角色冲突或行错误都会回滚全部修改。

`006_oidc.sql` 增加 provider 配置和十分钟有效的授权状态。client secret、PKCE verifier
与 nonce 均以 AES-256-GCM 密文保存；state 仅保存 SHA-256，callback 使用带 expiry 与
`consumed_at is null` 条件的原子更新防止并发回放。provider 配置与审计写入同一事务。

`007_qa_agent.sql` 为问答消息增加请求 actor、请求/回答谱系和处理状态，并增加
`agent_audits`。每个 request message 最多对应一个 assistant message 和一个 Agent 审计，
从而让 worker 重试保持幂等并能追溯 provider session、模型、风险标记和摘要。

`011_runner_credential_leases.sql` 为 pipeline 增加模型凭据引用、worker owner 和有界
租约时间，并以 `model_credential_leases` 保存 run、credential、worker、provider、到期、
消费和撤销事实。唯一 `(run_id, credential_id)` 防止同一 run 并发解封；过期 pipeline
租约使用 partial index 扫描并由恢复 worker fail-closed 回收。

`012_worker_nodes.sql` 保存 worker 启动、最近心跳、当前 run 和非敏感 runtime 元数据。
worker 至多每 20 秒续写一次；管理员状态 API 将超过 30 秒的节点明确投影为 `stale`，并与
pipeline/outbox/provisioning 队列深度一起显示。Demo 返回无生产连接，不伪造健康状态。

`013_design_submissions.sql` 保存绑定项目、StageGate 和 commit ledger 的设计修订，并以
`design_submission_events` 追加记录每次审核转换、理由、反馈、actor 与 trace ID。项目阶段内
revision 和 commit 都有唯一约束；新修订只允许在课程团队明确要求修改后创建。

`014_retention_policy.sql` 保存带乐观 revision 的全局保留策略。管理员更新必须携带审计理由
和幂等键；GC 在每次执行时从 PostgreSQL 读取策略，不使用代码内隐藏默认值。静态 Demo 保存
同一契约的本地修订，但不会执行对象删除。

`015_model_control_plane.sql` 保存学校模型 Provider 的包封密文、模型白名单、价格和输出上限，
并用乐观 revision 与幂等键保护管理员更新。课程与可选成员月度额度通过唯一 scope 记录；
Q&A 提交在同一事务中创建 `reserved` usage，worker 成功后写实际 Token/费用并转为 `settled`，
终止失败转为 `released`。课程锁、额度行锁和 usage ledger 聚合共同防止并发超额。

`016_service_tokens.sql` 为短期自动化 token 增加只读标签和创建者元数据。原始 token
由服务端主密钥、actor 和幂等键确定性派生，只在创建响应中返回；数据库仅保存 SHA-256
摘要，幂等响应也不保存明文。scope 仅允许项目读取、pipeline 触发和证据读取，最长有效期
24 小时，并可由创建它的管理员立即撤销。

`017_enrollment_invites.sql` 增加 hash-only 课程邀请码与唯一 `(invite_id,user_id)` 兑换事实。
邀请码绑定课程角色、到期时间、最大使用次数、创建者和撤销状态；兑换事务锁定邀请码，避免
并发超额，并以唯一兑换事实保证同一成员重放不重复计数。明文 code 不进入数据库。

`018_audit_transactional_outbox.sql` 在 `audit_events` 上安装事务触发器。每条审计事实都会在
同一事务产生唯一 `audit.recorded` outbox 事件；worker 以租约领取并写结构化日志，确认后才
标记 published，进程中断时允许至少一次重放。这样同步 mutation 不需要各自复制 outbox
样板，也不会出现审计已提交而观测事件缺失的窗口。

`019_device_flow_idempotency.sql` 为 device authorization 增加唯一 request-key 摘要和请求
摘要。device code、user code、CLI access token 均由服务端主密钥和幂等身份确定性派生，
数据库只保存摘要；授权创建与 token exchange 可安全重放，且不会产生多个 CLI session。
本地密码登录采用同样的 hash-only 确定性 session 方式，幂等响应不保存 token 或 CSRF 明文。

删除课程 30 天后可清理普通问答、原始日志与大对象；成绩、申诉、发布快照和安全审计保留一年后才能进入管理员清理队列。
