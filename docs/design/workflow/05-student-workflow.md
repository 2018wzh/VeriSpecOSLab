# Student Workflow v2

学生主链不再按一组互相依赖的架构碎片推进，而是围绕 DesignSpec、ModuleSpec 和可回放 evidence 纵向切片。

## 1. 初始化

在空目录中执行 `vos init`。命令不提问、不生成内核 skeleton，只创建 v2 文件夹、空 DesignSpec、工具链 ModuleSpec、结构化 `vos.yaml`、`.gitignore` 和初始提交。之后 `vos doctor` 给出缺失工具或契约的可操作提示。

## 2. 设计与规格

`vos agent ask` 用于写 Spec 前的概念讨论，不生成文件。学生根据教材的设计问题和无答案字段骨架，亲手填写 DesignSpec 或 ModuleSpec；操作、性质、错误和并发契约集中写在目标 ModuleSpec。随后运行 `vos spec lint <target>` 和 `vos agent review <target> [-i]`，学生按自己的判断修改、再次 lint，并用普通 Git 命令提交。L1/L2/L3 是学生声明的精度等级，等级不足只告警。

跨边界 syscall、IPC、驱动和 ABI 写入 `spec/interfaces/`。改变架构或跨模块语义时，先提交 `spec/patches/<patch>.yaml`；VOS 从 changes 推导影响模块和回归范围。

## 3. 实现与修复

`vos agent implement <module>` 要求 clean HEAD 和已提交 ModuleSpec；跨模块变更还要求已提交且目标模块尚未应用的 SpecPatch。Agent 在 detached linked worktree 中修改代码和测试，运行 build、public、contract、固定种子 fuzz 与有界 trace 门禁，直到全部通过、主动中止或已有 maxIterations 上限命中。实现结果和 test target 提案必须通过结构化工具提交；校验失败时，工具把错误返回同一模型线程，允许 Agent 继续检查、修改和重新提交。VOS 不接受 `failed`、`partial` 或 `blocked` 作为完成结果，也不接受漏掉 ModuleSpec 已声明稳定 target ID 的结果。只有原工作树 HEAD 未漂移、changed paths 全部在 owns 并集内且 evidence 通过时，VOS 才应用 patch 并创建 `[vos][agent] Implement <module>` 提交。这个提交只消费目标模块的跨模块授权；同一 SpecPatch 的其他受影响模块仍可继续实现，已提交模块若再次改变跨模块语义则需要新的手写 SpecPatch。

失败、越界、漂移和迭代上限不会修改原工作树，只保留诊断、diff 和 evidence。`debug`、`verify`、`review` 和 `ask` 永远只读或问答。

## 4. 运行、验证和提交

脏树可以 `vos build` 和开发态 `vos run qemu`/`vos run hardware`，但 evidence 不可提交。`vos verify` 必须在 clean HEAD 上确定性执行 spec lint、build、所有 public、contract、固定种子 fuzz 和有界 trace checks；本地 hidden tests 由 `--hidden` 显式执行。硬件 evidence 仍是 `pending_human_review`。

`vos report` 从 commit、Spec IDs、测试、日志和 evidence 写出 `.vos/report.json`，不调用模型、不提交 Git。`vos submit` 刷新报告、校验 clean HEAD/审计链并创建绑定 commit/spec/config hashes 的归档；导出日志时遮蔽凭据和本机绝对路径。
