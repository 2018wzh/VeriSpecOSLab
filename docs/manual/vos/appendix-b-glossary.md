# 附录 B：术语表

| 术语 | 说明 |
| --- | --- |
| DesignSpec | `spec/design.yaml` 中唯一的系统设计目标、ISA、语言、内核和硬件描述 |
| ModuleSpec | 一个模块的目的、owns、接口、性质、错误、状态和并发契约 |
| InterfaceSpec | syscall、IPC、驱动或用户/内核 ABI 等跨边界接口 |
| GoalSpec | 性能、兼容性或形式化验证等可选高级目标 |
| SpecPatch | 架构或跨模块语义变化及其影响 Spec ID 的手写记录 |
| owns | ModuleSpec 声明的仓库相对路径写入边界 |
| stable Spec ID | `id`、`module`、接口和测试 `verifies` 共同使用的稳定引用 |
| Runner | 执行 build、Host/QEMU/Hardware run 并收集 evidence 的薄契约 |
| Evidence | 命令的 manifest、事件、stdout/stderr、产物和 Spec 覆盖记录 |
| clean HEAD | `git status --porcelain --untracked-files=all` 没有项目改动 |
| pending_human_review | 硬件本地结果已记录，但尚未通过人工验收 |
| KB | 由 `vos.yaml` 锁定 revision/hash 的知识来源集合 |
| audit chain | `.vos/audit/chain.jsonl` 中用前一条 hash 串联的本地明文审计事件 |
| linked worktree | Git 的临时 detached worktree，只提供变更回滚，不是安全沙箱 |
| QEMU | 在宿主机模拟目标 ISA 的虚拟机；本链使用非图形串口输出 |
