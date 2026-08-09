# 附录 D：xv6 参考项目

`examples/xv6-spec` 是完整的 xv6 风格 RISC-V 源码参考子模块，也是当前学生 v2 主链的可运行样例。源码仍用于理解启动、内存、陷阱、进程、syscall、文件系统、IPC 和设备驱动；规格层已合并为 DesignSpec、ModuleSpec、InterfaceSpec、GoalSpec 和 SpecPatch，不再保留旧碎片模型或兼容路径。

子模块 `main` 从新的 orphan root 按 Lab 1–10 重建，共 28 个非空语义提交。`course/lab1-complete` 至 `course/lab8-complete` 是已通过累计验收的边界；`course/lab9-candidate` 与 `course/lab10-candidate` 只表示自动化候选验证通过。它们尚未取得 VisionFive 2 实板四核完整 `usertests` 和人工复核，不得写成硬件验收完成。重建前源码可由 `archive/pre-course-history-v3-20260809` 恢复，但不属于课程入口。

新项目不要复制旧的架构碎片。先运行 `vos init`，再用 `vos agent design` 将你选择的语言、ISA、QEMU 和板卡写进 `spec/design.yaml`，随后按纵向模块建立 `spec/modules/*.yaml`。如果参考 xv6 的某个接口跨越用户/内核边界，则把它重新表达为 `spec/interfaces/*.yaml`；架构或跨模块语义变化写入 `spec/patches/*.yaml`。

从仓库根目录可以按样例主链运行：

```sh
vos --project-root examples/xv6-spec spec check
vos --project-root examples/xv6-spec build
vos --project-root examples/xv6-spec run qemu
vos --project-root examples/xv6-spec verify
```

历史维护者还应在子模块中运行 `python3 tools/course_history_audit.py`，逐标签核对允许路径、Spec/check ID、术语和未来标识。Lab 8 的行为 oracle 是完整 QEMU `usertests`，必须同时看到 `test badwrite: OK` 和 `ALL TESTS PASSED`。

真实验收需要本地 RISC-V 工具链、Bash、Make 和 QEMU。学生提交只应包含自己的 clean HEAD、Spec、测试、确定性报告和经过遮蔽的日志，不应把本机绝对路径、凭据或完整参考资料复制进 Git。参考源码可被本机学生读取，这是策略约束而不是安全边界。
