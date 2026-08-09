# VeriSpecOSLab v2 方案提纲

本提纲只描述当前学生主链；Portal、Judge、隐藏测试和课程硬件自动评分属于后续平台阶段。

## 学生链路

```text
空目录 → init → ask → 手写 DesignSpec/ModuleSpec/InterfaceSpec
        → spec lint → agent review → 手动提交 → Agent implement
        → build → public/contract/fuzz/trace verify
        → QEMU/Hardware → report → submit
```

## 五类 Spec

1. `spec/design.yaml`：目标、ISA、语言、内核组织、QEMU、canonical board、硬件移植和最多三个组合不变量。
2. `spec/modules/*.yaml`：严格 ModuleSpec。操作、接口、properties、errors、owns 和按 L1/L2/L3 分级的状态/并发契约集中在一个文件。
3. `spec/interfaces/*.yaml`：syscall、IPC、驱动和用户/内核 ABI。
4. `spec/goals/*.yaml`：可选高级目标。
5. `spec/patches/*.yaml`：跨模块或架构语义变化及影响范围。

工具链是特殊 ModuleSpec，`vos.yaml` 只投影结构化 argv、runner、产物、验证的 Spec ID 和锁定的 KB source。

## Agent 与证据

Agent Runtime 按 `implement/debug/verify/ask/review` 路由。学生先用 `ask` 讨论概念和取舍，再手写规格并运行确定性 lint；`review` 只给建议，不改项目。实现只在 detached linked worktree 中运行，检查 clean HEAD、owns、SpecPatch、build 和 public/contract/fuzz/trace evidence 后才原子应用并提交。worktree 是 Git 回滚边界，不是宿主安全沙箱。

所有会话、工具调用、diff 和结果写入 gitignored `.vos/audit` 连续哈希链。`verify` 不调用模型；`report` 和 `submit` 确定性绑定 commits、Spec IDs、测试、日志、evidence、commit/spec/config hashes。硬件状态保持 `pending_human_review`，导出日志遮蔽凭据并替换绝对路径。

## 公开命令

```text
vos init / doctor / spec lint [target]
vos agent implement <module>
vos agent debug / verify / ask / review [target]
vos build / run qemu / run hardware / verify / report / submit
```
