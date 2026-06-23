# VeriSpecOSLab Spec 标准总览

## 1. 目标

VeriSpecOSLab 的 Spec 标准服务于以下闭环 — Architecture Design → Module/Operation Spec → Toolchain Binding → Patch → Build/Test/Verify → Evidence/Report → Spec Evolution — 并由此展开四个核心目标：

1. 让学生仓库中的 `spec/` 成为项目设计真相，而不是附属说明文档。
2. 让 Agent 的 patch、测试和解释都能追溯到明确的 Spec 条款。
3. 让课程平台可以从 Spec 派生公开验证、私有验证和评分证据。
4. 让架构、模块、操作、组合、工具链、验证义务处于同一规范体系内。

## 2. 适用范围

本标准覆盖以下本地 Spec 类型：

- Architecture Spec
- Module Spec
- Operation Contract
- Composition Spec
- Goal Validation Contract
- Spec Patch
- Toolchain Spec
- Verification / Evidence Spec
- Reports / Audit Records

本标准不覆盖以下云端私有内容：

- 完整 hidden tests
- mutation plan 细节
- anti-gaming 规则细节
- staff-only grading policy

## 3. 最重要的设计决定

VeriSpecOSLab 不只保留“模块级 Spec”，还正式引入“操作级 Spec”。

原因是：

- 模块级 Spec 适合表达状态空间和接口族。
- 操作级 Spec 适合表达一个函数或一次系统调用的前后置条件、锁规则、失败语义和测试义务。
- LLM 驱动开发真正需要的是操作级上下文，而不是只有高层设计摘要。

因此标准采用三层表达：Architecture（为什么这样设计）→ Module（模块状态、接口、边界、不变量）→ Operation（具体操作依赖什么、修改什么、保证什么、如何验证）。

## 4. 与 specfs / SYSSPEC 方法的关系

本标准借鉴 `specfs` 的三个做法，但不直接照搬其文件系统领域结构：

1. 采用比“模块总说明”更细的操作级规格粒度。
2. 强调 `rely / guarantee / failure semantics / tests` 的结构化表达。
3. 要求规格演化先于代码演化，复杂修改先通过 commit-backed `SpecPatch` 进入验证。

VeriSpecOSLab 在此基础上增加课程与平台场景必需的字段：

- stage 绑定
- public / agent-only 可见性
- grading evidence 映射
- student explainability
- toolchain binding

## 5. 规范形态

推荐规则：

1. 机器消费的 Spec 使用 YAML。
2. 面向阅读的解释、报告和审计日志使用 Markdown。
3. 所有 YAML 都应可被 `vos spec lint`、`vos arch lint` 或后续工具链消费。

## 6. 目录入口

标准推荐的本地仓库结构如下：

```text
spec/
  architecture/
  modules/
  composition/
  goals/
  evolution/
  toolchain/
  verification/
  reports/
```
