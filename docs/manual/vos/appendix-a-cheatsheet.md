# 附录 A：命令速查表

所有 VOS CLI 命令一行描述。命令从 `vos/` 目录运行，需带 `--project-root`。

## 项目与环境

| 命令 | 说明 |
|------|------|
| `vos doctor` | 检查项目环境和配置 |
| `vos stage show` | 显示当前实验阶段 |

## Spec 校验

| 命令 | 说明 |
|------|------|
| `vos spec lint [path]` | 校验 spec YAML 格式与字段 |
| `vos spec normalize [path]` | 规范化 spec 输出 |
| `vos spec check-consistency` | 检查 spec 文件间引用一致性 |
| `vos spec patch lint <yaml>` | 校验 SpecPatch 结构 |
| `vos spec patch apply <yaml>` | 应用 SpecPatch（严格 gate） |

## 架构分析

| 命令 | 说明 |
|------|------|
| `vos arch lint [path]` | 校验架构 spec |
| `vos arch compose <seed>` | 架构组合视图分析 |
| `vos arch derive-tests <seed>` | 从架构派生测试计划 |

## 构建、运行、测试

| 命令 | 说明 |
|------|------|
| `vos toolchain lint` | 检查 toolchain spec |
| `vos build generate` | Agent 起草构建系统 → VOS gate 物化 |
| `vos build --dry-run` | 预览构建计划 |
| `vos build` | 执行构建 |
| `vos run qemu` | 启动 QEMU |
| `vos run qemu --case <id>` | 运行指定 QEMU case |
| `vos run qemu --list-cases` | 列出所有 QEMU case |
| `vos test --suite <name>` | 运行测试套件 |

## 验证

| 命令 | 说明 |
|------|------|
| `vos verify public` | 执行公开验证 |
| `vos verify public --dry-run` | 预览公开验证计划 |
| `vos verify public --target <stage>` | 限定阶段的公开验证 |
| `vos verify patch <target>` | SpecPatch 针对性验证 |
| `vos verify invariant --target <t>` | 不变量检查 |
| `vos verify fuzz --target <t>` | 模糊测试 |
| `vos verify generated --target <t>` | 验证生成代码 |

## Agent

| 命令 | 说明 |
|------|------|
| `vos agent context --scope public` | 查看 Agent 上下文 |
| `vos agent plan --stage <s>` | Agent 生成执行计划 |
| `vos agent generate --apply` | Agent 生成代码并写入 |
| `vos agent generate <target> --apply` | 生成指定目标 |
| `vos agent generate --apply --build --run` | 生成+构建+运行（链式） |
| `vos agent ask --stage <s> "<q>"` | 向 Agent 提问 |
| `vos agent apply-patch --patch-file <f>` | Agent 应用补丁 |
| `vos agent validate-generated --target <t>` | 验证生成代码 |
| `vos agent review-spec --target <t>` | Agent 审查 spec |
| `vos agent debug --log <path>` | Agent 诊断日志 |
| `vos agent log` | 查看 Agent 审计日志 |

## 报告、提交、知识库

| 命令 | 说明 |
|------|------|
| `vos report generate --stage <s>` | 生成阶段报告 |
| `vos report generate --final` | 生成最终报告 |
| `vos submit pack` | 打包提交 |
| `vos kb add <path> --source-kind project --recursive` | 添加知识库条目 |
| `vos kb list` | 列出知识库内容 |
| `vos kb search "<query>"` | 语义搜索知识库 |

## 全局参数

| 参数 | 说明 |
|------|------|
| `--project-root <path>` | 项目根目录（必需） |
| `--json` | 机器可读 JSON 输出 |
| `--progress auto\|always\|never` | 进度显示 |
| `--agent-session <id>` | 绑定 Agent 会话 |
| `--report <path>` | 报告输出路径 |
| `--evidence-dir <path>` | Evidence 目录 |
