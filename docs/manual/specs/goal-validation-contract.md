# GoalValidationContract & ProfileSpec 编写指南

GoalValidationContract 回答：**我的（单个方向）目标是什么？成功标准是什么？如何验证？代价是什么？**

ProfileSpec 回答：**我的 OS 剖面由哪些方向组成？它们之间的关系是什么？组合不变量是什么？**

## 何时需要

| 阶段 | 所需规格 | 说明 |
|------|---------|------|
| 阶段 1-6 | Mini Contract（可选） | 非平凡选择时（如全新调度算法）可声明 mini contract |
| 阶段 7 | Full Contract | 非 fd-based 路线时必须 full contract |
| 阶段 8 | **ProfileSpec + 每条方向 Full Contract** | 所有学生必做 |
| 阶段 9 | Full Contract | 硬件移植必做 |

---

## 一、单方向 GoalValidationContract

### Mini vs Full Contract

| 维度 | Mini Contract | Full Contract |
|------|:---:|:---:|
| 适用阶段 | 1-6 | 7-9 |
| baseline | 可选 | 必填 |
| target | 可选 | 必填 |
| correctness_guard | 可选（隐含于阶段质量门禁） | 必填 |
| benchmark_or_oracle | 可选 | 必填 |
| negative_tradeoff_checks | 可选 | 必填 |

### Full Contract 完整字段

```yaml
direction_id: "C1"
category: "compatibility"  # feature | compatibility | optimization | hardware | frontier
depth: "mastery"           # explore | mastery | breakthrough
summary: "使内核能够从 ext2 磁盘镜像（通过 virtio-blk）加载 rootfs，并启动其中的 Linux/RISC-V 静态编译 Shell (busybox sh)"

# baseline：你的起点
baseline:
  description: "当前内核只能加载自定义格式的用户程序，无 ext2 和块设备 rootfs 支持"
  metrics:
    - name: "supported_exec_format"
      value: "custom_flat"
    - name: "linux_elf_supported"
      value: false
    - name: "ext2_rootfs_supported"
      value: false
    - name: "virtio_blk_working"
      value: false

# target：你的目标
target:
  description: "内核通过 virtio-blk 读取 ext2 磁盘镜像，挂载 rootfs，从 /bin/sh 启动交互式 Shell"
  metrics:
    - name: "supported_exec_format"
      value: "linux_elf_static"
    - name: "linux_elf_supported"
      value: true
    - name: "virtio_blk_working"
      value: true
    - name: "ext2_rootfs_mounted"
      value: true
    - name: "shell_interactive"
      value: true
    - name: "busybox_commands_working"
      value: ["ls", "cat", "echo", "sh", "pwd", "wc"]

# correctness_guard：不可牺牲的正确性底线
correctness_guard:
  - "不破坏已有自定义格式程序的加载和执行"
  - "ELF 加载器必须验证 ELF header 的完整性，拒绝格式错误的文件"
  - "ELF 加载器不能有缓冲区溢出漏洞"
  - "ext2 驱动不能因恶意构造的磁盘镜像而 panic 或 corrupt 内核内存"
  - "不改动现有 syscall ABI 的编号和语义"

# benchmark_or_oracle：如何衡量成功
benchmark_or_oracle:
  - name: "virtio_blk_read"
    description: "virtio-blk 驱动能读取磁盘扇区，识别 ext2 superblock magic (0xEF53)"
    pass_condition: "读取的扇区偏移 0x38 处为 0xEF53"
  - name: "ext2_root_dir"
    description: "ext2 驱动能遍历根目录，ls /bin 列出 busybox 命令"
    pass_condition: "QEMU 串口输出包含 busybox 命令列表（从真实磁盘镜像读取）"
  - name: "shell_launch"
    description: "内核从 ext2 rootfs 启动 /bin/sh，出现交互式提示符"
    pass_condition: "串口输出 Shell 提示符（如 '$ ' 或 '# '），可输入命令"
  - name: "shell_commands"
    description: "在 Shell 中执行 ls/cat/echo/pwd 均返回正确结果"
    pass_condition: "每个命令的输出与 Linux 上运行结果一致"
  - name: "ext2_persistence"
    description: "重启后通过 Shell 创建的文件仍存在（如果是 ext2 写支持）"
    pass_condition: "echo hello > /tmp/test && reboot → 重启后 cat /tmp/test 输出 hello"

# negative_tradeoff_checks：检查你是否为了目标牺牲了不该牺牲的东西
negative_tradeoff_checks:
  - name: "kernel_size_regression"
    description: "添加 virtio-blk 驱动、ext2 驱动和 ELF 加载器后内核镜像大小"
    max_allowed: "kernel.bin < 400 KB"
  - name: "existing_tests_still_pass"
    description: "所有原有公开测试继续通过"
    max_allowed: "0 个原有测试失败"
  - name: "boot_time_regression"
    description: "从固件跳转到 Shell 提示符的时间"
    max_allowed: "增加不超过 50%（ext2 磁盘 I/O 有合理开销）"

# evidence_required：需要提交什么证据
evidence_required:
  - "QEMU 启动日志：从 virtio-blk 探测到 Shell 提示符的完整串口输出"
  - "ext2 superblock dump（读取的原始字节 + 解析结果）"
  - "原有公开测试矩阵的通过截图"
  - "内核镜像大小对比（添加 ext2 + virtio-blk 前后）"
  - "Syscall 追踪日志（Shell 启动过程中调用的全部 syscall 记录）"
  - "ext2 驱动和 ELF 加载器的 SpecPatch"
```

### 字段说明

#### correctness_guard

**这是 GoalValidationContract 中最重要的字段。** 它定义了方向的"安全底线"——你可以在哪些维度上自由发挥，但哪些东西绝对不能破坏。

例如，你要优化 syscall 性能，correctness_guard 应包含：
- "所有现有 syscall 的语义不变"
- "syscall 返回值对用户程序透明"
- "不引入竞态条件"

如果你的优化破坏了 correctness_guard 中的任何一项，即使性能提升达标，方向也算失败。

#### benchmark_or_oracle

定义可量化、可复现的成功标准。每个 benchmark 必须有明确的 pass_condition——不能是"感觉变快了"，必须是"延迟从 X 降到 Y"或"通过测试套件 Z"。

#### negative_tradeoff_checks

防止"为了目标不择手段"。典型检查：
- 内核镜像大小不能暴增
- 原有测试不能退化
- 启动时间不能显著增加
- 内存占用不能翻倍

#### depth（深度等级）

方向深度的三级定义：

| 深度 | 含义 | 典型工作量 | 验证要求 |
|------|------|-----------|---------|
| **explore** | 浅层探索：完成建议步骤的前 1-2 步 | 2-5 天 | 至少 1 个 benchmark 通过 |
| **mastery** | 深入掌握：完成全部建议步骤 | 1-3 周 | 全部 benchmark 通过 |
| **breakthrough** | 突破边界：在建议步骤之外有原创性探索 | 3+ 周 | 全部 benchmark + 原创贡献的 ADR |

---

## 二、ProfileSpec：多方向剖面规格

当你选择 2+ 方向时，需要额外编写 ProfileSpec。它定义方向间的融合关系和跨方向不变量。

### ProfileSpec 完整字段

```yaml
profile_id: "my-os-profile"
summary: "一句话描述你的 OS 剖面的独特价值"

directions:
  - id: "C1"
    depth: "mastery"
    reason: "验证我的资源模型设计的通用性——如果能从 ext2 磁盘镜像启动 Linux Shell，说明 ABI、文件系统和块设备层都足够完整"
    baseline:
      description: "当前只能加载自定义 flat binary，无 ext2 或块设备 rootfs 支持"
      metrics:
        - name: "linux_elf_supported"
          value: false
        - name: "ext2_rootfs"
          value: false
        - name: "virtio_blk_working"
          value: false
    target:
      description: "从 ext2 磁盘镜像（virtio-blk）启动 /bin/sh，获得交互式 Shell"
      metrics:
        - name: "linux_elf_supported"
          value: true
        - name: "ext2_rootfs_mounted"
          value: true
        - name: "shell_interactive"
          value: true
        - name: "busybox_commands_working"
          value: ["ls", "cat", "echo", "sh", "pwd", "wc"]

  - id: "F1"
    depth: "mastery"
    reason: "网络是阶段7 fd-based 模型的自然延伸"
    baseline:
      description: "当前状态"
      metrics:
        - name: "network_stack_exists"
          value: false
    target:
      description: "目标状态"
      metrics:
        - name: "network_stack_exists"
          value: true
        - name: "ping_reply"
          value: true

# 方向间融合关系
fusion_relationships:
  - directions: ["C1", "F1"]
    type: "complementary"  # complementary | independent | conflicting | intertwined
    description: "Linux 程序可通过我的网络栈通信——socket syscall 需在两个 ABI 中同时可用"

  - directions: ["C1", "O4"]
    type: "intertwined"
    description: "安全加固(包括 W^X 和 canary)必须覆盖 Linux ELF 加载路径"

# 跨方向组合不变量（必填至少 1 条）
cross_direction_invariants:
  - "从 ext2 磁盘镜像启动的 Linux Shell 不应绕过 F1 的 socket 权限检查"
  - "不受信任的 Linux ELF 程序不能通过构造恶意网络包破坏内核内存"
  - "O4 的 W^X 保护必须应用于 C1 从 ext2 rootfs 加载的所有 ELF 段"

# 剖面级 negative_tradeoff
negative_tradeoff_checks:
  - name: "kernel_image_size"
    description: "添加 C1+F1+O4 后内核镜像增长"
    max_allowed: "增长 < 80%"
  - name: "existing_tests"
    description: "已有公开测试"
    max_allowed: "100% 通过"
  - name: "boot_time"
    description: "启动时间"
    max_allowed: "增长 < 30%"
```

### fusion_relationships 字段

方向间的四种基本关系：

| 类型 | 符号 | 含义 | 叠加策略 | cross_direction_invariants |
|------|:----:|------|---------|:--------------------------:|
| **complementary** | ⊞ | 同时做有 1+1>2 的效果 | 深度交织 | **必填** |
| **independent** | ∥ | 各自独立，互不影响 | 并行推进，各自验证 | 建议填写 |
| **conflicting** | ⊗ | 目标之间存在内在矛盾 | 诚实声明取舍和优先级 | 记录冲突 |
| **intertwined** | ⨝ | 深度结合产生新性质 | 先分别验证，再交叉验证 | **必填** |

### cross_direction_invariants

跨方向不变量是剖面级别最重要的验证项。它定义："当方向 A 和方向 B 同时存在时，什么不变量必须成立？"

好的跨方向不变量：
- "C1 rootfs 中的 ELF 不能绕过 O4 的 W^X 保护" — 精确、可检查、揭露耦合点
- "C4 (NT PE) 和 C1 (Linux ELF rootfs) 共享同一个文件系统视图——通过 C1 Shell 创建的文件可被 C4 程序读取" — 定义了两个兼容层的交互语义

不好的跨方向不变量：
- "系统不崩溃" — 太笼统
- "C1 和 F1 都正确" — 这是两个方向的各自要求，不是"跨方向"的不变量

### 编写建议

1. **先写 reason，再写 target。** 为什么选这个方向？如果你说不清楚，你的剖面缺乏设计判断。
2. **fusion_relationships 不是可选项。** 如果你选了 2+ 方向，你必须声明它们之间的关系。如果关系是"互不影响"，就写 independent，但必须说明理由。
3. **cross_direction_invariants 是深度交织的标志。** 如果你不能写出至少 1 条跨方向不变量，你的方向可能只是简单堆砌。
4. **negative_tradeoff 要真诚。** 不要设你永远触不到的检查项。

---

## 三、验证命令

```bash
# 验证单个方向
vos verify full --target <direction_id>

# 验证整个剖面（包含跨方向不变量检查）
vos verify full --target profile

# 检查跨方向不变量（可手动触发）
vos verify full --target cross-invariants
```

---

## 四、常见问题

**Q: 我可以选 5 个方向全做 explore 吗？**
A: 可以，但不推荐。5 个 explore = 每个方向只碰了皮毛。1-2 个 mastery 比撒胡椒面更有教学价值。

**Q: 如果两个方向之间有冲突（⊗），我还需要写 cross_direction_invariants 吗？**
A: 不需要写"不变量"（因为组合不成立），但必须写"冲突声明"——说明冲突的本质和你选择的优先级。

**Q: 我的方向深度是 breakthrough，需要额外写什么？**
A: 需要一篇 ADR，记录你的原创贡献：你做了什么超出建议步骤的探索？结果是什么？失败了吗？（失败的 breakthrough 也是 valid 的，只要 ADR 诚实记录了过程和教训。）

**Q: 单方向的 GoalValidationContract 和 ProfileSpec 中的 baseline/target 重复了吗？**
A: 是的——允许重复。ProfileSpec 是剖面的"摘要视图"，单方向 Contract 是"详细视图"。在实际提交中，单方向 Contract 的 baseline/target 以详细版为准。
