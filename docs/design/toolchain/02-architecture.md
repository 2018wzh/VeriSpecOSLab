# 02 Architecture

回答的问题：

- `VOS Runtime` 的总体层次结构是什么
- 一次 `vos` 命令从输入到证据输出经历哪些层
- 架构中哪些部分与 TypeScript package 边界一一对应

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [01-boundaries-and-roles.md](./01-boundaries-and-roles.md)

下游消费者：

- `vos-core`
- `vos-runtime`
- `vos-adapter`
- `vos-evidence`
- `vos-agent`

## 1. 总体结构

```text
IDE / Web / CLI Agent
        |
        v
Agent Identity Gateway
        |
        v
Cloud Spec Service
        |
        v
vos CLI
        |
        v
VOS Runtime
```

`VOS Runtime` 内部分为 5 层。

## 2. 五层模型

### 2.1 Spec Layer

输入：

- 本地 `spec/`
- `spec/toolchain/`
- 云端公开约束投影缓存

输出：

- `NormalizedSpecBundle`
- lint diagnostics
- schema / semantic errors

职责：

- YAML 解析
- schema 校验
- 规范化
- 本地 spec 索引

### 2.2 Planning Layer

输入：

- `NormalizedSpecBundle`
- 当前命令参数
- `SpecPatch`
- stage 与 policy 信息

输出：

- `PatchImpactReport`
- `ExecutionPlan`
- test matrix

职责：

- arch compose
- consistency 检查
- patch DAG 检查
- 影响分析
- 派生公开验证计划

### 2.3 Execution Layer

输入：

- `ExecutionPlan`
- adapter 配置
- `ToolchainSpec`

输出：

- 子进程结果
- stdout/stderr 流
- artifact 路径
- `RunEvent`

职责：

- build / qemu / test / trace / debug 调度
- 超时、取消、互斥和并发控制
- 将底层命令统一为结构化结果

### 2.4 Evidence Layer

输入：

- `RunEvent`
- 命令结果
- 日志与 artifact

输出：

- `RunManifest`
- `events.jsonl`
- evidence 索引
- report 输入数据

职责：

- 归档日志
- 维护 `.vos/runs/<run-id>/`
- 按命令种类组织产物
- 为调试和报告提供稳定索引

### 2.5 Agent Gateway Layer

输入：

- `AgentSession`
- `DiagnosticReport`
- patch 文件
- policy

输出：

- changed targets
- patch 应用 verdict
- 本地 OpenAI-compatible 响应

职责：

- 解析 AgentIdentity 与 CapabilityPack
- 构造受控上下文和 policy snapshot
- 拦截越权行为

## 3. 主数据流

一次典型运行遵循以下流程：

```text
spec/
  -> normalize
  -> impact plan
  -> execution DAG
  -> evidence bundle
  -> diagnostics
  -> agent / student / CI response
```

## 4. 设计原则

- spec-first：核心改动必须先有本地 spec
- validation-first：关键 patch 必须触发最低验证集
- machine-readable first：所有命令优先返回稳定 JSON
- audit-always：每次执行都生成 manifest 与证据索引

## 相关文档

- [03-runtime-modules.md](./03-runtime-modules.md)
- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
