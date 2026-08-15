# VOS Portal 本地教学闭环验证

这份指南用于教师、助教和开发者在本机启动真实 Portal 控制面，使用浏览器检查课程页面，再用学生 CLI 完成一次可追踪的教学闭环。验证使用 PostgreSQL、MinIO、Gitea、worker 和隔离 Runner；Demo 只适合检查静态界面，不算课程验收。

## 验证边界

- `https://localhost:8443` 是本地 Caddy 入口；Portal、数据库、对象存储和 worker control 不直接暴露。
- `healthz` 只证明进程存活，`readyz` 必须同时显示 PostgreSQL、Gitea、MinIO、policy 和 runner 为 `ready`。
- 普通 `portal run` 只产生 public 基线验证；`portal submit` 才创建权威课程提交。成绩发布、申诉和后继快照仍需要教师操作。
- Lab 9 与 Lab 10 的结果保持 `candidate`，QEMU 或容器通过不能替代 VisionFive 2 四核实测和教师人工复核。
- 本地凭据只用于测试，不能写入课程仓库、截图或日志。

## 启动真实 Compose

在仓库根目录创建仅供本机使用的环境变量。不要把值写入仓库：

```sh
export VOS_PORTAL_DB_PASSWORD='local-portal-db-password'
export VOS_GITEA_DB_PASSWORD='local-gitea-db-password'
export VOS_MINIO_ROOT_USER='vosminio'
export VOS_MINIO_ROOT_PASSWORD='local-minio-password'
export VOS_PORTAL_MASTER_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
export VOS_GITEA_INTERNAL_TOKEN='local-gitea-internal-token'
export VOS_GITEA_SECRET_KEY='local-gitea-secret-key'
export VOS_GITEA_TOKEN='local-gitea-token'
export VOS_GITEA_WEBHOOK_SECRET='local-gitea-webhook-secret'
export VOS_QA_AGENT_ENDPOINT='http://host.docker.internal:8787'
export VOS_QA_AGENT_TOKEN='local-qa-agent-token'
export VOS_PORTAL_PUBLIC_ORIGIN='https://localhost:8443'
```

如果要验证课程问答，另开终端运行 `bun run dev:agent`，并保证 `VOS_AGENT_SERVICE_TOKEN` 与 `VOS_QA_AGENT_TOKEN` 一致。只验证登录、课程页面和现有测评记录时，worker 仍必须配置这两个变量，但不应把模型服务不可用当成成功。

启动、迁移、seed：

```sh
docker compose --profile base --profile runner up -d --build
docker compose --profile base run --rm migrate
VOS_PORTAL_ALLOW_SEED=1 docker compose --profile base run --rm vos-portal seed
```

检查服务：

```sh
curl --fail-with-body --silent --show-error --insecure https://localhost:8443/healthz
curl --fail-with-body --silent --show-error --insecure https://localhost:8443/readyz
curl --fail-with-body --silent --show-error --insecure https://localhost:8443/api/v1/auth/oauth/providers
```

浏览器应直接访问 `https://localhost:8443`。如果测试浏览器不信任 Caddy 的本地内部 CA，应先把该 CA 加入测试信任存储；不要点击证书警告中的“继续访问”，也不要把临时 HTTP 代理当成生产入口。

seed 提供四个本地测试账号：`student/student`、`ta/ta`、`teacher/teacher`、`admin/admin`。这些账号只用于本地验证，完成后应销毁本地卷或重新 seed。

## 浏览器验收

### 学生

1. 使用 `student` 登录，确认课程标题、Lab 阶段轨、当前阶段主操作、最近测评、反馈和证据入口均可见。
2. 切换中文/英文，再刷新页面，确认语言和当前路由保持一致。
3. 打开通知、课程问答和项目工作区；问答不可用时应显示明确错误，不得显示伪造答案或 Demo 健康状态。
4. 在窄窗口检查阶段轨、主操作和证据链接仍可键盘访问。

### 教师

1. 使用 `teacher` 登录，确认课程生命周期、单行待办队列、过滤器、项目表、阶段分布和近期事件可见。
2. 打开课程控制页，检查清单 dry-run、发布和回滚入口；发布操作需要理由和幂等键。
3. 打开运行详情，确认 public 基线、证据摘要、失败分类和审计关联可见。
4. 冻结并发布成绩后，确认学生只能看到不可变快照；申诉应产生后继快照而不是覆盖原记录。

### TA 与管理员

- `ta` 只能复核、重跑和分流，不能发布课程或授予管理员权限。
- `admin` 可查看 OIDC/OAuth、服务健康、worker、模型、额度、保留策略和审计；OAuth provider 的 secret 保存后不应出现在列表、日志或浏览器响应中。

## 学生 CLI 闭环

浏览器检查通过后，在绑定的学生项目中执行：

```sh
vos portal login https://localhost:8443
vos portal whoami https://localhost:8443
vos portal bind https://localhost:8443 PROJECT_ID
git add .vos/project.yaml .gitignore
git commit -m "[course][portal] Bind project"
vos portal run --stage boot --watch
vos portal status RUN_ID --watch
vos portal evidence RUN_ID --out .vos/downloads/RUN_ID
vos portal submit --stage boot --watch
```

每一步都应保留 run、submission、commit、stage、manifest hash、policy snapshot 和 trace 关联。`bind` 后检查 `.vos/project.yaml` 已被提交；`submit` 前工作树必须 clean，当前 `HEAD` 必须已经进入绑定课程 Gitea 仓库和 commit ledger。任一门禁失败时，CLI 必须直接报错，不能改跑本地验证、上传工作树快照或生成归档。

教师端随后检查：

1. 运行状态从 queued/active 到 terminal，并能通过 SSE 或 `status --watch` 读取。
2. 学生可见证据的大小、摘要和对象校验状态一致；不可见证据不出现在学生响应中。
3. 基线成绩进入待发布状态，教师执行人工复核、冻结和发布。
4. 对 Lab 9/10 只记录 candidate；没有硬件和人工门禁时不得推进为 complete。

## 故障注入与验收记录

至少重复以下场景，并记录 HTTP 状态、稳定错误码、`trace_id` 以及相关 `project_id`/`run_id`：

| 场景 | 预期结果 |
| --- | --- |
| 构建或测试失败 | run 进入失败终态，保留分类和证据，不显示通过 |
| Runner 超时或中断 | run 可取消或超时，临时容器被清理 |
| 对象摘要/大小不一致 | 下载或完成阶段失败，不能静默接受对象 |
| 重复提交 | 幂等键返回同一结果；不同请求复用同键时报错 |
| 越权访问 | 返回稳定拒绝错误，不泄露项目、证据或凭据 |
| 数据库、MinIO、Gitea 或 policy 不可用 | `readyz` 失败，Portal 不切 Demo 或宿主机执行 |

完成记录至少包括：Compose 服务状态、`healthz`/`readyz` 响应、浏览器四角色页面、CLI run/submission ID、教师成绩快照、故障注入结果，以及清理后的 Runner 列表。该记录属于本地 connected 验收，不等同于 Release、硬件或人工门禁证据。

## 停止与清理

```sh
docker compose --profile base --profile runner down
```

需要重新开始空卷验证时，再由操作者明确删除本地卷；不要在共享环境中直接执行带 `-v` 的清理命令。
