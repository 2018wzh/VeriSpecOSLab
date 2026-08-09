# Student Workflow v2

学生主链不再按一组互相依赖的架构碎片推进，而是围绕 DesignSpec、ModuleSpec 和可回放 evidence 纵向切片。

## 1. 初始化

在空目录中执行 `vos init`。命令不提问、不生成内核 skeleton，只创建 v2 文件夹、空 DesignSpec、工具链 ModuleSpec、结构化 `vos.yaml`、`.gitignore` 和初始提交。之后 `vos doctor` 给出缺失工具或契约的可操作提示。

## 2. 设计与规格

`vos agent design --interactive` 先通过访谈明确设计取舍，再展示 `spec/design.yaml` 的结构化差异；`vos agent design --confirm` 只应用这份已保存的提案，不会再次调用模型。`vos agent spec <module> --interactive` 可采用同样流程，操作、性质、错误和并发契约集中写在目标 ModuleSpec。L1/L2/L3 是学生声明的精度等级，等级不足只告警。

跨边界 syscall、IPC、驱动和 ABI 写入 `spec/interfaces/`。改变架构或跨模块语义时，先提交 `spec/patches/<patch>.yaml`；VOS 从 changes 推导影响模块和回归范围。

## 3. 实现与修复

`vos agent implement <module>` 要求 clean HEAD 和已提交 ModuleSpec；跨模块变更还要求已提交 SpecPatch。Agent 在 detached linked worktree 中修改、构建、运行 public/contract checks，直到全部通过、主动中止或已有 maxIterations 上限命中。只有原工作树 HEAD 未漂移、changed paths 全部在 owns 并集内且 evidence 通过时，VOS 才应用 patch 并创建 `[vos][agent] Implement <module>` 提交。

失败、越界、漂移和迭代上限不会修改原工作树，只保留诊断、diff 和 evidence。`debug`、`verify`、`review` 和 `kb` 永远只读或问答。

## 4. 运行、验证和提交

脏树可以 `vos build` 和开发态 `vos run qemu`/`vos run hardware`，但 evidence 不可提交。`vos verify` 必须在 clean HEAD 上确定性执行 spec check、build、所有 public checks 和 contract checks。硬件 evidence 仍是 `pending_human_review`。

`vos report` 从 commit、Spec IDs、测试、日志和 evidence 写出 `.vos/report.json`，不调用模型、不提交 Git。`vos submit` 刷新报告、校验 clean HEAD/审计链并创建绑定 commit/spec/config hashes 的归档；导出日志时遮蔽凭据和本机绝对路径。
