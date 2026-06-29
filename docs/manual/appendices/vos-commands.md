# vos 命令参考

`vos` 是 VeriSpecOSLab 的统一命令入口。所有与规格、构建、测试、验证、Agent 相关的操作都通过 `vos` 命令完成。

## 全局约定

- 所有命令在项目根目录（包含 `.speclab.yml` 的目录）下执行。
- 命令输出遵循：`stdout` = 结构化结果（JSON 或 YAML），`stderr` = 人类可读日志。
- `--help` 可查看每个子命令的详细参数。

## 规格相关命令

### `vos spec lint [path]`

检查指定路径（默认 `spec/`）下所有规格文件的格式和完整性。

```bash
# 检查所有规格
vos spec lint

# 检查特定模块
vos spec lint spec/modules/kernel/memory/
```

输出：格式错误、缺失字段、引用不一致等问题的列表。

### `vos arch lint`

检查架构层规格的内部一致性：ArchitectureSlice 是否引用了已存在的 ADR？CompositionSpec 中的模块是否都有对应的 ModuleSpec？

```bash
vos arch lint
```

## 构建相关命令

### `vos build`

根据 `spec/toolchain/toolchain.yaml` 中的语义构建规范执行构建。

```bash
# 完整构建
vos build

# 仅编译内核
vos build --target kernel

# 清理后构建
vos build --clean
```

### `vos build generate`

根据当前 spec 上下文，通过 Agent 生成构建系统文件（Makefile、链接脚本等）。

```bash
vos build generate
```

## 运行相关命令

### `vos run qemu [options]`

在 QEMU 中启动内核。

```bash
# 默认启动
vos run qemu

# 指定超时
vos run qemu --timeout 30000
```

## 测试相关命令

### `vos test <suite>`

运行指定的测试套件。测试套件名称对应 `spec/verification/public-matrix.yaml` 中定义的套件。

```bash
# 运行所有公开测试
vos test public

# 运行特定模块测试
vos test memory.page_allocator
vos test trap.usertrap
vos test process.fork
```

### `vos test generated`

运行由 Agent 根据你的 Spec 自动派生的测试。

```bash
vos test generated
```

## 验证相关命令

### `vos verify public`

运行基础验证矩阵中的全部验证项。

```bash
vos verify public
```

### `vos verify full --target goal`

运行你的 GoalValidationContract 中定义的个性化验证。

```bash
vos verify full --target goal
```

### `vos arch lint`

验证架构层的一致性：所有 ArchitectureSlice 的依赖关系、所有 ADR 的影响范围、CompositionSpec 的覆盖度。

```bash
vos arch lint
```

### `vos verify full --target composition`

验证跨模块组合不变量。

```bash
vos verify full --target composition
```

## 报告相关命令

### `vos report generate`

根据当前验证结果生成报告。

```bash
# 生成完整报告
vos report generate

# 生成阶段报告或最终报告
vos report generate --stage boot
vos report generate --final
```

## Agent 相关命令

### `vos agent ask <query>`

向知识库 Agent 提问（只读，不生成代码）。

```bash
vos agent ask "RISC-V Sv39 页表结构是什么？"
```

### `vos agent context`

显示当前 Agent 可用的上下文（spec、模块、阶段信息）。

```bash
vos agent context
```

### `vos agent apply-patch`

将 Agent 生成的 patch 应用到代码，包含完整的 policy 检查和 spec 绑定验证。

```bash
vos agent apply-patch --file .vos/apply.patch
```

## 知识库相关命令

### `vos kb add <path>`

将文档、参考资料导入知识库。

```bash
vos kb add docs/reference/riscv-privileged-manual.pdf
```

### `vos kb list`

列出知识库中已导入的条目。

```bash
vos kb list
```

### `vos kb search <query>`

在知识库中搜索。

```bash
vos kb search "PLIC interrupt handling"
```
