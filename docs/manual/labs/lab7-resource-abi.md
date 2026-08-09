# Lab 7：资源模型与 ABI——把系统能力交给用户

> **对应教材**：[第 7 章：资源与 ABI](../book/ch07-resource-abi.md)

> **本 Lab 概览**
>
> - **学完能做什么**：把文件、pipe、设备和未来 IPC 收敛为一个可解释的资源模型，实现句柄生命周期、引用计数与退出回收，并用一个可交互 shell 串起前六个 Lab 的成果。
> - **预计耗时**：12–16 小时，建议安排 1–2 周。资源表与引用计数约占一半，pipe、shell 与回收测试占另一半。
> - **前置依赖**：已完成 Lab 6（文件系统可用），阅读第 7 章。
> - **产出物**：resource ModuleSpec、`spec/interfaces/resource.yaml`、实现与 shell 演示、泄漏/并发证据、错误码测试。

## 1. 设计问题

- 句柄是进程局部索引、全局对象 ID，还是带权限的 capability？
- `dup`、fork/继承、跨进程传递分别复制什么？
- 最后一个引用消失时，谁执行销毁和设备关闭？
- 阻塞 read/write 如何被唤醒，中断和进程退出如何打断等待？
- ABI 如何表达类型、权限、错误和版本？

重点是句柄生命周期、共享规则、错误码和退出回收。前六个 Lab 各自实现的系统能力，从本 Lab 开始统一到一张资源表上。

## 2. 实施范围

至少完成资源表、引用计数、文件描述符操作、pipe 和一个可交互 shell。资源对象的内部状态放入 ModuleSpec；syscall、pipe 端点或跨模块驱动接口放入 InterfaceSpec。

推荐按以下顺序推进：

1. 单进程 open/close 与无泄漏回收；
2. `dup` 和共享 offset 语义；
3. pipe 缓冲、阻塞、EOF 与 broken pipe；
4. 进程退出时批量回收；
5. shell 的命令执行、重定向和管道；
6. 多核并发 open/close 与 pipe 压力。

**自检点（每步）**：上一步的资源表在压力测试后无泄漏，再进行下一步。第 4 步完成后，反复创建并退出进程，句柄与对象计数必须回到基线。

## 3. 当前契约映射

```sh
vos agent spec resource
vos spec check
vos agent implement resource
vos agent review resource
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

## 5. 设计理据

解释句柄表示、共享范式、引用计数与销毁时机。若选择 capability 模型，还要说明权限衰减和不可伪造性；若选择 Unix fd 模型，要说明进程表与全局对象表的边界。

## 6. AI 使用边界

Agent 可以审查生命周期状态机、生成并发测试和解释泄漏日志。学生必须决定 ABI 和共享语义。不要让 Agent 通过跳过回收或放宽权限检查来制造通过。

## 7. 提交物

- [ ] resource ModuleSpec；
- [ ] `spec/interfaces/resource.yaml`；
- [ ] 实现与公开测试；
- [ ] shell 演示记录；
- [ ] 泄漏/并发证据；
- [ ] 错误码测试；
- [ ] 必要 SpecPatch。

## 8. 常见问题与排查

### `dup` 后关闭一个 fd 导致另一个失效

把描述符槽和底层对象引用混为一谈。`dup` 只复制 fd 表项，底层对象引用应递增；关闭一个 fd 只递减引用，引用归零才销毁对象。

### pipe 两端关闭后读者永久睡眠

关闭路径没有唤醒等待队列。close 端点时要唤醒所有在该 pipe 上等待的读者和写者，并让它们看到 EOF 或 broken pipe 错误。

### 进程退出后对象泄漏

只释放了 fd 表，没有递减底层对象引用。退出回收要遍历进程资源表，对每个底层对象递减引用，引用归零时触发销毁与设备关闭。

## 9. 背景阅读

- [Book 第 7 章：资源与 ABI](../book/ch07-resource-abi.md)：资源模型范式的完整背景。
- [ModuleSpec](../specs/module-spec.md) 与 [InterfaceSpec](../specs/overview.md)：模块与接口契约写法。
- [SpecPatch](../specs/spec-patch.md)：跨模块语义变化的手写契约。
- [调试方法论](../appendices/debugging-methodology.md)：死锁与泄漏排查。
