# Lab 8: 个性 OS 多维剖面 — 方向组合与自主进化

## 1. 设计问题

你的 OS 已经完整。现在定义它的剖面：**它为什么而存在？在哪些维度上具有独特性？**

阶段 8 不是"选一个附加项目"。它是你从阶段 1 ArchitectureSeed 到现在的设计闭环——你的剖面是你所有设计判断的最终表达。

## 2. 方向簇与可选方向

方向按探索维度分为六大簇。你可以选择**任意数量**的方向（1 个、3 个、5 个都允许）。你的剖面由你选择的方向、每个方向的深度、方向间的融合关系定义。

| 编号 | 簇 | 方向 | 关键验证 | 难度 |
|------|:--:|------|---------|:--:|
| F1 | 功能扩展 | 网络栈 | ping 通，UDP echo | 中 |
| F3 | 功能扩展 | 图形界面 (GUI) | 屏幕显示彩色矩形和文字 | 中 |
| H1 | 硬件驱动 | USB 外部设备驱动 | 枚举 USB 键盘，捕获按键 | 高 |
| H2 | 硬件驱动 | PCI 总线枚举与设备驱动 | 枚举所有 PCI 设备并打印 | 高 |
| C1 | 兼容实现 | Linux ext2 rootfs Shell | 从 ext2 磁盘镜像（virtio-blk）启动交互式 /bin/sh | 高 |
| C2 | 兼容实现 | POSIX 源码兼容 | dash/sbase 移植后运行 | 中 |
| C3 | 兼容实现 | 多 ISA 移植 | 同一程序在两 ISA 上运行 | 中 |
| C4 | 兼容实现 | Windows NT PE 二进制兼容 | hello.exe 输出并退出 | 极高 |
| C5 | 兼容实现 | macOS Mach-O 二进制兼容 | Mach-O hello 输出并退出 | 极高 |
| O1 | 专项优化 | 实时性与确定性 | 中断延迟 P99 < 50μs | 中 |
| O2 | 专项优化 | 极小足迹 | 内核 < 64 KB | 中 |
| O3 | 专项优化 | 高吞吐 I/O | 吞吐量达到基线 2× | 中 |
| O4 | 专项优化 | 安全加固 | fuzzer 无 crash | 中 |
| O5 | 专项优化 | 极速启动 | boot→Shell < 100ms | 中 |
| X1 | 前沿探索 | Unikernel 形态 | 按自行定义的目标 | 极高 |
| X2 | 前沿探索 | 形式化验证子集 | 某模块关键不变量得证 | 极高 |
| X3 | 前沿探索 | 多内核 (Multikernel) | 按自行定义的目标 | 极高 |
| X5 | 前沿探索 | eBPF 类内核 VM | 恶意字节码被 verifier 拒绝 | 极高 |
| A3 | 架构设计 | 异步运行时 | 10000 次异步 I/O 无 lost wakeup | 极高 |

> **注：** USB 和 PCI 统一使用 H1/H2，不再使用旧版功能扩展编号。

### 选题示例：从真实案例落到验证目标

| 真实案例 | 推荐方向 | 最小目标 | 验证方式 | 不建议写成 |
|----------|----------|----------|----------|------------|
| Rust for Linux / Tock / Theseus | O4 / A1 / H1 | 给一个驱动或资源对象标出 `unsafe` 边界，并把安全接口包起来 | `unsafe` 块有说明；越界 MMIO 或释放后回调被拒绝 | "用 Rust 重写内核" |
| CHERI / CheriBSD | F10 / O4 / C3 | 实现软件 capability buffer，所有 `copyin`/`copyout` 走 base/length/permission 检查 | 越界和权限错误返回失败；权限降级不可恢复 | "支持 CHERI 架构" |
| Verus / Atmosphere | X2 | 验证一个页状态转换函数保持核心不变量 | 工具证明通过，或提交等价规格、状态表和运行时断言 | "形式化验证整个内核" |
| Linux EEVDF | O1 | 实现玩具版虚拟 deadline 调度器 | CPU 占比接近权重；交互进程 P95 唤醒延迟下降 | "实现 Linux 调度器" |
| eBPF verifier | X5 | 解释执行最小字节码，并在加载前拒绝危险程序 | 无限循环、越界栈访问、未初始化读取被拒绝 | "直接做 JIT" |
| MirageOS / Unikraft | X1 / O2 / O5 | 单一镜像 hello/echo，与传统 syscall 版本对比 | 镜像大小、启动时间、调用延迟三项对比 | "把用户程序当内核线程跑" |

## 3. 背景阅读

- [Book 第 8 章](../book/ch08-personal-goal.md) — 六大方向簇、方向组合指南、现代案例库、剖面设计指南
- [Spec: GoalValidationContract](../specs/goal-validation-contract.md) — ProfileSpec 与方向级 Contract 的完整格式

## 4. 任务

### Task 1: 定义你的方向剖面

1. 从方向表中选择你感兴趣的方向（数量不限）
2. 对每个方向，声明深度等级：
   - **explore**：完成建议步骤的前 1-2 步（2-5 天）
   - **mastery**：完成全部建议步骤（1-3 周）
   - **breakthrough**：在建议步骤之外有原创性探索（3+ 周）
3. 写出每个方向的理由：它和你的 ArchitectureSeed 的关联是什么？你想通过这个方向学到什么？
4. 声明方向间的融合关系（⊞ 互补 / ∥ 独立 / ⊗ 冲突 / ⨝ 交织）
5. 编写 ProfileSpec（模板见 Book 8.4.2）

**重要：** 1 个方向做到 mastery 比 3 个方向全是 explore 更有教学价值。剖面反映的是设计判断力，不是代码量。

### Task 2: 编写 GoalValidationContract

对**每个方向**编写独立的 GoalValidationContract（格式见 [GoalValidationContract 编写指南](../specs/goal-validation-contract.md)）：

- baseline：起点（可测量）
- target：目标（可测量）
- correctness_guard：不可破坏的底线
- benchmark_or_oracle：验证方式
- negative_tradeoff_checks：不可接受的代价

如果选了 2+ 方向，额外编写**剖面级 Contract**：
- cross_direction_invariants：跨方向组合不变量（至少 1 条）
- 融合关系声明

### Task 3: 按剖面逐步实现

1. 分析方向间的依赖关系：先做基础设施方向（如 H2 PCI 先于 H1 USB 和 F1 网络）
2. 对每个方向按建议步骤逐步实现
3. 每完成一个里程碑（如"ping 通"），立刻验证
4. 不要所有方向全写完再测——增量验证

### Task 4: 验证

```bash
# 逐方向验证
vos verify full --target <direction_id>

# 剖面整体验证（包含跨方向不变量检查）
vos verify full --target profile
```

## 5. 质量门禁

### 逐方向门禁

- [ ] 每个方向的 correctness_guard 全部通过
- [ ] 每个方向的 benchmark 达标
- [ ] 每个方向的 negative_tradeoff 未触发

### 剖面级门禁

- [ ] ProfileSpec 完整且逻辑自洽
- [ ] 方向间融合关系有明确声明和理据
- [ ] 跨方向组合不变量全部通过（至少 1 条）
- [ ] 所有已有公开测试继续通过

### 深度门禁

- [ ] explore 级：至少 run 通基础验证
- [ ] mastery 级：完成该方向全部建议步骤
- [ ] breakthrough 级：产出超出建议步骤的原创探索，有 ADR 记录

## 6. 设计理据

1. 你选择的每个方向与 ArchitectureSeed 的关联是什么？如果有转向，为什么？
2. 方向组合中哪个关系最让你意外？（如你原以为互补的两个方向实际存在潜在的冲突）
3. 如果重来，你会调整什么？（深度？方向数量？融合方式？）
4. 你的剖面中最有价值的交叉点在哪里？（哪个跨方向不变量揭示了你设计中最重要的洞察？）

## 7. 提交物

- `spec/goal/profile.yaml` — ProfileSpec
- `spec/goal/<direction_id>.yaml` — 每个方向的 GoalValidationContract
- 实现代码
- `vos verify full --target profile` 完整输出
- 剖面验证报告（包含跨方向不变量证据）
- 更新的 AI 协作日志
