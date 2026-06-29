# Lab 7: 资源模型与 ABI — 将系统能力暴露给用户

## 1. 设计问题

这是你架构设计中的核心分叉点。你需要决定：**你的 OS 如何将系统能力（文件、设备、IPC、进程控制）暴露给用户程序？**

不同于前 6 个阶段（有相对统一的"正确做法"），本阶段你的设计选择会从根本上塑造你的 OS 的性格。Unix-like？Capability-based？Service-IPC？你的选择将定义后续一切用户态编程的形态。

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 资源抽象范式 | 资源如何命名？如何传递？如何回收？权限如何控制？ |
| Syscall ABI | 调用约定？参数传递？错误表示？编号空间分配？ |
| 用户编程界面 | 提供什么标准库？syscall 包装的形态？ |
| Shell | 命令解析模型？程序启动方式（fork+exec/spawn）？I/O 重定向？ |
| IPC | 进程间如何通信？Pipe？消息？共享内存？ |
| 多核并发 | fd 表如何保护？Pipe 的 sleep/wakeup 在多核下正确吗？引用计数是否原子操作？ |

## 3. 背景阅读

- 至少两种不同范式的参考系统文档（如 xv6 和 seL4）
- [Spec: GoalValidationContract 编写指南](../specs/goal-validation-contract.md)
- [Spec: CompositionSpec 编写指南](../specs/architecture-composition-spec.md)
- [附录：不变量检查器编写指南](../appendices/invariant-checker.md)

## 4. 规格要求

### 4.1 ArchitectureSlice(resource)（必做）

`spec/architecture/slices/06-resource.yaml`

### 4.2 ADR（必做）

资源范式选择是阶段 7 最重要的 ADR，记录：
- 你的选择
- 替代方案
- tradeoff
- 选择理由

### 4.3 ModuleSpec（必做）

- 资源管理模块
- Syscall ABI 定义
- 用户库（libc 子集）
- IPC 模块（如适用）

### 4.4 OperationContract（必做）

根据你的范式编写关键操作的契约。

### 4.5 GoalValidationContract（必做，full contract）

这是阶段 7 的强制性产出。你的 contract 必须包含：
- `correctness_guard`：最少 3 条不可牺牲的正确性要求
- `target`：最少 2 个可量化的目标
- `benchmark_or_oracle`：每个 target 的验证方式
- `negative_tradeoff_checks`：最少 2 条不可接受的代价

### 4.6 CompositionSpec（必做，更新）

新增至少 1 条跨组件规则，描述资源模型与文件系统或进程模型的组合不变量。

## 5. 质量门禁

### 公共门禁

```bash
vos spec lint
vos build
vos test --suite resource
vos verify public
```

- [ ] 资源可创建、使用和销毁
- [ ] 资源可跨进程共享（按你的范式）
- [ ] 进程退出后资源被回收
- [ ] 多 CPU 同时 open/close 无 fd 泄漏；pipe 并发读写无 lost wakeup（多核）
- [ ] Shell 可启动并运行

### 个性化门禁

```bash
vos verify full --target goal    # 验证你的 GoalValidationContract
```

- [ ] correctness_guard 全部通过
- [ ] benchmark 达标
- [ ] negative_tradeoff_checks 未触发

## 6. 设计理据要求

1. 你选择的资源范式的核心设计理念是什么？为什么它适合你的 OS？
2. 如果你选择了 fd-based，你的实现与 Unix 有什么不同？如果你选择了其他范式，你借鉴了哪个系统的设计？
3. 你的 syscall ABI 中，哪个 syscall 的设计最让你纠结？为什么？
4. 你的 Shell 是一个真正的用户程序（需要 fork+exec 来运行外部命令）吗？如果不是，缺少了什么机制？

## 7. AI 使用边界

- 允许让 AI 审查你的 Shell 命令解析器的正确性
- 禁止在不写 GoalValidationContract 的情况下直接进入实现

## 8. 提交物

- ArchitectureSlice(resource)
- ADR（资源范式选择）
- ModuleSpec + OperationContract
- GoalValidationContract (full)
- 更新的 CompositionSpec
- 实现源码（资源管理、syscall ABI、libc、Shell、IPC）
- GoalValidationContract 验证报告

（进阶方向：实现 `/dev`、`/proc` 等统一资源命名系统；扩展 Shell 支持脚本顺序执行；实现后台执行 `&` 和作业管理 `jobs`/`fg`/`bg`；实现消息队列、信号量或共享内存等高级 IPC 机制。）
