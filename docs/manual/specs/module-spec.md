# ModuleSpec

ModuleSpec 把一个模块的目的、所有权、接口和验证性质放在同一文件。最小的 L1 文件如下：

```yaml
id: kernel/memory
module: kernel/memory
level: 1
purpose: manage physical pages
owns:
  - kernel/memory.c
  - tests/memory
interface:
  - name: allocate
    pre: [initialized]
    post: [page owned by caller]
    errors: [out_of_memory]
properties:
  - id: aligned
    text: returned pages are aligned
errors: [out_of_memory]
```

L2 增加 `state`、`preconditions`、`postconditions`、`invariants` 和 `dependencies`；L3 增加 `concurrency`、`rely`、`guarantee` 和 `algorithm_intent`。`interface` 中的操作可以声明 input/output、pre/post、errors 和 properties。

`owns` 是 Agent 的硬边界：必须覆盖模块实现和模块测试，只能写仓库相对路径，不能使用绝对路径、`..` 或把 Spec、`.git`、`.vos` 运行目录纳入实现所有权。跨模块实现必须把已提交且目标模块尚未应用的 SpecPatch 影响模块 owns 合并后再检查；每个受影响模块各消费一次授权，不会因另一个模块先提交而失去自己的实现机会。property 文本或 `check` 字段中声明的稳定 target ID 必须由结构化结果完整绑定。`vos spec lint` 只做确定性校验；`vos agent review` 可以提出等级和契约建议，但不会替学生修改 Spec 或做架构决策。
