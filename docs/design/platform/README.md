# Platform and Portal boundary

> Frozen in this phase. This directory describes future platform, Portal, Judge, and deployment work; it is not the student v2 contract. Portal/Demo only retain typecheck, build, and unit-test coverage.

The active student sources are:

- [`../spec/README.md`](../spec/README.md): five Spec families and deterministic checks;
- [`../toolchain/README.md`](../toolchain/README.md): structured argv, Runner, evidence, and submission;
- [`../workflow/README.md`](../workflow/README.md): the student loop;
- [`../agent/README.md`](../agent/README.md): role boundaries and worktree trust limits.

Judge 的 staff-only hidden tests、非固定种子的风险 fuzz、自适应 trace/oracle、课程硬件自动化、Portal 裁撤和 workspace 合并仍属后续平台阶段。学生本地的固定种子 fuzz、有界 trace/oracle 与可读取的 local hidden tests 已进入当前契约；两者不能混写。下列平台文档描述的是冻结的未来设计，不得把其中的内部适配器或 staff-only 能力当作当前学生命令或验收证据。
