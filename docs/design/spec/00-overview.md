# Student Spec v2 Overview

学生 Spec 的目标是让设计、实现边界和公开验证共享同一份可解析输入，而不是维护一套互相重复的架构、操作、测试和报告文件。

## 五类文件

```text
spec/design.yaml
spec/modules/<module>.yaml
spec/interfaces/<interface>.yaml
spec/goals/<goal>.yaml
spec/patches/<patch>.yaml
```

DesignSpec 记录系统方向与硬件目标；ModuleSpec 把模块的接口、性质、错误和并发契约集中起来；InterfaceSpec 只承载跨边界或开发 ABI；GoalSpec 是可选高级目标；SpecPatch 记录架构或跨模块语义变化。

## 确定性消费

`vos spec lint [<target>]` 严格拒绝未知字段、旧 kind、重复稳定 ID、缺失依赖、越界 `owns`、错误接口引用和未知 `verifies` Spec ID。指定目标时仍加载完整项目解析引用，只筛选相关诊断。L1/L2/L3 由学生声明，等级不足只产生 warning。执行不调用模型，也不把 prompt 当校验器。

工具链以 `spec/modules/toolchain.yaml` 的特殊 ModuleSpec 管理；`vos.yaml` 是结构化执行投影，测试 target 通过 `verifies` 绑定稳定 Spec ID。KB source 必须锁定相对路径或 Git URL、revision 和 content hash。
