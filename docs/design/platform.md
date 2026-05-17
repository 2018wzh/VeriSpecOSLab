# SpecLab Platform 设计文档

> 面向 VeriSpecOSLab 与其他 SpecLab 类实验的课程平台实现设计入口。

本文件不再承载完整平台设计真相，而是作为迁移页与兼容索引保留。

## 1. 平台定位

`SpecLab Platform` 用于把：

```text
课程规则
  + 学生设计规格
  + 仓库与工具链
  + 验证与评测
  + Agent 协作与审计
```

组织为可追溯、可验证、可评分、可复盘的实验教学闭环。

平台核心闭环为：

```text
course setup
  -> project provisioning
  -> staged development
  -> verification
  -> scoring
  -> teaching feedback
```

## 2. 新文档集入口

完整平台设计已拆分到 [`platform/`](./platform/README.md)：

1. [platform/README.md](./platform/README.md)
2. [platform/00-overview.md](./platform/00-overview.md)
3. [platform/01-boundaries-and-goals.md](./platform/01-boundaries-and-goals.md)
4. [platform/02-system-architecture.md](./platform/02-system-architecture.md)
5. [platform/03-domain-model.md](./platform/03-domain-model.md)
6. [platform/04-experiment-and-spec-management.md](./platform/04-experiment-and-spec-management.md)
7. [platform/05-project-lifecycle-and-repository-provisioning.md](./platform/05-project-lifecycle-and-repository-provisioning.md)
8. [platform/06-pipeline-and-verification-orchestration.md](./platform/06-pipeline-and-verification-orchestration.md)
9. [platform/07-judge-and-sandbox.md](./platform/07-judge-and-sandbox.md)
10. [platform/08-agent-gateway-and-ai-governance.md](./platform/08-agent-gateway-and-ai-governance.md)
11. [platform/09-roles-workflow-and-stage-gates.md](./platform/09-roles-workflow-and-stage-gates.md)
12. [platform/10-scoring-evidence-and-teaching-analytics.md](./platform/10-scoring-evidence-and-teaching-analytics.md)
13. [platform/11-deployment-security-and-operations.md](./platform/11-deployment-security-and-operations.md)
14. [platform/12-mvp-to-full-platform-roadmap.md](./platform/12-mvp-to-full-platform-roadmap.md)

## 3. 边界链接

相关设计真相分别位于：

- Agent Runtime / DevBox / OpenAI-compatible 接入：[`arch.md`](./arch.md)
- 课程递进式工作流：[`workflow.md`](./workflow.md)
- 学生仓库 `spec/` 标准：[`spec/README.md`](./spec/README.md)
- `vos runtime` 与执行编排：[`toolchain/README.md`](./toolchain/README.md)

## 4. 兼容说明

- 旧的单文档式平台设计已拆分为目录化文档集。
- 之后新增或修改平台设计应优先进入 `docs/design/platform/` 对应主题文档。
- 本文件仅保留平台摘要、阅读入口和跨文档边界说明。
