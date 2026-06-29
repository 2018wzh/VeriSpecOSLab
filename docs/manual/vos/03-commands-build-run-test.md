# 03 CLI 命令参考（中）：构建、运行与测试

本章覆盖 VOS CLI 中与工具链检查、构建、QEMU 运行和测试相关的命令。

## 3.1 工具链检查

### `vos toolchain lint`

检查 `spec/toolchain/` 是否可被 VOS 正确读取，校验 profile、build、link、image、run、debug 各段的字段完整性和一致性。

```
vos toolchain lint
```

**检查内容**：
- `profile.yaml` 中的 `target_arch`、`target_triple`、`c_compiler` 等字段
- `build.yaml` 中的 `sources`、`cflags`、`phases` 等字段
- `link.yaml` 中的 `linker_script`、`entry_symbol` 等字段
- `run.yaml` 中的 `emulator`、`machine`、`success_signal` 等字段
- 工具链声明与实际 PATH 中工具的匹配

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec toolchain lint
```

**典型输出**：通过时无输出或显示 "OK"；失败时列出具体字段问题和缺失的工具。

---

### `vos build generate`

让 Agent 从 ToolchainSpec 起草构建系统配置（Makefile、CMakeLists.txt 等），经 VOS deterministic gate 裁决后物化到 `.vos/toolchain.json`。

```
vos build generate
```

**前置条件**：
- `spec/toolchain/` 已通过 `toolchain lint`
- Agent provider 已配置

**输出**：`.vos/toolchain.json`（物化后的工具链配置）

**流程**：
1. Agent 读取 ToolchainSpec，起草构建系统草案
2. VOS 执行 deterministic gate：校验路径、spec hash、manifest、ledger、dry-run
3. Agent draft 未通过 gate 时不得落盘

---

## 3.2 构建

### `vos build --dry-run`

显示构建计划而不实际执行。

```
vos build --dry-run
```

**输出**：构建步骤清单、预计产物路径、编译命令预览。

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec build --dry-run
```

---

### `vos build`

执行完整构建流程：编译 → 汇编 → 链接 → 生成镜像。

```
vos build
```

**前置条件**：
- `.vos/toolchain.json` 存在且有效
- 项目工具链（编译器、链接器等）在 PATH 中可发现
- 构建前 VOS 会探测工具链实际版本，不满足约束时拒绝构建

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec build
```

**证据产出**：`.vos/runs/<run-id>/`，含构建日志、编译命令记录、产物 hash。

**常见参数**：

| 参数 | 说明 |
|------|------|
| `--dry-run` | 仅显示构建计划，不执行 |
| `--variant <id>` | 选择 BuildVariant（如 `baseline`、`test`） |

---

## 3.3 QEMU 运行

### `vos run qemu`

在 QEMU 中启动内核。

```
vos run qemu [options]
```

**前置条件**：
- 构建已成功完成
- QEMU 模拟器在 PATH 中

**参数**：

| 参数 | 说明 |
|------|------|
| `--case <case-id>` | 指定运行 case（如 `boot-smoke`） |
| `--list-profiles` | 列出 `spec/toolchain/run.yaml` 中定义的所有 profile |
| `--list-cases` | 列出所有可用的运行 case |
| `--timeout <seconds>` | 覆盖默认超时 |

**示例**：

```bash
# 列出所有可用的运行配置
bun run vos -- --project-root ../examples/xv6-spec run qemu --list-cases

# 运行默认 case
bun run vos -- --project-root ../examples/xv6-spec run qemu

# 运行指定 case
bun run vos -- --project-root ../examples/xv6-spec run qemu --case boot-smoke
```

**运行 case 机制**：

`spec/toolchain/run.yaml` 中定义 `success_signal`（成功标记，如 `XV6_BOOT_OK`）和 `cases`。每个 case 可指定：
- `stdin`：标准输入
- `success_regex`：成功匹配的正则
- `failure_regex`：失败匹配的正则
- `exit_code`：预期退出码
- `timeout_secs`：超时时间
- `required_artifacts`：需要的产物

VOS 通过 QEMU 串口输出匹配 `success_signal` 来判断运行是否成功。

**证据产出**：`.vos/runs/<run-id>/artifacts/qemu.log`（QEMU 串口日志）。

---

## 3.4 测试

### `vos test`

运行测试套件。

```
vos test --suite <suite-name> [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--suite <suite-name>` | 测试套件名称（必需） |
| `--dry-run` | 仅显示测试计划，不执行 |

**示例**：

```bash
# 运行指定套件
bun run vos -- --project-root ../examples/xv6-spec test --suite fork-tests
```

**注意事项**：
- `vos test` 只能引用 BuildVariant，不能在 suite 中临时改写编译 flag 或内核源码
- 测试套件引用 `spec/toolchain/run.yaml` 中的 `run_case`，不自行定义 QEMU 参数

---

## 3.5 命令链

以下命令链展示典型的构建-运行-测试流程：

```bash
# 1. 检查工具链
bun run vos -- --project-root ../examples/xv6-spec toolchain lint

# 2. 预览构建计划
bun run vos -- --project-root ../examples/xv6-spec build --dry-run

# 3. 执行构建
bun run vos -- --project-root ../examples/xv6-spec build

# 4. 运行 QEMU
bun run vos -- --project-root ../examples/xv6-spec run qemu --case boot-smoke

# 5. 运行测试
bun run vos -- --project-root ../examples/xv6-spec test --suite fork-tests
```

---

## 3.6 相关文档

- [02 CLI 命令参考（上）：项目、Spec 与架构](./02-commands-spec-arch.md)
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md)
- [06 Spec Schema 参考（下）：工具链、验证、演化、目标](./06-spec-schema-toolchain-verify-evolution.md)
