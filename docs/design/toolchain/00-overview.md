# 00 Overview

回答的问题：

- 为什么 VeriSpecOSLab 需要 `VOS Runtime`
- `vos` 在课程闭环中解决什么问题，不解决什么问题
- 参考 `specfs` 时应该借鉴什么，不应该照搬什么

上游依赖文档：

- [../spec/00-overview.md](../spec/00-overview.md)
- [../spec/01-layer-model.md](../spec/01-layer-model.md)

下游消费者：

- `vos-cli`
- `vos-runtime`
- `vos-agent`
- 平台 CI / DevBox 集成

## 1. 定位

`vos` 是 VeriSpecOSLab 的统一命令入口，其背后的实现叫 `VOS Runtime`。它不负责替学生写 OS，也不替学生定义项目该怎么构建，而是把本地 spec/、ToolchainSpec、云端课程约束投影和受控命令执行编排成一个可审计、可复现的开发与验证闭环。

统一入口示例：

```bash
vos init
vos stage show
vos spec lint spec/modules/kernel/memory/ops/kalloc.yaml
vos arch lint spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos build generate
vos build
vos run qemu
vos test
vos verify public
vos verify patch spec/evolution/patch-003.yaml
vos trace syscall
vos debug explain-log
vos agent serve
vos submit pack
```

## 2. 闭环

VeriSpecOSLab 的目标闭环是：

```text
Spec -> Agent -> Patch -> Build -> Test -> Verify -> Evidence -> Feedback
```

`VOS Runtime` 在其中负责：

- 读取本地 `spec/`
- 解析 `ToolchainSpec`
- 请求云端公开约束投影
- 执行 build / run / test / verify / trace / debug
- 为 Agent、学生和平台输出统一的结构化结果与证据

## 3. 主要目标

`VOS Runtime` 必须支持以下能力：

1. 为 Agent、学生 CLI 和平台 CI 提供稳定、结构化、可审计的命令接口。
2. 将 spec lint、arch lint、build、QEMU、test、verify、trace、debug、report 纳入统一执行模型。
3. 将每次 patch、测试和诊断绑定到本地 spec、证据和阶段约束。
4. 让课程平台、在线评测和本地 DevBox 复用同一入口。
5. 防止 Agent 绕过规格、测试、权限和审计要求。

## 4. 非目标

`VOS Runtime` 明确不做：

1. 不提供越过当前 StageGate 的完整系统生成。
2. 不允许无 Spec 直接生成核心模块实现。
3. 不暴露 hidden tests 源码、mutation 点和 anti-gaming 规则。
4. 不替代教师评分策略。
5. 不向学生暴露不受控 shell。
6. 不把 LLM prompt 当作唯一开发依据。

## 5. 与 `specfs` 的关系

设计中可以借鉴 `specfs` / SYSSPEC 的做法，但只借鉴方法，不借鉴其文件系统专用边界：

- 采用比模块总说明更细的操作级规格粒度
- 强调“规格演化先于代码演化”
- 将“规格消费 / 计划生成 / 执行验证”分层
- 把 test harness 作为独立 runtime 组件，而不是散落脚本

不直接迁移的内容：

- FUSE 文件系统领域模型
- Python 驱动的完整代码生成流水线
- 以 LLM 生成单模块 C 代码为中心的工作方式

## 6. 使用场景

典型使用者包括：

- 学生：执行 lint、build、run、test、verify public、report
- Agent：在受控命令集内读取上下文、制定计划、应用 patch、采集证据
- 平台 CI：执行完整验证与归档
- 教师：配置课程规则、隐藏验证和评分策略

## 相关文档

- [01-boundaries-and-roles.md](./01-boundaries-and-roles.md)
- [02-architecture.md](./02-architecture.md)
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md)
