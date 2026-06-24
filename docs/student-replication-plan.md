# 学生复刻 xv6-spec 全流程验证 v2 — 执行记录

> **角色**: OS 课程学生 | **环境**: Bun + RISC-V 工具链 + QEMU + DeepSeek API
> **独立仓库**: `/home/wzh/student-lab/` | **已清理**: .vos/runs/, build/, cache/
> **开始时间**: 2026-06-24

---

## 前置确认

- ✅ DEEPSEEK_API_KEY 可用
- ✅ RISC-V 工具链已验证
- ✅ Bun ≥ 1.3

---

## 每阶段统一流程

每个阶段按以下步骤执行，不再区分"主体"和"补测"：

| Step | 名称 | 命令 | 适用条件 |
|------|------|------|---------|
| A | Spec 审查裁剪 | 复制 spec → 编辑集成文件 → `spec lint` + `spec check-consistency` | 每阶段 |
| B | Toolchain 验证 | `toolchain lint` + `build generate` | Phase 1+ |
| C | 架构检查 | `arch lint` + `arch compose` | 每阶段 |
| D | Agent 生成 | `agent plan` → `agent generate --apply` | 每阶段 |
| E | 构建 | `build --dry-run` → `build` | 每阶段 |
| F | 运行 | `run qemu` | 每阶段 |
| G | 调试（条件） | `debug explain-log` | QEMU 失败时 |
| H | 验证 | `verify public` | Phase 3+（需 verify.sh） |
| I | 错误注入 | 注入学生常见错误 → 验证检测 → 修正 | 每阶段 |
| J | 知识库 | `kb add/list/search` | Phase 1+ |
| K | Agent 辅助 | `agent validate-generated` / `agent ask` / `agent review-spec` / `agent log` | 按需 |
| L | 记录 | ledger record → 更新本文档 | 每阶段 |

Phase 4-9 额外命令：

| Phase | 额外命令 | 场景 |
|-------|---------|------|
| 4 | `test --suite` | 助教要求只跑 fork 测试 |
| 5 | `trace syscall` + `agent apply-patch` | 追踪系统调用 + 应用补丁 |
| 6 | `verify full` + `kb search` | 全量验证 + 知识库搜索 |
| 7 | `spec patch lint` + `spec patch apply` | 应用课程 spec 更新 |
| 8 | `verify invariant` | 设备驱动不变量检查 |
| 9 | `verify fuzz/generated` + `report generate --final` + `submit pack` | 期末汇总提交 |

---

## 执行状态

| Phase | 状态 | 备注 |
|-------|------|------|
| 0 | ⬜ 重跑 | 项目已在 `/home/wzh/student-lab/`，跳过 init |
| 1 | 🔄 执行中 | boot 阶段全量重跑 |
| 2 | ⬜ | memory 阶段 |
| 3 | ⬜ | trap 阶段 |
| 4 | ⬜ | process 阶段 |
| 5 | ⬜ | syscall 阶段 |
| 6 | ⬜ | filesystem 阶段 |
| 7 | ⬜ | ipc 阶段 |
| 8 | ⬜ | device 阶段 |
| 9 | ⬜ | full-syscall 阶段 + 最终汇总 |

---

## Phase 0: 项目初始化（已就绪）

项目已在独立 repo `/home/wzh/student-lab/`，含完整 spec + kernel + Makefile + .vos 配置。
当前状态：Phase 3 代码就绪，`.vos/runs/` + `build/` + cache 已清理。

跳过 `vos init`，直接从 Phase 1 开始重跑。

---

## Phase 1: Boot Stage

### Step A: Spec 审查裁剪
- [ ] A1 审查 seed.yaml → goals 仅保留 boot banner
- [ ] A2 审查 timeline.yaml → 仅保留 boot stage
- [ ] A3 审查 kernel_main.yaml → 仅调用 boot 操作（无 kinit/kvmmake/trap_init）
- [ ] A4 审查 build.yaml → link 仅含 entry.o + boot.o
- [ ] A5 审查 public-matrix.yaml → 仅 verify-boot-banner
- [ ] A6 `.vos/project.yaml` current_stage: boot
- [ ] A7 `vos spec lint`
- [ ] A8 `vos spec check-consistency`

### Step B: Toolchain 验证
- [ ] B1 `vos toolchain lint`
- [ ] B2 `vos build generate`
- [ ] B3 检查 `.vos/toolchain.json` 内容完整

### Step C: 架构检查
- [ ] C1 `vos arch lint`
- [ ] C2 `vos arch compose spec/architecture/seed.yaml`

### Step D: Agent 生成
- [ ] D1 `vos agent plan --stage boot`
- [ ] D2 `vos agent generate --apply`
- [ ] D3 检查生成代码（entry.S, boot.c, kernel.ld, Makefile）
- [ ] D4 `vos agent validate-generated --target kernel/boot`

### Step E: 构建
- [ ] E1 `vos build --dry-run`
- [ ] E2 `vos build`（如失败则 make clean all 手动构建）
- [ ] E3 记录编译问题及修复

### Step F: 运行
- [ ] F1 `vos run qemu --case boot-smoke`
- [ ] F2 如失败 → `debug explain-log` 分析日志
- [ ] F3 确认 `XV6_BOOT_OK` 出现在输出

### Step G: 验证
- [ ] G1 创建 `tests/public/verify.sh`（boot 阶段仅含 banner 测试）
- [ ] G2 `vos verify public --dry-run`
- [ ] G3 `vos verify public`

### Step H: 错误注入
- [ ] H1 注入: boot_banner 返回错误字符串（无 XV6_BOOT_OK）
- [ ] H2 `vos run qemu --case boot-smoke` → 预期 failed
- [ ] H3 修正并重新验证通过

### Step I: 知识库
- [ ] I1 `vos kb add spec/modules/kernel/boot/ --source-kind project --recursive`
- [ ] I2 `vos kb list`
- [ ] I3 `vos kb search "boot_banner"`

### Step J: Agent 辅助
- [ ] J1 `vos agent ask --stage boot "boot 阶段 console_putchar 为什么使用 SBI ecall 而不是直接写 UART 寄存器？"`
- [ ] J2 `vos agent review-spec --target spec/modules/kernel/boot/ops/kernel_main.yaml`
- [ ] J3 `vos agent log`

### Step K: 记录
- [ ] K1 `vos ledger record`
- [ ] K2 更新本文档 + checklist

---

## Phase 2: Memory Stage

### Step A: Spec 审查裁剪
- [ ] A1 添加 memory/lock/string/vm/headers 模块 spec
- [ ] A2 更新 timeline.yaml → 添加 memory + 后续全部 stage
- [ ] A3 更新 kernel_main.yaml → 添加 kinit + kvmmake 调用
- [ ] A4 更新 build.yaml → 添加 memory.o, lock.o, string.o, vm.o
- [ ] A5 更新 public-matrix.yaml → 添加 verify-page-allocator, verify-kernel-page-table
- [ ] A6 `.vos/project.yaml` current_stage: memory
- [ ] A7 `vos spec check-consistency`
- [ ] A8 `vos spec normalize`

### Step B: Toolchain 验证
- [ ] B1 `vos build generate`

### Step C: 架构检查
- [ ] C1 `vos arch lint`
- [ ] C2 `vos arch compose spec/architecture/seed.yaml`
- [ ] C3 `vos arch derive-tests spec/architecture/seed.yaml`

### Step D: Agent 生成
- [ ] D1 `vos agent generate --apply`
- [ ] D2 `vos agent validate-generated --target kernel/memory`

### Step E: 构建
- [ ] E1 构建 → 修复编译/链接问题

### Step F: 运行
- [ ] F1 `vos run qemu --case boot-smoke`

### Step G: 验证
- [ ] G1 更新 verify.sh 添加 memory 测试
- [ ] G2 `vos verify public`

### Step H: 错误注入
- [ ] H1 注入: kalloc 返回未对齐地址
- [ ] H2 验证检测 → 修正

### Step I: 知识库
- [ ] I1 `vos kb add spec/modules/kernel/memory/ --source-kind project --recursive`
- [ ] I2 `vos kb search "page table"`

### Step J: Agent 辅助
- [ ] J1 `vos agent ask --stage memory "Sv39 page table walk 如何工作？"`

### Step K: 记录
- [ ] K1 更新文档

---

## Phase 3: Trap Stage

### Step A: Spec 审查裁剪
- [ ] A1 添加 trap + process 模块 spec
- [ ] A2 更新 kernel_main.yaml → 添加 trap_init 调用
- [ ] A3 更新 build.yaml → 添加 trap.o, proc.o
- [ ] A4 `.vos/project.yaml` current_stage: trap
- [ ] A5 `vos spec check-consistency`

### Step B-D: Agent 生成 + 构建 + 运行
- [ ] B1 `vos agent generate --apply`
- [ ] B2 构建 → 添加桩函数修复链接
- [ ] B3 `vos run qemu --case boot-smoke`

### Step E: 验证
- [ ] E1 更新 verify.sh 添加 trap 测试
- [ ] E2 `vos verify public`

### Step F: 错误注入
- [ ] F1 注入: trap_init 未设置 stvec
- [ ] F2 验证 → 修正

### Step G: Agent 辅助
- [ ] G1 `vos agent review-spec --target spec/modules/kernel/trap/ops/trap_init.yaml`

### Step H: 记录

---

## Phase 4: Process Stage

### 核心流程
- [ ] A 审查 spec → 更新 kernel_main (proc_init + userinit + scheduler)
- [ ] B `vos toolchain lint` + `vos build generate`
- [ ] C `vos arch lint` + `vos arch compose`
- [ ] D `vos agent generate --apply`
- [ ] E 构建 → 移除 trap.c 桩函数
- [ ] F `vos run qemu --case boot-smoke`
- [ ] G 更新 verify.sh → `vos verify public`
- [ ] H 错误注入: fork 后内存共享
- [ ] I **`vos test --suite fork_returns_different_pid`**

---

## Phase 5: Syscall Stage

- [ ] A-D 标准流程
- [ ] E `vos agent validate-generated --target kernel/syscall`
- [ ] F 错误注入: sys_write 未验证用户指针
- [ ] G **`vos trace syscall`**
- [ ] H **`vos agent apply-patch`**

---

## Phase 6: Filesystem Stage

- [ ] A-D 标准流程（bio/log/fs/file/exec）
- [ ] E **`vos verify full`**
- [ ] F 错误注入: bread 未初始化
- [ ] G **`vos kb search "inode"`**

---

## Phase 7: IPC Stage

- [ ] A-D 标准流程（pipe）
- [ ] E 错误注入: pipe close 未唤醒
- [ ] F **`vos spec patch lint`** + **`vos spec patch apply`**

---

## Phase 8: Device Stage

- [ ] A-D 标准流程（uart/plic/virtio/console/printk）
- [ ] E 错误注入: UART 初始化遗漏
- [ ] F **`vos verify invariant --target kernel/uart`**

---

## Phase 9: Full-Syscall + 最终汇总

- [ ] A-D 标准流程（sysfile/sysproc + user 完整）
- [ ] E `vos run qemu --case usertests` → ALL TESTS PASSED
- [ ] F **`vos verify fuzz --target kernel/sysfile`**
- [ ] G **`vos verify generated --target kernel/sysfile`**
- [ ] H **`vos report generate --final`**
- [ ] I **`vos submit pack`**
- [ ] J **`vos agent log`**（查看全流程 agent 记录）

---

## 工具链不足汇总

（每阶段执行时追加）
