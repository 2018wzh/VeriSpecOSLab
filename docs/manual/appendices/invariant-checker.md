# 不变量检查

系统级不变量写在 DesignSpec 的 `composition_invariants`（最多三个）；模块内部不变量写在 ModuleSpec 的 `invariants`。普通测试通过 `properties.check` 或 `vos.yaml` target 的 `verifies` 绑定稳定 Spec ID。
