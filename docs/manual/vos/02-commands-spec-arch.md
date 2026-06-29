# 02 CLI 命令参考（上）：项目、Spec 与架构

本章覆盖 VOS CLI 中与项目状态、Spec 校验和架构分析相关的命令。

## 2.1 项目与环境

### `vos doctor`

检查项目环境和配置是否就绪。验证 Bun 版本、工具链可发现性、`spec/` 目录存在性、`.vos/` 配置完整性。

```
vos doctor
```

**输出**：诊断报告，列出通过和失败的检查项。

**典型用法**：拿到新项目后第一步执行。

---

### `vos stage show`

显示当前项目的实验阶段。

```
vos stage show
```

**前置条件**：`.vos/project.yaml` 中存在 `current_stage` 字段。

**输出**：

```text
current_stage: boot
```

**相关文件**：`.vos/project.yaml` 中的 `current_stage` 字段。

---

## 2.2 Spec 校验

### `vos spec lint`

对指定 Spec 文件或整个 `spec/` 目录做格式和字段校验。

```
vos spec lint [path]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `path` | 可选。目标 YAML 文件路径或目录。省略时默认检查整个 `spec/` 目录 |

**示例**：

```bash
# 检查整个 spec/ 目录
bun run vos -- --project-root ../examples/xv6-spec spec lint

# 检查单个文件
bun run vos -- --project-root ../examples/xv6-spec spec lint spec/modules/kernel/memory/ops/kalloc.yaml
```

**检查内容**：
- YAML 语法正确性
- 必填字段是否完整
- 字段类型是否符合 schema
- `id`、`module`、`stage` 等引用字段的一致性
- 反模式检测（如只写高层愿景无模块规格）

---

### `vos spec normalize`

将 Spec 文件规范化为统一格式并输出。

```
vos spec normalize [path]
```

**输出**：规范化后的 YAML（排序字段、统一缩进、补全默认值）。

---

### `vos spec check-consistency`

检查 `spec/` 中多个文件之间的引用一致性。

```
vos spec check-consistency
```

**检查内容**：
- `ArchitectureSlice` 引用的模块是否存在
- `OperationContract` 引用的 `requires_modules` / `requires_ops` 是否可解析
- `ModuleSpec` 的 `related_slices` 是否指向存在的 Slice
- 跨文件 `id` 引用是否完整

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec spec check-consistency
```

---

### `vos spec patch lint`

校验 SpecPatch 文件的结构、DAG、影响范围和回归选择，不实际应用。

```
vos spec patch lint <patch-yaml>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `patch-yaml` | SpecPatch YAML 文件路径 |

**检查内容**：
- `commit_sha` / `parent_sha` 格式和可解析性
- `affected_specs` 列表是否覆盖真实 diff
- `required_regressions` 是否声明完整
- SpecPatch 类型（`kind`）与变更范围是否匹配

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec spec patch lint spec/evolution/patch-001-initial-spec.yaml
```

---

### `vos spec patch apply`

应用 SpecPatch。这是严格 gate 操作，会执行以下检查：

1. 校验 `commit_sha` / `parent_sha` 可在本地 Git 中解析
2. 校验 SpecPatch metadata 覆盖真实 diff impact
3. 默认执行 `verify patch`
4. 通过后刷新 `.vos/cache/patches/applied.json`

```
vos spec patch apply <patch-yaml>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `patch-yaml` | SpecPatch YAML 文件路径 |

**前置条件**：
- SpecPatch 已通过 `spec patch lint`
- 对应的 Git commit 在本地可解析

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec spec patch apply spec/evolution/patch-001-initial-spec.yaml
```

---

## 2.3 架构分析

### `vos arch lint`

对架构 Spec 文件做校验。

```
vos arch lint [path]
```

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec arch lint
bun run vos -- --project-root ../examples/xv6-spec arch lint spec/architecture/seed.yaml
```

**检查内容**：
- `ArchitectureSeed` 是否包含 `reference_systems`、`goals`、`non_goals`、`constraints`
- `ArchitectureSlice` 是否声明 `depends_on_slices`、`affected_modules`、`mechanisms`
- 不接受只写 "Linux-like" 等标签式设计
- `validation_binding` 是否存在

---

### `vos arch compose`

对指定架构文件做组合视图分析。展开当前阶段已纳入的模块、机制和验证项。

```
vos arch compose <seed-yaml>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `seed-yaml` | ArchitectureSeed YAML 文件路径 |

**输出**：组合视图，列出当前 stage 的 enabled_modules、active mechanisms、派生验证计划。

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec arch compose spec/architecture/seed.yaml
```

---

### `vos arch derive-tests`

从架构规格派生测试计划。

```
vos arch derive-tests <seed-yaml>
```

**输出**：从 ArchitectureSlice 的 `validation_binding` 和 `mechanisms` 派生出的测试矩阵。

**示例**：

```bash
bun run vos -- --project-root ../examples/xv6-spec arch derive-tests spec/architecture/seed.yaml
```

---

## 2.4 命令依赖关系

```text
spec lint ──→ spec check-consistency ──→ spec patch lint ──→ spec patch apply
                  │
arch lint ──→ arch compose ──→ arch derive-tests
```

`spec patch apply` 依赖 `spec patch lint` 通过。`arch derive-tests` 建议在 `arch compose` 之后运行。

---

## 2.5 相关文档

- [03 CLI 命令参考（中）：构建、运行与测试](./03-commands-build-run-test.md)
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md)
- [05 Spec Schema 参考（上）：架构、模块、操作](./05-spec-schema-arch-module-op.md)
