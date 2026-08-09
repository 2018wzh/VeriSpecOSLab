# 工具概览

学生主链只有一套 CLI：

```text
vos init → vos agent config → vos doctor → vos agent design → vos agent spec <module>
        → vos agent implement <module> → vos build → vos run qemu
        → vos verify → vos report → vos submit
```

排查与审查使用只读角色：

```sh
vos agent debug
vos agent verify
vos agent ask "问题"
vos agent review [module]
```

`vos.yaml` 是结构化执行投影，不是 shell 脚本。Host、QEMU 和 Hardware Runner 执行其中的 argv target；公开测试通过 `checks.<target>.verifies` 绑定稳定 Spec ID。完整参数见 [vos 学生命令参考](vos-commands.md)。

`vos agent config` 是 Agent 的设置入口，不是第八种 Agent 角色。它只把 provider、模型、base URL 和凭据环境变量名写入 gitignored 的 `.vos/config.toml`；凭据值保存在 `.env`。`vos agent config --check` 与 `vos doctor` 使用同一套严格校验。

Lab 1 的 CTF 双环境热身发生在正式 VOS 项目主链之前。它使用语言工具链、QEMU 和教师提供的镜像，不因此恢复旧学生 CLI。任务形式与隐私边界见 [CTF 与 flag](ctf-flags.md)。

Portal 与 Demo 仍保留构建和单测，但已冻结，不属于学生主链，也不承诺旧 connected teaching loop。
