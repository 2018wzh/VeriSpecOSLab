# Spec 编写规则

## 1. 基本规则

1. YAML Spec 面向工具消费，字段应稳定、克制、可 lint。
2. Markdown 解释面向人阅读，不应代替结构化字段。
3. 核心行为不能只写在 prose 中，必须落到明确字段。

## 2. 字段设计规则

1. 优先使用列表和结构化对象，不要把多个语义塞进一段长文本。
2. `preconditions`、`postconditions`、`invariants_preserved`、`failure_semantics` 不得省略。
3. 若一个字段会影响 patch 或 verify，它就不应只存在于注释中。

## 3. 命名规则

1. `id` 应稳定、可引用，避免频繁重命名。
2. `module` 和 `operation` 命名应与代码和测试保持接近。
3. `stage` 应与课程 StageGate 一致。

## 4. 演化规则

1. 大的语义变化先改 Spec，再改代码。
2. 涉及跨模块边界变化时，先更新 `CompositionSpec`。
3. 涉及构建、链接、镜像、运行假设变化时，先更新 `ToolchainSpec`。

## 5. LLM 使用规则

1. Agent 写入核心实现前，必须绑定相关 `ModuleSpec`、`OperationContract` 或 `codegen.targets`。
2. Agent 不应在缺少核心字段时直接补完整实现。
3. Agent 产生的写入必须能说明修改对应哪条 Spec 条款。
4. Agent 不得通过删除测试、关闭检查器或绕过权限来“满足” Spec。

## 6. 最小落地建议

MVP 阶段建议优先把以下内容写细：

1. `memory`
2. `syscall`
3. `ipc`
4. `toolchain`

每个域先写：

- 1 个 `module.yaml`
- 1 个 `concurrency.yaml` 或等价并发说明
- 3 到 5 个 `ops/*.yaml`
- 1 组公开测试义务

## 7. 反模式

以下写法应被 lint 或 review 标记：

1. 只有高层愿景，没有模块和操作规格。
2. 只写“支持 Linux-like syscall”，不写 ABI 和错误语义。
3. 只写“保证安全”，不写 authority / isolation / pointer policy。
4. 只写“通过测试”，不写哪些性质和哪些证据。
5. 只改代码，不补 Spec 或 commit-backed SpecPatch metadata。
