# 附录 C：v2 Spec 字段索引

## DesignSpec：`spec/design.yaml`

`system.name`、`system.language`、`system.isa`、`machine.qemu`、`machine.hardware`、`kernel.organization`、`kernel.execution`、`kernel.protection`、`kernel.communication`、`kernel.resource_model`、`required_mechanisms`、`composition_invariants`、`non_goals`、`hardware_port.board`、`hardware_port.boot`、`hardware_port.console`、`hardware_port.interrupt`。

## ModuleSpec：`spec/modules/<module>.yaml`

必填：`id`、`module`、`level`、`purpose`、`owns`。通用字段：`interface`、`properties`、`errors`。L2：`state`、`preconditions`、`postconditions`、`invariants`、`dependencies`。L3：`concurrency`、`rely`、`guarantee`、`algorithm_intent`。

## InterfaceSpec、GoalSpec、SpecPatch

- InterfaceSpec：`id`、`name`、`boundary`（syscall/ipc/driver/abi/other）、可选 `module`、`operations`。
- GoalSpec：`id`、`objective`、可选 `metric`/`oracle`、`correctness`。
- SpecPatch：`id`、`reason`、`changes`、`new_invariants`。

## `vos.yaml`

`version: vos.project.v1`、`build`、`runners.qemu`、`runners.hardware`、`checks.<id>`、`knowledge.sources[]`。命令 target 使用 `program`、`args`、`cwd`、`env`、`timeout`；build/runner 可声明 `artifacts`，check 必须声明 `verifies` 稳定 Spec ID。KB source 使用相对 `path` 或 Git `url`、可选 `revision` 和 64 位 SHA-256。
