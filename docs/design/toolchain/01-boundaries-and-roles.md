# 01 Boundaries And Roles

回答的问题：

- `VOS Runtime` 和 `ToolchainSpec` 分别负责什么
- `vos` 为什么不能退化成自由 shell 包装器
- 谁能执行哪些命令，谁不能看到哪些信息

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md)

下游消费者：

- `vos-core` policy
- `vos-agent`
- 课程平台权限控制

## 1. `VOS Runtime` vs `ToolchainSpec`

两者必须严格区分：

- `ToolchainSpec`
  - 是学生项目的**工具无关的语义构建规范**
  - 存放在 `spec/toolchain/`
  - 决定项目”编译哪些源文件、使用什么标志、如何链接、什么依赖关系”（不关心 Makefile 还是 xtask）
- `VOS Runtime`
  - 是 `vos` 的实现体系
  - 存放在 `docs/design/toolchain/` 中进行设计
  - 决定”如何读取 spec、调用本地 Agent 生成草案、执行 deterministic gate、执行 manifest、采集证据”

因此：

```text
ToolchainSpec = 项目构建语义（工具无关）
VOS Runtime   = 规范消费、Agent draft 协调、deterministic gate、执行编排器
```

### 1.1 Agent-assisted 工具链物化

VOS Runtime 的新职责是**Agent-assisted authoring + deterministic gate**：

```
ToolchainSpec (语义: 源文件、编译标志、链接脚本...)
    ↓ [vos-spec 解析与验证]
    ↓ [本地 vos-agent 生成 ToolchainGenerationDraft]
构建系统草案 (Makefile | task.rs | CMakeLists.txt | manifest | instructions)
    ↓ [vos deterministic gate: path/spec/manifest/ledger/evidence]
受控构建系统 + .vos/toolchain.json
    ↓ [vos-runtime 执行]
执行输出 + 工件
    ↓ [证据采集与映射]
证据束 (回溯到 spec 的语义阶段)
```

关键变化：

- **过去**：vos runtime 直接解析 spec 中的命令字段，执行 gcc、ld 等。
- **目标态**：`vos build generate` 调用本地 `vos-agent` 产出
  `ToolchainGenerationDraft`，但只有 `vos-cli` 可以决定是否落盘、写
  `.vos/toolchain.json`、写 ledger、创建 commit 和生成 evidence。

Agent draft 不要求字节级确定性；VOS gate 必须对同一类草案给出确定的
accept/reject 裁决。没有可用 Agent/provider 时，`vos build generate`
明确失败，不使用模板兜底。

## 2. `vos` vs 任意 shell

`vos` 不是任意 shell 包装器。它必须：

- 暴露固定子命令，而不是任意命令转发
- 对 Portal-bound repo 执行统一身份验证和 policy gate
- 对路径、阶段、spec 绑定和可见性做检查
- 把输出整理成稳定 JSON 与 evidence
- 记录命令、参数、产物、日志、失败类型

它不能：

- 允许 Agent 自由执行 `rm`、`curl`、`bash -c`
- 绕过测试和 invariant checker
- 直接读取 hidden tests 源码

## 3. 本地公开能力 vs 云端私有验证

本地 `vos` 是 repo runtime，可以看到：

- 本地 `spec/`
- 学生源代码
- 公开测试与派生测试
- Portal 签发或校验的公开阶段约束投影
- Portal 签发或校验的 agent-only 约束摘要

本地 `vos` 不可以看到：

- hidden tests 源码
- mutation plan 细节
- anti-gaming 规则细节
- staff-only grading policy

平台可以通过 sandbox runner 注入 hidden / staff-only policy snapshot 执行完整
验证，但 hidden tests、mutation plan 和 staff-only 细节不得写入学生 repo、本地
学生 Agent 或学生可见 report。回流给学生的只能是摘要与 verdict。

### 3.1 Portal-bound repo 身份规则

当项目绑定了 Portal `project_id` 时，本地 CLI 与 `vos serve` 都必须执行相同
的身份和 policy gate：

- `vos login --portal-url` 从 Portal 获取 token；`vos logout` 清除本地 token；
  `vos whoami` 显示当前身份、project binding 和 policy 状态。
- token 存入用户级 VOS auth store；项目 `.vos/` 只能保存非敏感 portal URL、
  project id 和 stage binding。
- 除 `login` / `logout` / `whoami` / `help` 等认证入口外，Portal-bound repo
  中的所有项目命令都必须在线校验 Portal token 和当前 policy snapshot。
- 不支持离线缓存执行受控命令；网络不可用、token 无效或 policy snapshot
  无法校验时，命令必须返回 `policy_blocked`。
- 本地 `.vos/policy.yaml` 只能在 Portal policy 基础上进一步收窄权限，不能扩权。
- 每次 run 的 manifest 必须记录 user、project、policy snapshot ref 和 auth verdict。

未绑定 Portal project 的普通本地 repo 可以保留 local-only 使用模式，但其输出
不得伪装成 Portal 审计过的 run。local-only 只表示不需要 Portal token；
受控项目命令仍必须满足 git repo、clean tree 和当前 `HEAD` ledger gate。

## 4. Agent 辅助开发 vs 自动代写 OS

Agent 在本体系中的角色是“受控协作开发者”，而不是自由代码生成器。要求：

- Agent 会话必须选择一个 `AgentIdentity`，并使用它唯一绑定的 `CapabilityPack`
- 写入必须绑定本地 spec、SpecPatch ID、commit-backed SpecPatch ref 或 `codegen.targets`
- 关键改动必须触发最小验证集
- 所有 Agent 行为进入审计日志

Agent 不得：

- 规避 spec-first 和 validation-first 约束
- 关闭检查器或删除测试
- 以“回答文本”替代 evidence
- 通过提示词扩张工具、路径或可见性

## 5. 角色与权限

```text
student:
  可运行 build/test/verify public/report
  可查看公开与生成测试结果
  不可查看 hidden tests 源码

agent:
  可通过 vos 执行受控命令
  可读取本地 spec/
  可读取 Portal policy 允许的 agent-only 约束摘要
  不可删除测试和 invariant checker
  不可读取未授权云端内容

teacher:
  可配置课程规则、rubric、hidden tests、judge policy

ci:
  可在 sandbox runner 中通过 authenticated vos 执行完整验证
  可写入 evidence 和 judge result
```

## 6. Policy 模型

`vos-core` policy 负责执行命令白名单、路径白名单和可见性规则。Portal-bound repo
中，Portal policy snapshot 是权限上限，本地 policy 只能收窄。示例：

```yaml
VosPolicy:
  agent:
    allowed_commands:
      - stage show
      - spec lint
      - spec normalize
      - spec check-consistency
      - arch lint
      - arch derive-tests
      - build
      - run qemu
      - test
      - verify public
      - verify patch
      - trace
      - debug explain-log
      - report generate
      - agent context
      - agent plan
      - agent apply-patch
      - agent log
    denied_commands:
      - shell
      - rm
      - hidden-test show-source
      - cloud-spec raw-dump
      - invariant-checker disable
```

## 相关文档

**Spec 与工具链物化：**
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md) - 工具无关的 ToolchainSpec
- [../spec/05a-semantic-build-schema.md](../spec/05a-semantic-build-schema.md) - 语义构建字段定义
- [../spec/05b-vos-toolchain-generation-contract.md](../spec/05b-vos-toolchain-generation-contract.md) - VOS 生成与执行契约
- [../spec/05c-generator-reference.md](../spec/05c-generator-reference.md) - Agent draft 示例（非权威生成器）

**VOS Runtime 架构：**
- [02-architecture.md](./02-architecture.md)
- [07-agent-gateway.md](./07-agent-gateway.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
