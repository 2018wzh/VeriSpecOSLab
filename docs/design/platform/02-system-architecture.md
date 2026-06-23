# 02 System Architecture

回答的问题：

- 平台有哪些核心子系统
- 子系统之间如何同步或异步交互
- 平台的关键调用链和状态流是什么

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [01-boundaries-and-goals.md](./01-boundaries-and-goals.md)

下游消费者：

- `speclab-backend`
- `speclab-portal`
- `speclab-spec-service`
- `speclab-pipeline-orchestrator`
- `speclab-judge-controller`
- `speclab-agent-governance`

## 1. 容器级架构

```text
+--------------------------+
| Portal                   |
| teacher / ta / student   |
+------------+-------------+
             |
             v
+--------------------------+
| Backend API              |
| auth / project / score   |
+--+----------+--------+---+
   |          |        |
   v          v        v
+------+  +--------+ +------------------+
| Spec |  | Repo   | | Agent Governance|
|Svc   |  |Prov    | | policy / audit  |
+--+---+  +---+----+ +---------+--------+
   |          |                |
   v          v                v
+------+  +--------+   +---------------+
| DB   |  | Git    |   | Policy /      |
| S3   |  | Server |   | Audit Store   |
+--+---+  +---+----+   +---------------+
   |          |
   +-----+----+
         |
         v
+--------------------------+
| Pipeline Orchestrator    |
| queue / schedule / retry |
+------------+-------------+
             |
      +------+------+
      |             |
      v             v
+-----------+  +----------------+
| Runner     |  | Judge Ctrl     |
| vos serve  |  | standard score |
| vos / QEMU |  |                |
+-----+------+  +--------+-------+
      |                  |
      v                  v
+-------------------------------+
| Artifact Store + Analytics    |
| logs / traces / reports       |
+-------------------------------+
```

## 2. 子系统职责

### 2.1 Portal

- 提供教师、助教、学生、管理员界面
- 展示项目、阶段、提交、日志、成绩与审计信息
- 不直接承载课程逻辑，只通过 Backend API 访问

### 2.2 Backend API

- 身份、授权、课程、实验、项目、评分和审核入口
- 维护主领域模型状态
- 编排同步调用与异步任务下发

### 2.3 Spec Service

- 存储 `ExperimentSpec`、`StageGate`、`VerificationPolicy`、`EvaluationRubric`
- 生成面向学生、本地 Agent、教师和 Runner 的可见性投影
- 为 Pipeline 和 Judge 派生验证计划输入
- 为 authenticated `vos` 签发或校验 project / stage / policy snapshot

### 2.4 Repo Provisioner

- 创建仓库、模板 fork、注入 `.speclab.yml` 和 CI 配置
- 创建 Agent Workspace 和默认运行绑定
- 回写项目供应状态

### 2.5 Pipeline Orchestrator

- 接收 webhook、手动触发和定时触发任务
- 生成 `PipelinePlan`
- 分发到 Runner 队列，通过 `vos serve` 或 authenticated `vos` 命令聚合结果

### 2.6 Judge Controller

- 管理评分型评测任务
- 从冻结提交构建标准化评测请求
- 产出结构化 `JudgeResult`

### 2.7 Artifact Store

- 保存构建产物、日志、trace、报告、镜像、审计日志、KB source snapshot 和 web reference snapshot
- 为 Portal、Judge、Analytics 提供只读访问
- 为云端 runner replay 提供 object manifest；runner 恢复到 `.vos/kb/` 后再运行 `vos`

### 2.8 Agent Governance

- 不承载 workspace Agent 执行
- 管理 Agent 会话元数据、policy snapshot、risk flags 和 evidence refs
- 接收本地 `vos-agent` / `vos-cli` 上报的审计事件并回填项目事件
- 为本地 Agent 和 `vos` 提供只读投影与权限上限

### 2.9 Analytics

- 汇总阶段进度、失败模式、设计风险和 AI 使用风险
- 不改变主业务状态，只消费事件和证据

## 3. 同步与异步边界

同步调用用于：登录、读取项目、提交设计、发起评审、创建实验、更新课程规则、获取可见性投影。

异步调用用于：仓库创建、Pipeline 执行、Judge 执行、批量 evidence 归档、教学分析聚合。

## 4. 关键调用链

### 4.1 学生加入实验

```text
Portal -> Backend API -> Repo Provisioner
  -> Git Server / Workspace Provider / Spec Service
  -> Backend API updates StudentProject
```

### 4.2 学生 push 代码

```text
Git webhook -> Backend API -> Pipeline Orchestrator
  -> fetch project state and visible rules
  -> Runner checkout commit and bind policy snapshot
  -> Runner starts vos serve or runs authenticated vos
  -> Artifact Store persists outputs
  -> Backend API publishes public summary
```

### 4.3 最终标准评测

```text
Teacher or stage freeze -> Backend API
  -> Judge Controller
  -> isolated runner
  -> authenticated vos / vos serve
  -> JudgeResult + EvidenceBundle
  -> Scorebook update
```

### 4.4 Agent 审计同步

```text
IDE / CLI -> local vos-agent
  -> authenticated vos-cli gate
  -> local tools / patch / verification
  -> upload audit summary and evidence refs
  -> Portal displays governance record
```

### 4.5 学生设计问答

```text
Portal Q&A or CLI -> vos agent ask
  -> knowledgebase.v1 reads vos-kb / public spec / public evidence
  -> optional web search snapshot stored as object ref
  -> answer + citations + audit summary
  -> Portal stores thread and object refs
```

Portal 不直接执行 workspace tools。云端场景由 runner checkout commit、拉取
object manifest、恢复 `.vos/kb/`，再运行 authenticated `vos agent ask`。

## 5. 状态流

平台需要统一管理以下状态流：

- `Experiment`: draft -> published -> archived
- `StudentProject`: provisioning -> active -> frozen -> completed
- `PipelineRun`: queued -> running -> passed/failed/cancelled
- `JudgeSubmission`: queued -> running -> scored/failed/invalidated
- `DesignSubmission`: submitted -> under_review -> approved/rejected/superseded

详细状态机见 [03-domain-model.md](./03-domain-model.md) 和 [05-project-lifecycle-and-repository-provisioning.md](./05-project-lifecycle-and-repository-provisioning.md)。

## 6. 失败模式与约束

- Repo 创建失败必须可重试且不能产生重复项目。
- Pipeline 与 Judge 必须能关联到唯一的冻结输入和证据输出。
- 本地 Agent 或 `vos` 在无法确定项目/身份/阶段时不得回退到 Portal-audited 模式。
- Artifact Store 不承担主状态存储的角色，只保存证据、KB snapshot、web snapshot、runner replay manifest 与只读产物。

## 7. VeriSpecOSLab 特化说明

VeriSpecOSLab 需要在 Runner/Judge 层增加：

- `QEMU` 启动 profile
- 串口日志采集
- 镜像与 boot chain 产物处理
- OS trace 和 panic 分析接口

公共后端与 Portal 不直接内嵌这些细节，也不直接解析 repo 语义；这些能力
由 sandbox runner 中的 `vos-cli` / `vos-agent` 提供，并以结构化 evidence
和 report 回传。

## 8. 后续扩展点

- 多租户课程隔离
- 自定义 Runner Pool
- 外部 GitLab / Gitea / GitHub App 集成
