# Student Spec v2

学生项目只有五类规格文件。它们是实现和验证的共同输入，不能用聊天记录、隐藏配置或临时脚本替代。

```text
spec/design.yaml                    唯一 DesignSpec
spec/modules/<module>.yaml          ModuleSpec
spec/interfaces/<interface>.yaml    跨边界/开发 ABI
spec/goals/<goal>.yaml               可选高级目标
spec/patches/<patch>.yaml            手写语义变化影响
```

## DesignSpec

`design.yaml` 必须包含 `system`（name/language/isa）、`machine`（qemu/hardware）、`kernel`（organization/execution/protection/communication/resource_model）、`hardware_port`（board/boot/console/interrupt）以及 `composition_invariants`。组合不变量最多三个。学生通过 `vos agent design --interactive` 讨论取舍；运行时保存经过校验的提案，随后由 `vos agent design --confirm` 原子写入并单独提交。

DesignSpec 是随课程推进演进的单一事实来源，不是 Lab 1 一次填满的答案。每个课程标签的整棵树只能出现当期及以前的机制、稳定 Spec ID、check ID 和文档术语；实现、测试名或空占位文件同样算未来内容泄露。参考项目通过 `course/lab1-complete` 至 `course/lab10-candidate` 展示这一边界，旧完整源码只保存在 archive 标签中，不是新课程 `main` 的祖先。

## ModuleSpec

每个模块文件使用严格 schema：

```yaml
id: kernel/memory
module: kernel/memory
level: 1 # 1, 2, or 3
purpose: allocate and release pages
owns: [kernel/memory.c, tests/memory]
interface:
  - name: allocate
    pre: [allocator initialized]
    post: [returned page is owned by caller]
    errors: [out_of_memory]
properties: [{ id: aligned, text: returned pages are aligned, check: memory_alignment }]
errors: [out_of_memory]
state: { free_pages: counter }             # L2
preconditions: [allocator initialized]     # L2
postconditions: [ownership transferred]   # L2
invariants: [no page is allocated twice]  # L2
dependencies: []                          # L2
concurrency: { lock: spinlock }            # L3
rely: [scheduler preserves ownership]      # L3
guarantee: [allocation is atomic]         # L3
algorithm_intent: bitmap                   # L3
```

L1 适合先描述目标，缺少 L2/L3 字段只产生警告。`vos spec check` 只确定性地检查 schema、稳定 ID、重复操作、模块依赖、接口引用、`owns` 路径和 `vos.yaml` 测试的 `verifies` 引用；它不调用模型，不运行 fuzz、trace 或 hidden tests。`owns` 必须是仓库相对路径，不能为绝对路径或包含 `..`。

工具链也是一个特殊的 ModuleSpec。它拥有 `vos.yaml`、Makefile/xtask 和相关测试文件，但执行语义只写在 `vos.yaml` 的结构化投影中。

## 跨边界与演进

syscall、IPC、驱动和用户/内核 ABI 才进入 `spec/interfaces/`。跨模块的架构或语义变化写进 `spec/patches/`；VOS 根据 `changes` 推导影响模块和回归范围，学生不需要手工维护另一份矩阵。性能、兼容性和形式化目标放入 `spec/goals/`，不是必填阶段门禁。

历史上的分拆契约、阶段性架构文件、独立测试矩阵和报告模板不属于学生 v2 契约，也不提供兼容层。

## 工具链投影

`vos.yaml` 的命令目标必须能还原为：

```yaml
program: bun
args: [run, test]
cwd: .
env: [RUSTUP_TOOLCHAIN]
timeout: 120000
```

build、QEMU、hardware、public/contract check 目标可以声明产物；每个测试目标必须列出其验证的稳定 Spec ID。知识来源必须带相对路径或 Git URL、revision（可选）和 SHA-256 content hash。实际运行通过 Bun argv API，不把这些字段拼成 shell 字符串。
