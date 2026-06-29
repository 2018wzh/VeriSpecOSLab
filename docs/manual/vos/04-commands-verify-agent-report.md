# 04 CLI 命令参考（下）：验证、Agent、报告与知识库

本章覆盖 VOS CLI 中与验证、Agent 协作、报告生成、提交和知识库相关的命令。

## 4.1 验证

### `vos verify public`

执行公开验证矩阵中声明的所有检查。

```
vos verify public [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--dry-run` | 仅显示验证计划，不执行 |
| `--target <stage-or-id>` | 限定到指定阶段或验证目标 |

**验证来源**：`spec/verification/public-matrix.yaml` 中的 `public_requirements`。

**示例**：

```bash
# 预览验证计划
bun run vos -- --project-root ../examples/xv6-spec verify public --dry-run

# 执行公开验证
bun run vos -- --project-root ../examples/xv6-spec verify public

# 限定阶段
bun run vos -- --project-root ../examples/xv6-spec verify public --target boot
```

**证据产出**：`.vos/runs/<run-id>/artifacts/` 含各项验证的日志和结果。

---

### `vos verify patch`

对 SpecPatch 引入的变更执行针对性验证。

```
vos verify patch <target>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `target` | SpecPatch YAML 路径或 patch ID |

**验证内容**：根据 `PatchImpactReport` 中的 `required_checks` 和 `selected_tests` 执行验证。

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec verify patch spec/evolution/patch-001-initial-spec.yaml
```

---

### `vos verify invariant`

检查指定目标的不变量是否保持。

```
vos verify invariant --target <target>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--target <target>` | 模块名或操作 ID |

**适用场景**：设备驱动、内存管理等核心不变量检查。

---

### `vos verify fuzz`

对指定目标执行模糊测试。

```
vos verify fuzz --target <target>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--target <target>` | 模块名或操作 ID |

**适用场景**：期末综合验证阶段。

---

### `vos verify generated`

验证 Agent 生成的代码。

```
vos verify generated --target <target>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--target <target>` | 生成目标 |

---

## 4.2 Agent

Agent 是受控协作者。所有 Agent 命令会先收集 spec、策略、阶段和 evidence 上下文，再通过固定教学 profile 生成计划、补丁或解释。Agent 的结构化输出必须匹配当前任务 schema；能否写入文件、阶段是否允许，最终由 VOS runtime 裁决。

### `vos agent context`

查看 Agent 当前可用的上下文。

```
vos agent context [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--scope public` | 仅显示公开上下文（推荐） |

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec agent context --scope public
```

**输出**：当前阶段、可见 spec 列表、策略约束、Agent 可调用的接口。

---

### `vos agent plan`

让 Agent 为当前阶段生成执行计划。

```
vos agent plan --stage <stage>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--stage <stage>` | 目标阶段 |

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec agent plan --stage boot
```

**输出**：Agent 的任务分解计划、目标列表、依赖分析。

---

### `vos agent generate`

让 Agent 根据 spec 生成代码。

```
vos agent generate [target] [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `target` | 可选。生成目标（如 `kernel/memory`）。省略时按当前 stage 生成全部已纳入模块 |
| `--apply` | 将生成的代码写入工作区（必需，否则仅预览） |
| `--build` | 生成后执行构建（依赖 `--apply`） |
| `--run` | 构建后执行 QEMU 运行（依赖 `--build`） |

**示例**：

```bash
# 生成全部当前阶段代码并写入
bun run vos -- --project-root ../examples/xv6-spec agent generate --apply

# 只生成指定模块
bun run vos -- --project-root ../examples/xv6-spec agent generate kernel/memory --apply

# 生成 + 构建 + 运行
bun run vos -- --project-root ../examples/xv6-spec agent generate --apply --build --run
```

**约束**：
- `--build` 必须与 `--apply` 一起使用
- `--run` 必须与 `--build` 和 `--apply` 一起使用

**前置条件**：
- Agent provider 已配置（`.vos/config.toml` 中 `[agent]` 段）
- 相关 `ModuleSpec` 和 `OperationContract` 已就绪（StageGate 约束）

---

### `vos agent ask`

向 Agent 提问。

```
vos agent ask --stage <stage> "<question>"
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--stage <stage>` | 当前阶段 |
| `question` | 问题文本 |

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec agent ask --stage boot "为什么 kalloc 返回 NULL？"
```

---

### `vos agent apply-patch`

让 Agent 应用补丁文件。

```
vos agent apply-patch --patch-file <file> [--run-validation]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--patch-file <file>` | 补丁文件路径 |
| `--run-validation` | 应用后执行验证 |

**注意**：Agent 生成的 unified diff 只能通过此命令作为局部写入入口，不能替代 commit-backed SpecPatch 演化记录。

---

### `vos agent validate-generated`

验证 Agent 生成的代码是否符合 spec。

```
vos agent validate-generated --target <target>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--target <target>` | 生成目标 |

---

### `vos agent review-spec`

让 Agent 审查 spec。

```
vos agent review-spec --target <path-or-stage-or-patch>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--target <path-or-stage-or-patch>` | spec 路径、stage 名或 patch ID |

---

### `vos agent debug`

让 Agent 诊断构建或运行日志。

```
vos agent debug --log <log-path>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--log <log-path>` | 日志文件路径 |

---

### `vos agent log`

查看 Agent 审计日志。

```
vos agent log
```

**输出**：`.vos/agent-log.jsonl` 的内容，记录所有 Agent 调用及其结果。

---

## 4.3 报告

### `vos report generate`

生成阶段报告或最终报告。

```
vos report generate [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--stage <stage>` | 生成指定阶段报告 |
| `--final` | 生成最终综合报告 |

**输出位置**：`spec/reports/` 和 `.vos/report/`。

**示例**：

```bash
# 阶段报告
bun run vos -- --project-root ../examples/xv6-spec report generate --stage boot

# 最终报告
bun run vos -- --project-root ../examples/xv6-spec report generate --final
```

**报告内容**：ArchitectureSlice 引用、ModuleSpec/OperationContract 引用、验证证据、SpecPatch 记录、AI 参与声明。

---

## 4.4 提交

### `vos submit pack`

打包当前提交为可提交的课程作业包。

```
vos submit pack
```

**前置条件**：当前 `HEAD` commit 已通过所需验证。

**打包内容**：以当前 `HEAD` commit 为边界，打包 spec/、源码、报告和 evidence 引用。

**输出位置**：`.vos/submit/`。

---

## 4.5 知识库

### `vos kb add`

向本地知识库添加内容。

```
vos kb add <path-or-url> [options]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `path-or-url` | 文件路径、目录路径或 URL |
| `--source-kind project` | 来源类型 |
| `--recursive` | 递归添加目录 |

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec kb add spec/ --source-kind project --recursive
```

---

### `vos kb list`

列出知识库中已索引的内容。

```
vos kb list
```

---

### `vos kb search`

语义搜索知识库。

```
vos kb search "<query>"
```

**依赖**：`.vos/config.toml` 中的 `[kb.embedding]` 配置。

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec kb search "page allocator freelist"
```

---

## 4.6 命令依赖关系

```text
agent context ──→ agent plan ──→ agent generate --apply ──→ build ──→ run qemu
                                      │
agent ask                              ├──→ agent validate-generated
agent review-spec                      ├──→ verify generated
agent debug                            └──→ verify public

verify patch ──→ spec patch apply

report generate ──→ submit pack
```

---

## 4.7 相关文档

- [02 CLI 命令参考（上）：项目、Spec 与架构](./02-commands-spec-arch.md)
- [03 CLI 命令参考（中）：构建、运行与测试](./03-commands-build-run-test.md)
- [05 Spec Schema 参考（上）：架构、模块、操作](./05-spec-schema-arch-module-op.md)
- [06 Spec Schema 参考（下）：工具链、验证、演化、目标](./06-spec-schema-toolchain-verify-evolution.md)
