# 工具概览

学生主链只有一套 CLI：

```text
vos init → vos doctor → vos agent design → vos agent spec <module>
        → vos agent implement <module> → vos build → vos run qemu
        → vos verify → vos report → vos submit
```

排查与审查使用只读角色：

```sh
vos agent debug
vos agent verify
vos agent kb "问题"
vos agent review [module]
```

`vos.yaml` 是结构化执行投影，不是 shell 脚本。Host、QEMU 和 Hardware Runner 执行其中的 argv target；公开测试通过 `checks.<target>.verifies` 绑定稳定 Spec ID。完整参数见 [vos 学生命令参考](vos-commands.md)。

Portal 与 Demo 仍保留构建和单测，但已冻结，不属于学生主链，也不承诺旧 connected teaching loop。
