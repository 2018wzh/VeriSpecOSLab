# 常见问题

| 现象 | 检查 |
| --- | --- |
| schema 失败 | 运行 `vos spec check`，先修复字段和引用，不要加回旧 kind |
| owns 越界 | 把实现路径移入目标 ModuleSpec 的仓库相对 owns，跨模块先写已提交 SpecPatch |
| verify 被阻断 | 提交当前 Spec 和代码，确认 clean HEAD 与 ledger |
| QEMU 无输出 | 使用 `-nographic` 和串口参数，检查 stdout/stderr evidence |
| hardware 仍 pending | 本地启动记录不能替代人工验收 |
