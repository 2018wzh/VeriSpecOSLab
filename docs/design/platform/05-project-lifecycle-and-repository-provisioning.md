# 05 Project Lifecycle And Repository Provisioning

回答的问题：

- 学生加入实验后平台如何创建项目和仓库
- 项目、仓库、阶段、冻结版本如何流转
- Repo Provisioner 需要哪些接口和状态机

上游依赖文档：

- [03-domain-model.md](./03-domain-model.md)
- [04-experiment-and-spec-management.md](./04-experiment-and-spec-management.md)

下游消费者：

- Repo Provisioner
- Backend API
- Git 集成
- Workspace Provider
- Portal

## 1. 职责与边界

本模块负责：

- 学生项目创建
- 模板仓库 fork / clone / 初始化
- `.speclab.yml` 与基础 CI 注入
- Agent Workspace、Runner、Judge 绑定
- 项目冻结与最终提交绑定

本模块不负责：

- 仓库内部 `spec/` 语义检查
- 单次 Pipeline 的执行细节

## 2. StudentProject 状态机

```text
provisioning
  -> active
  -> stage_locked
  -> frozen
  -> completed
  -> archived
```

规则：

- `provisioning -> active` 仅在仓库、工作区、Runner 和规则快照全部就绪后发生。
- `active -> stage_locked` 当当前阶段未通过门禁但被教师或策略临时冻结时发生。
- `active -> frozen` 当进入最终评测或项目封板时发生。
- `frozen -> completed` 当最终评分发布并结束申诉时发生。

## 3. 仓库供应流程

### 3.1 触发条件

- 学生加入实验
- 教师批量导入学生
- 管理员重建损坏项目

### 3.2 主要步骤

```text
create StudentProject
  -> bind experiment rule snapshot
  -> create repository namespace
  -> fork / clone template repository
  -> inject .speclab.yml and CI glue
  -> configure branch protection
  -> create Agent Workspace
  -> register runner/judge bindings
  -> emit project.provisioned
```

### 3.3 产物

- 仓库 URL
- workspace id
- runner binding id
- judge binding id
- 初始 artifact 清单

## 4. Repo Provisioner 接口

```http
POST /api/projects/{projectId}/repo/init
POST /api/projects/{projectId}/workspace/init
POST /api/projects/{projectId}/bindings/register
GET  /api/projects/{projectId}/provisioning-status
POST /api/projects/{projectId}/freeze
```

异步语义：

- `repo/init` 和 `workspace/init` 为异步任务
- 返回 `operation_id`
- 结果通过轮询或事件查询

幂等性：

- 同一 `project_id` 上重复调用 `repo/init` 应返回已有资源或一致失败

## 5. `.speclab.yml` 注入契约

平台注入内容至少包括：

- 项目标识与实验类型
- target 摘要
- `vos` 基础入口
- public verify 默认套件
- artifact 归档约定

平台不能注入：

- hidden test 明细
- staff-only scoring 配置

## 6. 项目提交与冻结

### 6.1 提交输入

项目提交必须记录：

- `project_id`
- `commit_sha`
- `branch`
- `stage`
- `trigger_actor`

### 6.2 冻结流程

```text
teacher or policy freeze
  -> reject mutable pipeline triggers
  -> snapshot visible rules
  -> snapshot target commit
  -> hand off to Judge
```

完成判据：

- 冻结提交唯一且不可变
- 关联规则快照不可变
- 公开反馈与评分结果可追溯

## 7. 失败模式与约束

- 仓库创建失败后不得残留半绑定项目。
- Workspace 创建失败时项目不得进入 `active`。
- 冻结后不得接受会改变评分输入的普通 push。
- 重建项目时必须保留原有审计记录。

## 8. VeriSpecOSLab 特化说明

VeriSpecOSLab 项目初始化时至少需要：

- `spec/` 骨架
- `ToolchainSpec` 或其引用
- `vos` 入口脚本
- QEMU 基础 profile
- OS 验证 artifact 目录约定

## 9. 后续扩展点

- 共享模板仓库版本管理
- 多仓库项目
- 硬件板卡资源预约绑定
