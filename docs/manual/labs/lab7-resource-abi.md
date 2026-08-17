# Lab 7：资源模型与 ABI——把系统能力交给用户

> **对应教材**：[第 7 章：资源与 ABI](../book/ch07-resource-abi.md)

> **本 Lab 概览**
>
> - **学完能做什么**：把文件、pipe、设备和未来 IPC 收敛为一个可解释的资源模型，实现句柄生命周期、引用计数与退出回收，并用一个可交互 shell 串起前六个 Lab 的成果。
> - **预计耗时**：12–16 小时，建议安排 1–2 周。资源表与引用计数约占一半，pipe、shell 与回收测试占另一半。
> - **前置依赖**：已完成 Lab 6（文件系统可用），阅读第 7 章。
> - **产出物**：resource 与 pipe 两个 ModuleSpec、`spec/interfaces/resource.yaml`、实现与 shell 演示、泄漏/并发证据、错误码测试。
> - **评分构成**：质量门禁 70% + 设计理据 20% + 挑战/加分 10%（可选）。实际分值以教师公布为准。
> - **实际耗时**：在提交物里记录本次 Lab 实际投入小时数。

## 1. 设计问题

- 句柄是进程局部索引、全局对象 ID，还是带权限的 capability？
- `dup`、fork/继承、跨进程传递分别复制什么？
- 最后一个引用消失时，谁执行销毁和设备关闭？
- 阻塞 read/write 如何被唤醒，中断和进程退出如何打断等待？
- ABI 如何表达类型、权限、错误和版本？

重点是句柄生命周期、共享规则、错误码和退出回收。前六个 Lab 各自实现的系统能力，从本 Lab 开始统一到一张资源表上。

## 2. 实施范围

本 Lab 至少产出两个骨架：`kernel/resource` 模块（对象表/引用计数/回收）与 `kernel/pipe` 模块（pipe 作为资源模型的第一个实例）。资源对象的内部状态放入 ModuleSpec；syscall、pipe 端点或跨模块驱动接口放入 InterfaceSpec。

推荐按以下顺序推进：

1. 单进程 open/close 与无泄漏回收；
2. `dup` 和共享 offset 语义；
3. pipe 缓冲、阻塞、EOF 与 broken pipe；
4. 进程退出时批量回收；
5. shell 的命令执行、重定向和管道；
6. 多核并发 open/close 与 pipe 压力。

**自检点（每步）**：上一步的资源表在压力测试后无泄漏，再进行下一步。第 4 步完成后，反复创建并退出进程，句柄与对象计数必须回到基线。

## 3. 当前契约映射

```yaml
id: kernel/pipe
module: kernel/pipe
level: 3
purpose: TODO
owns: [TODO_IMPLEMENTATION_PATH, TODO_TEST_PATH]
interface: [TODO_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [TODO]
concurrency: { TODO_CONCURRENCY_FIELD: TODO }
rely: [TODO]
guarantee: [TODO]
algorithm_intent: TODO
```

```sh
vos agent ask "pipe 的资源生命周期、阻塞语义与 ABI 错误应如何分层表达？"
# 学生手写 spec/modules/kernel/pipe.yaml 并更新资源 ABI InterfaceSpec
vos spec lint kernel/pipe
vos agent review kernel/pipe
# 学生修改后再次 lint，并手动提交
vos spec lint kernel/pipe
git add spec/modules/kernel/pipe.yaml spec/interfaces spec/patches
git commit -m "[spec][pipe] Define Lab 7 resource ABI"
vos agent implement kernel/pipe
vos build
vos run qemu
vos verify
```

资源管理通常为 L3 ModuleSpec，至少声明对象表、引用计数、等待队列、锁顺序和销毁保证。`spec/interfaces/resource.yaml` 描述句柄格式、操作、错误码、继承和共享语义。跨 filesystem/process/resource 的变更必须先提交 SpecPatch，不能靠扩大 `owns` 绕过边界。

## 4. 质量门禁

- [ ] 资源可创建、使用、复制、关闭和最终销毁。
- [ ] 进程退出后无句柄、对象或等待者泄漏。
- [ ] `dup`、继承和共享 offset 与 InterfaceSpec 一致。
- [ ] pipe 并发读写不丢数据、不 lost wakeup，关闭端语义正确。
- [ ] 句柄越界、类型错误、权限不足和重复关闭返回稳定错误。
- [ ] shell 能启动程序、等待退出、处理重定向和至少一条管道。
- [ ] public/contract target 覆盖资源模块及 ABI Spec ID。
- [ ] `kernel/resource` 与 `kernel/pipe` 两个骨架都存在，`owns` 分别覆盖各自实现与测试。

## 5. 设计理据

解释句柄表示、共享范式、引用计数与销毁时机。若选择 capability 模型，还要说明权限衰减和不可伪造性；若选择 Unix fd 模型，要说明进程表与全局对象表的边界。resource 是通用机制，pipe 是首个实例：说清楚哪些保证来自 resource 模块，哪些是 pipe 特有的。

## 6. AI 使用边界

Agent 可以审查生命周期状态机、生成并发测试和解释泄漏日志。学生必须决定 ABI 和共享语义。不要让 Agent 通过跳过回收或放宽权限检查来制造通过。

## 7. 提交物

- [ ] `kernel/resource` ModuleSpec；
- [ ] `kernel/pipe` ModuleSpec；
- [ ] `spec/interfaces/resource.yaml`；
- [ ] 实现与公开测试；
- [ ] shell 演示记录；
- [ ] 泄漏/并发证据；
- [ ] 错误码测试；
- [ ] 实际耗时（一个整数小时数）；
- [ ] 必要 SpecPatch。

## 7a. 最小成功输出样例

运行 `vos run qemu` 进入 shell 后，执行 `echo hello | cat`（或等价命令），示例交互：

```text
$ echo hello | cat
hello
$ exit
```

对照门禁：

- shell 有提示符，能启动程序并等待退出（对应"shell 能启动程序"门禁）；
- 管道输出与预期一致（对应"至少一条管道"门禁）；
- `exit` 后进程退出、无句柄/对象泄漏（对应"退出后无泄漏"门禁）；
- 演示记录中的泄漏检查输出 0 泄漏。

## 8. 常见问题与排查

### 泄漏/死锁排查三连（对应 ch07 参考卡）

先确认现象属于泄漏还是死锁：泄漏通常表现为对象计数持续增长、可用资源归零；死锁表现为全体等待者永久睡眠。排查顺序：先打印对象表与引用计数（挂上计数 dump），再检查锁获取顺序（把每个锁的 acquire/release 记日志），最后核对等待队列的唤醒点。不要同时改多处锁逻辑，每次只验证一个假设。

### `dup` 后关闭一个 fd 导致另一个失效

把描述符槽和底层对象引用混为一谈。`dup` 只复制 fd 表项，底层对象引用应递增；关闭一个 fd 只递减引用，引用归零才销毁对象。

### pipe 两端关闭后读者永久睡眠

关闭路径没有唤醒等待队列。close 端点时要唤醒所有在该 pipe 上等待的读者和写者，并让它们看到 EOF 或 broken pipe 错误。

### 进程退出后对象泄漏

只释放了 fd 表，没有递减底层对象引用。退出回收要遍历进程资源表，对每个底层对象递减引用，引用归零时触发销毁与设备关闭。

## 9. 参考卡

- [Book 第 7 章：资源与 ABI](../book/ch07-resource-abi.md)：资源模型范式的完整背景。

资源句柄和用户可见 ABI 应隐藏具体设备对象。驱动、文件系统和平台 HAL 可以实现不同的对象操作，但用户态只看到稳定的句柄、权限、生命周期和错误语义。调试泄漏、死锁和 lost wakeup 时，记录对象 ID、引用计数、等待者类别和锁状态，不要记录用户缓冲区原文。

本 Lab 前文已经给出 ModuleSpec、InterfaceSpec 和 SpecPatch 的字段与边界。若资源接口需要接入新平台设备，先说明稳定 ABI 与平台实现之间的转换点，再决定是否需要跨模块变更。
