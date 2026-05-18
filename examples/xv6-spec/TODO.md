# TODO: 剩余缺口

> 更新于 Phase F 完成时。以下为已验证 spec 覆盖之外的项。

## 已通过 spec 覆盖（从 TODO 中移除）

以下所有项已有对应 spec，可通过生成器生成代码：

- ✅ **汇编文件**：kernelvec.S (`trap.kernelvec`), trampoline.S (`trap.trampoline`), swtch.S (`process.swtch` 修正)
- ✅ **头文件**：types.h, riscv.h, defs.h, memlayout.h, param.h, spinlock.h, proc.h, elf.h (`spec/headers/`)
- ✅ **链接脚本**：kernel/link.ld (`spec/toolchain/linker-script.yaml`)
- ✅ **用户程序**：init.c (`spec/user/init.yaml`), user.ld (`spec/user/user-ld.yaml`)
- ✅ **OperationContract**：53 个（boot:6, memory:17, process:13, trap:7, syscall:10）

## 仍待处理（需额外生成器支持）

以下 spec 类型在当前 OperationContract 框架之外，需要对应的
生成器/代码合成器才能生成代码：

| 项目 | Spec 文件 | 需要的生成器类型 |
|------|----------|----------------|
| 头文件 | `spec/headers/*.yaml` | `header_generator`（从 typedef/struct/macro 定义合成 .h 文件） |
| 链接脚本 | `spec/toolchain/linker-script.yaml`, `spec/user/user-ld.yaml` | `linker_script_generator`（从 section 定义合成 .ld 文件） |
| 用户程序 | `spec/user/init.yaml` | `user_program_generator`（从行为描述生成 freestanding C + 汇编入口） |

## 需手动维护或后续 SpecPatch

- `include/defs.h` 中的函数声明应与各模块 ops 保持同步（理想情况
  下可从模块 spec 自动推导，当前需要手动更新 defs.yaml）
- 用户程序的 `_start` 汇编入口（cr t0）当前隐含在 init spec 中，
  将来可能需要独立的用户入口 spec
- 更多用户程序的 spec（shell, cat, echo 等）
