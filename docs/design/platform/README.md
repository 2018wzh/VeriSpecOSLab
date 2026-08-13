# Platform and Portal boundary

> This directory describes platform and deployment boundaries around the active student v2 contract. Portal/Demo connected behavior is covered by Compose and xv6-spec acceptance; these documents do not add commands to the offline student surface.

The active student sources are:

- [`../spec/README.md`](../spec/README.md): five Spec families and deterministic checks;
- [`../toolchain/README.md`](../toolchain/README.md): structured argv, Runner, evidence, and submission;
- [`../workflow/README.md`](../workflow/README.md): the student loop;
- [`../agent/README.md`](../agent/README.md): role boundaries and worktree trust limits.

Judge 的 staff-only hidden tests、非固定种子的风险 fuzz、自适应 trace/oracle 和课程硬件自动化仍受各自的连接式门禁约束。学生本地的固定种子 fuzz、有界 trace/oracle 与可读取的 local hidden tests 已进入当前契约；两者不能混写。下列平台文档描述内部适配器和 staff-only 能力，不得把它们当作离线学生命令；Portal 的 connected 结果必须按真实 Compose/Runner 证据记录。
