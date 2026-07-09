# Lab 10: 验证方法论 — 证明你的系统是正确的

> **对应 Book 章节**：[第 10 章：验证方法论](../book/ch10-verification.md)

## 1. 设计问题

你的 OS 已经走过 9 个阶段：它能启动、管理内存、响应中断、运行用户程序、持久化数据、暴露资源接口、展示独特剖面。现在面临最后一个系统性问题：**你怎么证明它是正确的？**

"跑通了"不等于"正确的"。"在我的机器上能跑"也不等于"在所有合法输入下都是正确的"。本 Lab 的核心问题是：

- 你用什么方法建立对系统正确性的信心？
- 哪些性质是"必须始终成立"的？你如何检查它们？
- 验证证据如何组织、存储和追溯？
- 当设计发生变更时，你如何确保验证仍然有效？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 不变量覆盖度 | 每个关键模块有哪些不变量？覆盖了哪些正确性维度（内存安全、并发安全、资源泄漏）？ |
| 检查器触发策略 | 不变量检查器在什么时机触发？每次操作后？定时？手动触发？ |
| 跨组件验证 | 哪些性质跨越模块边界？如何在模块独立验证之外补充组合验证？ |
| 证据组织 | 验证证据（日志、测试输出、不变量检查结果）如何组织和追溯？ |
| 演化追溯 | 设计变更如何关联到验证？SpecPatch 是否附带了验证更新？ |
| 验证密度 | Final Lab 需要多少验证证据才算"足够"？（建议参考 ch10 的五层验证模型） |

## 2a. 设计决策引导

### 决策 1：不变量检查器的深度

| 深度 | 工作量 | 发现 bug 的能力 | 适合 |
|------|:-----:|:------------:|------|
| **关键路径** | 3-5 个检查器 | 捕获最危险的 bug（空指针、双重释放、页泄漏） | 零基础 / 时间紧张 |
| **模块全覆盖** | 每个 ModuleSpec 至少 1 个检查器 | 捕获模块内部的所有不变量违反 | 推荐 |
| **跨组件全覆盖** | 模块覆盖 + 2-3 个跨组件不变量 | 捕获模块交互中的微妙 bug | 追求深度 |

**推荐**：从"模块全覆盖"出发。为每个 ModuleSpec 写至少 1 个不变量检查器。这些检查器在你开发阶段 2-9 时可能已经写了，现在只是系统化地组织它们。

### 决策 2：检查器触发时机

**选项 A：操作后检查。** 每次关键操作完成后触发。如每次 `kalloc()` 后检查 freelist 无重复。优点：bug 当场暴露。缺点：运行时开销。

**选项 B：定时检查。** 每个时钟 tick 或每 N 个 tick 检查一次。优点：开销可控。缺点：bug 可能在检查间隙产生和消失。

**选项 C：手动触发。** 通过特殊的 syscall 或调试命令触发全系统不变量检查。优点：零正常路径开销。缺点：只在触发时检测。

**推荐**：阶段 2-9 开发期间用 A（操作后检查），立即捕获 bug。Final Lab 提交时保留 A 或切换到较低频率的 B。

### 决策 3：证据包的结构

Final Lab 的验证证据不应是一堆散乱的日志文件。建议按此结构组织：

```
evidence/
├── per-stage/           # 各阶段验证证据
│   ├── stage-02/        # 启动验证
│   ├── stage-03/        # 内存验证
│   └── ...
├── cross-cutting/       # 跨阶段验证
│   ├── invariant-report.md
│   └── composition-check.md
├── evolution/           # 演化记录
│   ├── spec-patches/
│   └── failure-analyses/
└── final/               # 最终验收
    ├── verify-public.log
    ├── verify-full.log
    └── final-report.md
```

## 3. 背景阅读

- [Book 第 10 章](../book/ch10-verification.md) — 验证方法论：五层验证模型、不变量设计原则、证据管理
- [Book 第 1 章](../book/ch01-overview-design.md) §1.6 — 和传统 OS 实验最大的不同
- [Spec: GoalValidationContract](../specs/goal-validation-contract.md) — 验证契约的编写指南
- [Spec: ArchitectureCompositionSpec](../specs/architecture-composition-spec.md) — 跨组件不变量
- [附录：不变量检查器编写指南](../appendices/invariant-checker.md)
- [附录：最终报告模板](../appendices/final-report-template.md)

## 4. 规格要求

### 4.1 不变量清单（必做）

整理一份完整的不变量清单，记录每个模块的所有不变量：

```yaml
# spec/verification/invariants.yaml
invariants:
  - id: "MEM-001"
    module: "memory"
    description: "freelist 中无重复页"
    check_trigger: "每次 kalloc/kfree 后"
    status: "verified"
  - id: "MEM-002"
    module: "memory"
    description: "分配的页不在保留区域"
    check_trigger: "每次 kalloc 后"
    status: "verified"
  # ... 为每个模块至少列 1 条
```

### 4.2 跨组件不变量（必做，至少 1 条）

```yaml
# spec/architecture/composition.yaml 中补充
cross_cutting_invariants:
  - id: "CROSS-001"
    description: "进程 A 不可访问进程 B 的用户内存页"
    involved_modules: ["memory", "process"]
    verification: "遍历所有进程的页表，确认无重叠映射"
```

### 4.3 验证证据包（必做）

按 §2a 决策 3 的结构组织验证证据。

### 4.4 失败分析（必做，至少 1 条）

记录一个"曾经失败、通过验证发现、最终修复"的案例：

```yaml
# spec/evolution/failure-001.yaml
failure:
  symptom: "描述现象"
  root_cause: "描述根因"
  invariant_violated: "引用 invariants.yaml 中的 ID"
  fix: "描述修复"
  verification_after_fix: "描述修复后验证通过"
```

## 5. 质量门禁

### 5.1 不变量覆盖门禁
- [ ] 每个核心模块（≥ 5 个）至少有 1 个不变量检查器
- [ ] 至少 1 条跨组件不变量已定义且可运行
- [ ] `vos verify public` 全部通过

### 5.2 验证密度门禁
- [ ] 不变量检查器总数 ≥ 5
- [ ] 跨组件不变量 ≥ 1
- [ ] 失败分析案例 ≥ 1
- [ ] 所有 spec 文件通过 `vos spec lint`

### 5.3 证据门禁
- [ ] 验证证据按 §2a 决策 3 的结构组织
- [ ] 每个不变量至少有一份通过的运行日志
- [ ] 至少一份 SpecPatch 记录了设计演化

## 6. Seed 更新

在 `spec/architecture/seed.yaml` 的验证相关字段中记录本阶段的验证策略：

```yaml
verification:
  invariant_count: <N>
  cross_cutting_count: <N>
  failure_analyses_count: <N>
  verification_density: "模块全覆盖"  # 或 "关键路径" / "跨组件全覆盖"
```

## 7. 设计理据要求

在 ADR 中记录至少一条关于**验证策略**的决策：

- 为什么选择了这个不变量覆盖度？不是越高越好，需要在开销和收益之间做权衡。
- 为什么某些不变量选择定期检查而非每次操作后检查？
- 如果有一个不变量太难检查（如"整个系统无死锁"），你选择了什么替代方案？

## 8. AI 使用边界

| 允许 | 不允许 |
|------|--------|
| AI 辅助编写不变量检查器的代码框架 | AI 替你决定哪些性质应该被检查 |
| AI 审查你的不变量清单是否覆盖了常见漏洞类别 | AI 替你写 failure analysis 中的"根因分析" |
| AI 辅助组织验证证据的结构 | AI 替你判断"验证是否充分" |

## 9. 提交物

- `spec/verification/invariants.yaml` — 不变量清单
- `spec/architecture/composition.yaml` — 更新跨组件不变量
- `evidence/` — 按结构组织的验证证据包
- `spec/evolution/` — 至少 1 条失败分析
- ADR：验证策略决策
- 不变量检查器的源代码（分布在各模块中）

## 10. 常见错误与排查

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| 不变量检查器本身导致 panic | 检查器代码有 bug | 先在不变量检查器内部加日志，确认检查逻辑正确 |
| 不变量只在某些运行中失败 | 竞态条件 / 未初始化的状态 | 在多核场景中加锁保护检查器；确认检查器只读不写 |
| 跨组件不变量无法检查 | 检查器需要访问两个模块的内部状态 | 通过模块的公开接口暴露必要的只读查询 |
| "没有失败分析可写" | 一直在改 bug 从不记录 | 从现在开始，下一个修复的 bug 就记录下来 |
| 验证证据太多太乱 | 缺乏组织 | 按 §2a 决策 3 的结构重新组织，必要时删除过时的日志 |
| 不变量检查拖慢系统 | 检查频率太高或检查范围太大 | 降级到定时检查（如每 10 个 tick），或只检查关键路径 |

---

> **提示**：本 Lab 不是在阶段 9 完成后才开始做的。不变量检查器应该伴随阶段 2-9 的开发逐步编写，每完成一个模块就写它的不变量检查器。本 Lab 的作用是**系统化**和**收尾**：把分散的检查器整理成清单，补充跨组件验证，组织证据，准备 Final Lab。
