# Spec-first 工作流详解

## 什么是 Spec-first

Spec-first 是一种开发顺序约束：**在写任何实现代码之前，先写出描述该实现应该做什么的规格**。这不是教你"先写文档"，而是教你"先想清楚设计，再动手写代码"。

## 完整流程

```text
1. 读设计空间
   理解这个阶段要解决什么问题、有哪些设计维度需要考虑
        ↓
2. 写架构规格
   编写 ArchitectureSlice：你引入了什么机制？为什么？依赖什么？
   编写 ADR：关键设计决策的记录和理由
        ↓
3. 写模块规格
   编写 ModuleSpec：模块的状态、接口、不变量
   编写 OperationContract：每个操作的前置条件、后置条件、失败语义
        ↓
4. 规格审查
   vos spec lint          ← 检查格式和完整性
   vos spec check-consistency  ← 检查模块引用一致性
   人工审查               ← 你的设计是否合理？
        ↓
5. 实现（两条路径）
   路径 A（Agent 生成）：vos agent generate --apply  ← 从 Spec 生成代码
   路径 B（手写）：      按 Spec 编写代码
   vos build              ← 构建
        ↓
6. 验证
   vos run qemu                 ← 运行
   vos verify public            ← 运行基础验证
   vos verify full --target goal ← 运行个性化目标验证（如适用）
        ↓
7. 报告
   vos report generate ← 生成验证报告
   更新 AI 协作日志
```

## 什么时候需要写规格

### 每个阶段必须写的

- **ArchitectureSlice**：每个阶段一个，描述本阶段引入的机制
- **ModuleSpec**：每个新增或修改的模块
- **OperationContract**：每个新增或修改的关键操作

### 按需写的

- **ADR**：当一个决策有多个可选方案、有重要 tradeoff、或后续可能被质疑时
- **ConcurrencySpec**：当模块涉及锁、原子操作、中断交互时
- **CompositionSpec**：当引入跨模块的不变量时
- **GoalValidationContract**：当定义个性化目标时
- **SpecPatch**：当需要修改已有的规格时

## Spec Lint 检查什么

`vos spec lint` 检查：

1. **格式完整性**：YAML 语法正确？所有必填字段存在？
2. **引用一致性**：引用的模块是否存在？引用的操作是否定义？
3. **ID 唯一性**：所有 Spec 文件的 ID 是否唯一？
4. **阶段绑定**：ModuleSpec 的 stage 字段是否与 ArchitectureSlice 一致？

## 常见错误

### 反模式 1：先写代码再补规格

```text
❌ 错：花 3 天写代码 → 代码能跑 → 花 30 分钟补规格
✅ 对：花 1 天写规格 → 花 2 天写代码 → 验证规格与代码一致
```

### 反模式 2：规格只有高层愿景

```text
❌ 错："内存管理模块支持分配和释放物理页"
✅ 对：ModuleSpec 包含 owned_state（freelist 结构）、module_invariants（无重复、无泄漏）、
       OperationContract 包含 kalloc 的前置条件（freelist 非空？）、后置条件（返回的页已清零？）、
       失败语义（freelist 空时返回 NULL）
```

### 反模式 3：规格和代码脱节

```text
❌ 错：规格写了"返回 NULL 表示失败"，代码返回了 0（因为 NULL = 0）
      —— 这是巧合正确，但语义不清晰。
✅ 对：规格写"返回指向已清零物理页的指针，无可用页时返回空指针"，
      代码写 return (void *)pa; 或 return 0;
```

## 与 AI 协作的关系

Spec-first 工作流让 AI 在受控边界内工作：

- AI 可以帮助你**审查**已写好的规格（"这个不变量是否充分？"）
- AI 可以帮助你**补全**规格草稿（"根据这些状态字段，还有哪些不变量需要定义？"）
- AI **不能**在你没有写规格的情况下直接生成核心模块实现
- AI **不能**跳过规格擅自修改代码

## 实践案例

### Lab 2：首个 Spec-Only Lab

[Lab 2: 最小内核启动](../labs/lab2-boot.md) 是 VeriSpecOSLab 中第一个完全 spec-only 的实验。在 Lab 2 中，你：

1. **不写实现代码**——不写汇编入口、不写 C 内核主函数、不写 Makefile
2. **写四类 YAML Spec**：ArchitectureSlice、ModuleSpec、OperationContract、ToolchainSpec
3. **用 Spec 门禁验证设计**：`vos spec lint` → `vos spec check-consistency` → `vos build --dry-run`
4. **在末尾运行代码生成**：`vos agent generate --apply` 从你的 Spec 生成完整可编译的内核

Lab 2 使用的 OperationContract 字段集是**简化版 + 并发**：包含 purpose、depends_on、rely、guarantee、preconditions、postconditions、failure_semantics、concurrency 共 8 个字段组。`security`、`observability`、`emitted_events` 字段在后续 Lab（Lab 4 中断、Lab 5 用户空间）逐步引入。

如果你对某个 Spec 字段的含义有疑问，参考：
- [ModuleSpec 编写指南](module-spec.md)
- [OperationContract 编写指南](operation-contract.md)
- `examples/xv6-spec/spec/` 下的完整参考项目

详见 [AI 使用策略](../appendices/ai-policy.md)。
