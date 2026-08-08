# Lab 1：从空目录到 DesignSpec

目标是把系统边界写清楚，不预设内核骨架。

```sh
vos init
vos doctor
vos agent design
```

确认 Agent 给出的 diff 后运行 `vos agent design --confirm`。`spec/design.yaml` 必须声明系统目标、语言、ISA、内核组织、QEMU、canonical board、硬件启动/串口/中断信息，并最多写三个组合不变量。`vos spec check` 只检查结构、引用和路径；设计取舍由学生负责。

提交物：一份已提交的 DesignSpec、一次 `spec check` evidence，以及对一个被拒绝设计方案的简短理由。
