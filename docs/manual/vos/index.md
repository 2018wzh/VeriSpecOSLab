# VOS 学生参考

本页是 v2 学生主链的命令和文件入口。Portal 内部文档不属于学生 CLI。

## 命令

- [`01-overview.md`](./01-overview.md)：主链和全局参数
- `vos init`、`vos doctor`、`vos spec check`
- `vos agent design`、`vos agent spec <module>`、`vos agent implement <module>`
- `vos agent debug`、`vos agent verify`、`vos agent ask`、`vos agent review`
- `vos build`、`vos run qemu`、`vos run hardware`、`vos verify`
- `vos report`、`vos submit`

运行命令都从项目根目录读取 `vos.yaml`。该文件只接受结构化 `program`、`args`、`cwd`、环境变量白名单、超时、产物和 Spec ID 绑定；实现通过 Bun argv 子进程 API，不经过 shell。

## Spec

学生只维护 `spec/design.yaml`、`spec/modules/*.yaml`、`spec/interfaces/*.yaml`、可选 `spec/goals/*.yaml` 和手写 `spec/patches/*.yaml`。ModuleSpec 以 L1/L2/L3 表达精度，`owns` 是仓库相对路径硬边界。详细字段见 [`../../design/spec/README.md`](../../design/spec/README.md) 与 [`../specs/module-spec.md`](../specs/module-spec.md)。

## 证据与提交

脏树允许开发态 build/run，但 evidence 不可提交。`verify`、Agent 自动提交、权威硬件 evidence 和 `submit` 要求 clean HEAD。`report` 只写 `.vos/report.json`；`submit` 绑定 commit/spec/config hashes，遮蔽凭据和绝对路径，硬件状态保持 `pending_human_review`。
