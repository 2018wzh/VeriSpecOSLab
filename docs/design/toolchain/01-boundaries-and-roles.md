# 01 Boundaries And Roles

回答的问题：

- `VOS Runtime` 和 `ToolchainSpec` 分别负责什么
- `vos` 为什么不能退化成自由 shell 包装器
- 谁能执行哪些命令，谁不能看到哪些信息

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md)

下游消费者：

- `vos-policy`
- `vos-agent`
- 课程平台权限控制

## 1. `VOS Runtime` vs `ToolchainSpec`

两者必须严格区分：

- `ToolchainSpec`
  - 是学生项目的构建 / 链接 / 镜像 / 运行 / 调试契约
  - 存放在 `spec/toolchain/`
  - 决定项目“应该怎样 build / run / debug”
- `VOS Runtime`
  - 是 `vos` 的实现体系
  - 存放在 `docs/design/toolchain/` 中进行设计
  - 决定“如何读取 spec、如何选择 adapter、如何执行命令、如何采集证据”

因此：

```text
ToolchainSpec = 项目构建真相
VOS Runtime   = 规范消费与执行编排器
```

## 2. `vos` vs 任意 shell

`vos` 不是任意 shell 包装器。它必须：

- 暴露固定子命令，而不是任意命令转发
- 对路径、阶段、spec 绑定和可见性做检查
- 把输出整理成稳定 JSON 与 evidence
- 记录命令、参数、产物、日志、失败类型

它不能：

- 允许 Agent 自由执行 `rm`、`curl`、`bash -c`
- 绕过测试和 invariant checker
- 直接读取 hidden tests 源码

## 3. 本地公开能力 vs 云端私有验证

本地 `vos` 可以看到：

- 本地 `spec/`
- 学生源代码
- 公开测试与派生测试
- 公开阶段约束投影
- agent-only 约束摘要

本地 `vos` 不可以看到：

- hidden tests 源码
- mutation plan 细节
- anti-gaming 规则细节
- staff-only grading policy

平台可以通过 `verify full` 或云端专用接口执行完整验证，但其结果回流给学生时只能返回摘要与 verdict，不返回私有规则细节。

## 4. Agent 辅助开发 vs 自动代写 OS

Agent 在本体系中的角色是“受控协作开发者”，而不是自由代码生成器。要求：

- Agent 通过 `vos agent *` 与 `vos` 子命令工作
- patch 必须绑定本地 spec 或 `SpecPatch`
- 关键改动必须触发最小验证集
- 所有 Agent 行为进入审计日志

Agent 不得：

- 规避 spec-first 和 validation-first 约束
- 关闭检查器或删除测试
- 以“回答文本”替代 evidence

## 5. 角色与权限

```text
student:
  可运行 build/test/verify public/report
  可查看公开与生成测试结果
  不可查看 hidden tests 源码

agent:
  可通过 vos 执行受控命令
  可读取本地 spec/
  可读取云端 agent-only 约束摘要
  不可删除测试和 invariant checker
  不可读取未授权云端内容

teacher:
  可配置课程规则、rubric、hidden tests、judge policy

ci:
  可执行完整验证
  可写入 evidence 和 judge result
```

## 6. Policy 模型

`vos-policy` 负责执行命令白名单、路径白名单和可见性规则。示例：

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

- [02-architecture.md](./02-architecture.md)
- [07-agent-gateway.md](./07-agent-gateway.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
