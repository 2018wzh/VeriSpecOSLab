# 机器启动参考

机器相关选择写入 `spec/design.yaml` 的 `machine` 和 `hardware_port`，执行参数写入 `vos.yaml`。不要把平台专用命令散落到聊天记录或脚本中；用结构化 `program + args + cwd + env + timeout`，并在 target 中声明产物和验证的 Spec ID。
