# Spec v2 总览

学生项目只维护五类 YAML：

```text
spec/design.yaml
spec/modules/<module>.yaml
spec/interfaces/<interface>.yaml
spec/goals/<goal>.yaml
spec/patches/<patch>.yaml
```

这些文件共同描述设计、模块边界、跨边界 ABI、可选高级目标和语义变化。`vos spec check` 会严格解析字段、检查稳定 ID、引用和 `owns` 路径；缺少高等级字段只给出 warning。历史上的分拆文件不再属于学生接口。

## 写作顺序

先用 `vos agent design --interactive` 写清系统目标、语言、ISA、内核组织、QEMU 和 canonical board，审查提案后用 `--confirm` 应用；再为每个可交付模块运行 `vos agent spec <module>`，需要访谈时加 `--interactive`。模块从 L1 开始也可以；准备好状态、前后置条件和不变量后升到 L2，需要并发契约和算法意图时升到 L3。跨模块语义变化由手写 SpecPatch 声明，VOS 自动计算影响范围。

每个接口、性质和测试目标都应能追溯到稳定 Spec ID。工具链作为 `toolchain` ModuleSpec，`vos.yaml` 中的 public/contract target 用 `verifies` 绑定这些 ID。
