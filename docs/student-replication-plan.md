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
| 0 | ✅ | 项目初始化完成（toolchain.json 修复，环境就绪） |
| 1 | ✅ | boot 阶段全量执行，9 项工具链不足已记录 |
| 2 | ⬜ | memory 阶段 |
| 3 | ⬜ | trap 阶段 |
| 4 | ⬜ | process 阶段 |
| 5 | ⬜ | syscall 阶段 |
| 6 | ⬜ | filesystem 阶段 |
| 7 | ⬜ | ipc 阶段 |
| 8 | ⬜ | device 阶段 |
| 9 | ⬜ | full-syscall 阶段 + 最终汇总 |

---

## Bootstrap: 项目初始化（已就绪）

项目已在独立 repo `/home/wzh/student-lab/`，含完整 spec + kernel + Makefile + .vos 配置。
当前状态：Phase 3 代码就绪，`.vos/runs/` + `build/` + cache 已清理。

跳过 `vos init`，直接从 Phase 1 开始重跑。

---

## Phase 1: Boot Stage ✅ 已完成

### Step A: Spec 审查裁剪
- [x] A1 审查 seed.yaml → goals 仅保留 boot banner
- [x] A2 审查 timeline.yaml → 仅保留 boot stage
- [x] A3 审查 kernel_main.yaml → 仅调用 boot 操作（无 kinit/kvmmake/trap_init） ✅ 已裁剪
- [x] A4 审查 build.yaml → link 仅含 entry.o + boot.o（非必须，Makefile 自动处理）
- [x] A5 审查 public-matrix.yaml → 仅 verify-boot-banner
- [x] A6 `.vos/project.yaml` current_stage: boot ✅
- [x] A7 `vos spec lint` ⚠️ 超时（LLM agent review）
- [x] A8 `vos spec check-consistency` ✅

### Step B: Toolchain 验证
- [x] B1 `vos toolchain lint` ✅
- [x] B2 `vos build generate` ⚠️ 超时（LLM agent）
- [x] B3 检查 `.vos/toolchain.json` 内容完整 ✅（手动补充 environment 字段）

### Step C: 架构检查
- [x] C1 `vos arch lint` ⚠️ 超时（LLM agent review）
- [x] C2 `vos arch compose spec/architecture/seed.yaml` ✅
- [x] C3 `vos arch derive-tests spec/architecture/seed.yaml` ✅

### Step D: Agent 生成
- [x] D1 `vos agent plan --stage boot` ✅ (~82s)
- [x] D2 `vos agent generate --apply` ✅ (~152s)
- [x] D3 检查生成代码 ✅ boot.c 正确添加 shutdown() 调用
- [x] D4 `vos agent validate-generated --target kernel/boot` ⚠️ 挂起

### Step E: 构建
- [x] E1 `vos build --dry-run` ✅
- [x] E2 `vos build` ✅ (~5s)
- [x] E3 记录编译问题及修复 ✅

### Step F: 运行
- [x] F1 `vos run qemu --case boot-smoke` ✅
- [x] F2 如失败 → 未触发
- [x] F3 确认 `XV6_BOOT_OK` 出现在输出 ✅

### Step G: 验证
- [x] G1 创建 `tests/public/verify.sh`（已存在）
- [x] G2 `vos verify public --dry-run` ⏭️ 未执行（Phase 3+ 需要）
- [x] G3 `vos verify public` ⏭️ 未执行

### Step H: 错误注入
- [x] H1 注入: _entry → _entr 符号错误 ✅ 检测到 LD warning
- [x] H2 注入: 移除 shutdown() ✅ build failed
- [x] H3 修正并重新验证通过 ✅

### Step I: 知识库
- [x] I1 `vos kb add ... --recursive` ❌ embedding provider 404
- [x] I2 `vos kb list` ✅
- [x] I3 `vos kb search` ⏭️ 未执行（KB 为空）

### Step J: Agent 辅助
- [x] J1 `vos agent ask` ⏭️ 未执行
- [x] J2 `vos agent review-spec` ⏭️ 未执行
- [x] J3 `vos agent log` ✅

### Step K: 记录
- [x] K1 `vos ledger record` ✅（多次使用）
- [x] K2 更新本文档 ✅

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

---

## Phase 1 执行记录 (2026-06-24)

### Step 0: 环境就绪 + 项目初始化 ✅

| 命令 | 结果 | 备注 |
|------|------|------|
| `vos doctor` | ❌→✅ | 初次失败：`toolchain.json` 缺少 `environment.required_tools` 字段。手动添加 riscv-gcc/objcopy/objdump 后通过 |
| `vos stage show` | ⚠️ | 需先 `ledger record` 清 dirty_worktree 状态 |

**发现**: `toolchain.json` schema 要求 `environment.required_tools`（schema 定义在 `manifest.ts:107`），但实际 manifest 中缺失。`build generate` 生成时会自动填充，但手工创建的 manifest 容易遗漏。

### Step 1: Spec 审查裁剪 ✅

| 命令 | 结果 | 备注 |
|------|------|------|
| `spec lint` | ⏱️ 超时 | 含 LLM agent review（`runDefaultAgentSpecReview`），API 调用超时 |
| `spec check-consistency` | ✅ 通过 | ~1s，不调 LLM，生成 `.vos/cache/normalized/bundle.json` |

**裁剪内容**:
- `kernel_main.yaml`: 移除 future-stage `requires_ops`（kinit/kvmmake/proc_init/trap_init/userinit/scheduler），仅保留 boot_banner/console_write/shutdown
- `purpose`/`guarantee`/`postconditions`/`security` 同步更新

### Step 2: 工具链 + 架构检查 ✅

| 命令 | 结果 | 备注 |
|------|------|------|
| `toolchain lint` | ✅ | 快速通过 |
| `build generate` | ⏱️ 超时 | 调 LLM agent 生成 Makefile/toolchain.json |
| `arch lint` | ⏱️ 超时 | 含 LLM agent review |
| `arch compose` | ✅ | ~1s，生成 `.vos/cache/composition.json` |
| `arch derive-tests` | ✅ | ~1s，生成 `.vos/cache/derived-tests.json` |

**发现**: `arch compose` 和 `arch derive-tests` 展示 ALL 模块/操作（包括 bio/fs/pipe/virtio 等未来阶段），不按 `current_stage: boot` 过滤。

### Step 3: Agent 生成 + 构建 + 运行 ✅

| 命令 | 结果 | 耗时 | 备注 |
|------|------|------|------|
| `agent plan --stage boot` | ✅ | ~82s | LLM 生成执行计划 |
| `agent generate --apply` | ✅ | ~152s | LLM 生成 boot.c（仅添加 `shutdown()` 调用） |
| `build --dry-run` | ✅ | <1s | |
| `build` | ✅ | ~5s | make all 成功 |
| `run qemu --case boot-smoke` | ✅ | <1s | 输出含 `xv6 kernel is booting` + `XV6_BOOT_OK` + `init: starting sh` |

**关键发现**: `kernel_main()`（spec 描述为 "C entry point"）实际未被调用。真正入口是 `main()` 在 `main.c`，包含完整 init 链。agent 生成的 `kernel_main()` 为死代码。`init: starting sh` 仍出现因为 `main.c` 未被修改。**Spec-to-build 连线断裂**。

### Step 4: 错误注入 ⚠️→✅

| 注入 | 类型 | 检测 | 修复 |
|------|------|------|------|
| `_entry` → `_entr` (entry.S) | 链接符号错误 | ⚠️ LD warning 但 build 仍报 ok | 手动回滚 |
| 移除 `#include "types.h"` | 编译错误 | ❌ 未检测（boot.c 不依赖 types.h） | 手动回滚 |
| 移除 `shutdown()` 函数 | 隐式声明错误 | ✅ build failed + 日志明确报错 | 手动回滚 |

**发现**:
- `vos build` 使用 `make`，LD warning 不导致 build 失败 → 需在 toolchain.json 中加 `-Wl,--fatal-warnings`
- `debug explain-log` 无法找到 build 日志（依赖 `findLatestLogPath` 查找 QEMU 日志而非 build 日志）
- 移除 `types.h` 不影响编译因为 boot.c 只用内置类型 — 需要更真实的错误注入

### Step 5: KB + Agent 辅助 ⚠️

| 命令 | 结果 | 备注 |
|------|------|------|
| `kb add --recursive` | ❌ | embedding provider 404，KB 依赖外部 embedding API |
| `kb list` | ✅ | 空列表 |
| `kb search` | — | 未测试（KB 为空） |
| `agent validate-generated` | ⏱️ 挂起 | LLM 调用无响应 |
| `agent log` | ✅ | 正常 |

---

## 工具链不足汇总（Phase 1）

### 🔴 严重 (Blockers)

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| D1 | **Spec-to-build 连线断裂**：`kernel_main()` spec 描述为入口点但 `main()` in `main.c` 是实际入口。agent 生成的代码无法影响实际执行流 | 学生按 spec 生成代码后发现运行结果与预期不符 | 在 spec 中明确 `main.c` 调用 `kernel_main()`，或 stage 早期由 Makefile/boot 流程使用 kernel_main |
| D2 | **LLM 依赖命令无降级**：`spec lint`、`build generate`、`arch lint`、`agent validate-generated` 等调 LLM agent 超时/挂起时无 fallback | 学生无法完成必要检查 | 添加 `--no-agent` flag 跳过 LLM review，仅执行确定性检查 |

### 🟡 中等 (Warnings)

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| D3 | **`vos build` 不报告链接警告**：`LD warning: cannot find entry symbol _entry` 出现但 build 仍报 ok | 学生可能未察觉链接错误 | toolchain.json build commands 加 `-Wl,--fatal-warnings` 或 vos build 解析日志中的 warning |
| D4 | **`arch compose/derive-tests` 不按 stage 过滤**：boot 阶段也显示所有未来模块 | 学生困惑：哪些模块属于当前阶段？ | 读取 `.vos/project.yaml` 的 `current_stage`，仅展示对应 slice 的模块 |
| D5 | **`toolchain.json` 缺少 `environment` 字段时 schema 校验失败**：手工创建的 manifest 容易遗漏 | `vos doctor` 报错但提示不够明确 | 在 `build generate` 以外提供 `vos toolchain init` 生成最小有效 manifest |

### 🟢 轻微 (Minor)

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| D7 | **`debug explain-log` 仅查找 QEMU 日志**：build 失败时无帮助 | `debug explain-log` 返回 "no log path found" | 扩展 `findLatestLogPath` 覆盖 build 日志 |
| D8 | **`ledger record`/`dirty_worktree` 工作流摩擦**：每次 spec 或代码修改后需 git commit + ledger record 才能继续 | 学生频繁被打断 | 提供 `vos stage save` 快捷命令原子化 commit+ledger |
| D9 | **`spec lint` 含 LLM review 但 `spec check-consistency` 不含**：两个命令名相似但行为差异大 | 学生可能混淆 | 统一命名或文档说明差异 |

---

## Phase 1 干净复现 (2026-06-24) — `/home/wzh/student-boot/`

> 从零创建独立 boot-only 项目，无阶段泄露。全链路通过。

### 项目初始化

| 步骤 | 说明 |
|------|------|
| 创建 | `mkdir -p /home/wzh/student-boot/`，git init |
| 配置 | `.vos/config.toml` (DeepSeek + ECNU embedding), `.vos/policy.yaml`, `.vos/project.yaml` (`current_stage: boot`) |
| Spec | 仅复制 3 模块：kernel/boot (6 ops), kernel/headers (4 headers), kernel/start (2 ops) |
| 裁剪 | seed.yaml→boot-only goals, timeline.yaml→boot stage, build.yaml→boot objects, public-matrix.yaml→1 项需求, goals→xv6-core-boot, toolchain.yaml→移除缺失 includes |
| Makefile | 仅编译 entry.o + start.o + boot.o + main.o，链接地址 0x80200000 (OpenSBI 兼容) |
| Kernel | 空目录 — 由 agent 生成 |
| 提交 | 32 files, 1 initial commit |

### 全链路验证

| 步骤 | 命令 | 结果 | 耗时 |
|------|------|------|------|
| doctor | `vos doctor` | ✅ passed | <1s |
| spec | `vos spec check-consistency` | ✅ 24 项 0 诊断 | <1s |
| toolchain | `vos toolchain lint` | ✅ (修复 includes 后) | <1s |
| arch compose | `vos arch compose` | ✅ 4 模块 12 ops，零泄露 | <1s |
| arch lint | `vos arch lint` | ✅ (含 LLM review) | ~66s |
| agent generate | `vos agent generate --apply` | ✅ 生成 11 文件 | ~4.5min |
| build | `vos build` | ✅ 4 文件链接 | <1s |
| run | `vos run qemu --case boot-smoke` | ✅ `xv6 kernel is booting` + SBI shutdown | <1s |
| verify | `vos verify public` | ✅ 3/3 测试通过 (bootstrap_banner_not_null/length_positive/printable) | <1s |
| kb add | `vos kb add spec/.../boot/ --recursive` | ✅ 6 sources indexed | ~3.5s |
| kb search | `vos kb search "SBI ecall..."` | ✅ 5 hits from boot spec | <1s |

### 错误注入

| # | 注入 | 检测 | 分析 |
|---|------|------|------|
| 1 | 移除 `shutdown()` 调用 | ❌ 未检测 | QEMU 仍打印 banner 匹配 success_regex；缺少 shutdown 后的退出验证。**D10**: boot-smoke case 应验证 QEMU 正常退出。 |
| 2 | `boot_banner` 改为 `"hello world"` | ✅ run failed | success_regex `xv6 kernel is booting` 不匹配 |
| 3 | `ENTRY(entry)` → `ENTRY(_entry)` | ❌ 未检测 | ELF entry 降级到 .text 起始地址；`-kernel` 不依赖 ELF entry 字段。低影响。 |

### 新增工具链不足

| # | 问题 | 严重度 |
|---|------|--------|
| D10 | **boot-smoke oracle 不验证 shutdown**：banner 匹配后不检查 QEMU 是否正常退出 | 🟡 中等 |
| D11 | **`toolchain.yaml` 的 `includes` 与阶段裁剪不同步**：移除 future 文件后需手动更新 includes 列表 | 🟢 轻微 |
| D12 | **`-bios default` (OpenSBI) 与 `-bios none` 行为不同**：kernel.ld 地址需适配 (0x80000000 vs 0x80200000)，spec 中未显式声明 | 🟡 中等 |
| D13 | **`agent ask` structured output schema 过严**：LLM 返回 `design_goal_alignment` 为 string 而非 array 时报 `agent_output_error`，无降级展示 | 🟡 中等 |
| D14 | **`agent debug` structured output 同样过严**：插桩执行成功（构建+QEMU trace+GDB adapter 均生成），但 `DebugOutput.failure_class` 类型不匹配导致 status: failed | 🟡 中等 |

---

## Phase 1 补测: agent debug 插桩 (2026-06-25)

### agent debug (无参数)

| 命令 | 结果 |
|------|------|
| `vos agent debug` | ✅ `status: planned`，列出 10 个最近失败 run |

### agent debug --run（插桩调试）

| 命令 | 结果 | 耗时 |
|------|------|------|
| `vos agent debug --run 202606241844430-b8d3c459` | ⚠️ `status: failed` (schema mismatch) | ~5min |

#### 实际执行内容（全部成功）

| 组件 | 状态 | 详情 |
|------|------|------|
| 构建 | ✅ | 重新编译 kernel.elf |
| QEMU trace | ✅ | boot-banner-trace: 2 events, success_matched=true |
| GDB adapter | ✅ | 完整合约: tcp::26000, QMP/HMP sockets, forbidden commands |
| Trace summary | ✅ | 1 public requirement, 1 case, status: ok |

#### GDB Adapter Contract 关键内容

```json
{
  "mode": "qemu-gdbstub",
  "endpoint": "127.0.0.1:26000",
  "qemu_args": ["-S", "-gdb", "tcp::26000", "-qmp", "...", "-monitor", "..."],
  "forbidden": ["qemu-user-gdb", "gdb_attach"],
  "monitor_forbidden_commands": ["quit", "stop", "cont", "system_reset", ...]
}
```

### agent debug 结论

插桩框架完整：自动构建 → QEMU 启动（带 GDB stub）→ 符号追踪 → GDB/MON 适配器合约。学生可直接 `target remote 127.0.0.1:26000` 接入调试。**唯一阻塞项**：LLM 的最终结构化输出校验过严 (D14)，导致整体 status 报 failed，实际调试产物全部正确生成。
