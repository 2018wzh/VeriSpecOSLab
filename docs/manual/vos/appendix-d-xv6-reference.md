# 附录 D：xv6-spec 项目参考

本节走读 `examples/xv6-spec` 参考项目的 spec 结构和模块-操作对应关系。

## D.1 项目概况

xv6-spec 用 `spec/` 描述了一个完整的 xv6 风格 RISC-V 内核。包含：

- **9 个 ModuleSpec**（7 个可执行叶子模块 + 2 个聚合父模块）
- **64 个 OperationContract**（53 个内核操作 + 8 个头文件 + 1 个链接脚本 + 1 个用户程序 + 1 个用户链接脚本）
- 完整覆盖：boot → memory → trap → process → syscall → filesystem → ipc → device

## D.2 spec/ 目录走读

```text
examples/xv6-spec/spec/
├── architecture/
│   ├── seed.yaml                 # ArchitectureSeed：系统总方向
│   ├── timeline.yaml             # 阶段时间线
│   ├── slices/                   # 9 个 ArchitectureSlice
│   │   ├── 01-boot.yaml
│   │   ├── 02-memory.yaml
│   │   ├── 03-trap.yaml
│   │   ├── 04-process.yaml
│   │   ├── 05-syscall.yaml
│   │   ├── 06-filesystem.yaml
│   │   ├── 07-ipc.yaml
│   │   ├── 08-device.yaml
│   │   └── 09-full-syscall.yaml
│   ├── decisions/                # ADR
│   │   └── ADR-001-paging-model.yaml
│   └── composition.yaml          # 架构级组合不变量
├── modules/
│   ├── kernel/
│   │   ├── module.yaml           # 聚合父模块 kernel
│   │   ├── boot/                 # 启动模块（4 ops）
│   │   ├── memory/               # 内存管理模块（15 ops）
│   │   ├── trap/                 # 陷阱处理模块
│   │   ├── process/              # 进程管理模块（12 ops）
│   │   ├── syscall/              # 系统调用模块（8 ops）
│   │   ├── headers/              # 头文件模块（8 ops，含 link_ld）
│   │   ├── string/               # 字符串工具模块（8 ops）
│   │   ├── start/                # 启动时序模块（2 ops）
│   │   ├── lock/ log/ fs/ file/  # 后续阶段模块
│   │   ├── bio/ pipe/ exec/      # 后续阶段模块
│   │   ├── console/ printk/      # 后续阶段模块
│   │   ├── plic/ uart/ virtio/   # 设备驱动模块
│   │   └── vm/                   # 虚拟内存模块
│   └── user/
│       ├── module.yaml           # 聚合父模块 user
│       └── programs/             # 用户程序模块（2 ops）
├── composition/                  # 跨模块组合不变量
│   ├── process-memory-isolation.yaml
│   ├── syscall-mm-trap.yaml
│   └── trap-syscall-process.yaml
├── goals/
│   └── xv6-core.yaml            # 核心功能目标
├── evolution/
│   ├── patch-001-initial-spec.yaml
│   └── patch-002-full-spec.yaml
├── toolchain/
│   ├── toolchain.yaml            # 入口索引
│   ├── profile.yaml              # 工具链 profile
│   ├── build.yaml                # 构建语义
│   ├── link.yaml                 # 链接语义
│   ├── image.yaml                # 镜像生成
│   ├── run.yaml                  # QEMU 运行配置
│   └── debug.yaml                # 调试配置
└── verification/
    └── public-matrix.yaml        # 公开验证矩阵
```

## D.3 模块-操作对应表

### kernel/boot（4 个 OperationContract）

| 操作 | 文件 | 说明 |
|------|------|------|
| `entry` | `kernel/entry.S` | RISC-V S-mode 入口汇编 |
| `kernel_main` | `kernel/main.c` | 内核主函数 |
| `boot_banner` | `kernel/boot.c` | 启动横幅打印 |
| `console_putchar` | `kernel/console.c` | SBI 控制台字符输出 |
| `console_write` | `kernel/console.c` | 控制台字符串输出 |
| `shutdown` | `kernel/boot.c` | 关机 |

### kernel/memory（15 个 OperationContract）

| 操作 | 文件 | 说明 |
|------|------|------|
| `kinit` | `kernel/kalloc.c` | 物理内存初始化 |
| `kalloc` | `kernel/kalloc.c` | 分配一页 |
| `kfree` | `kernel/kalloc.c` | 释放一页 |
| `kvmmake` | `kernel/vm.c` | 创建内核页表 |
| `kvmmap` | `kernel/vm.c` | 内核页表映射 |
| `walk` | `kernel/vm.c` | 页表遍历 |
| `walkaddr` | `kernel/vm.c` | 虚拟地址→物理地址 |
| `uvmcreate` | `kernel/vm.c` | 创建用户页表 |
| `uvminit` | `kernel/vm.c` | 初始化用户页表 |
| `uvmalloc` | `kernel/vm.c` | 用户内存分配 |
| `uvmdealloc` | `kernel/vm.c` | 用户内存释放 |
| `uvmfree` | `kernel/vm.c` | 释放用户页表 |
| `uvmcopy` | `kernel/vm.c` | 复制用户页表（fork 用） |
| `uvmunmap` | `kernel/vm.c` | 取消用户映射 |
| `copyin` | `kernel/vm.c` | 用户→内核拷贝 |
| `copyout` | `kernel/vm.c` | 内核→用户拷贝 |
| `copyinstr` | `kernel/vm.c` | 用户字符串拷贝 |

### kernel/process（12 个 OperationContract）

| 操作 | 文件 | 说明 |
|------|------|------|
| `proc_init` | `kernel/proc.c` | 进程系统初始化 |
| `allocproc` | `kernel/proc.c` | 分配进程结构 |
| `freeproc` | `kernel/proc.c` | 释放进程结构 |
| `scheduler` | `kernel/proc.c` | 调度器 |
| `swtch` | `kernel/swtch.S` | 上下文切换（汇编） |
| `fork` | `kernel/proc.c` | 创建子进程 |
| `exit` | `kernel/proc.c` | 进程退出 |
| `wait` | `kernel/proc.c` | 等待子进程 |
| `sleep` | `kernel/proc.c` | 进程睡眠 |
| `wakeup` | `kernel/proc.c` | 唤醒进程 |
| `yield_cpu` | `kernel/proc.c` | 让出 CPU |
| `growproc` | `kernel/proc.c` | 扩展进程内存 |
| `userinit` | `kernel/proc.c` | 首个用户进程初始化 |

### kernel/syscall（8 个 OperationContract）

| 操作 | 文件 | 说明 |
|------|------|------|
| `syscall` | `kernel/syscall.c` | 系统调用分发 |
| `sys_write` | `kernel/syscall.c` | write 系统调用 |
| `sys_exit` | `kernel/syscall.c` | exit 系统调用 |
| `sys_fork` | `kernel/syscall.c` | fork 系统调用 |
| `sys_wait` | `kernel/syscall.c` | wait 系统调用 |
| `sys_sbrk` | `kernel/syscall.c` | sbrk 系统调用 |
| `argint` | `kernel/syscall.c` | 参数提取（整数） |
| `argaddr` | `kernel/syscall.c` | 参数提取（地址） |
| `fetchaddr` | `kernel/syscall.c` | 用户地址读取 |
| `fetchstr` | `kernel/syscall.c` | 用户字符串读取 |

### kernel/headers（8 个 OperationContract，含 1 个链接脚本）

| 操作 | 文件 | 格式 |
|------|------|------|
| `types` | `include/types.h` | C 头文件 |
| `defs` | `include/defs.h` | C 头文件（函数声明） |
| `param` | `include/param.h` | C 头文件 |
| `memlayout` | `include/memlayout.h` | C 头文件 |
| `riscv` | `include/riscv.h` | C 头文件 |
| `proc` | `include/proc.h` | C 头文件 |
| `spinlock` | `include/spinlock.h` | C 头文件 |
| `elf` | `include/elf.h` | C 头文件 |
| `link_ld` | `kernel/link.ld` | GNU ld 链接脚本 |

### user/programs（2 个 OperationContract）

| 操作 | 文件 | 格式 |
|------|------|------|
| `init` | `user/init.c` | freestanding 用户 C 程序 |
| `user_ld` | `user/user.ld` | 用户态 ld 脚本 |

### 其他模块

后续阶段模块（kernel/trap、kernel/lock、kernel/fs、kernel/file、kernel/pipe、kernel/exec、kernel/bio、kernel/log、kernel/console、kernel/printk、kernel/plic、kernel/uart、kernel/virtio、kernel/vm 等）各有若干 OperationContract，总计 64 个。

## D.4 生成器注意事项

生成器需根据 `editable_region.file` 扩展名选择目标语言/格式：

| 扩展名 | 目标格式 | 示例操作 |
|------|------|------|
| `.c` | C 代码 | `kernel/memory.kalloc` |
| `.S` | RISC-V 汇编 | `kernel/process.swtch` |
| `.h` | C 头文件 | `kernel/headers.types` |
| `.ld` | GNU ld 脚本 | `kernel/headers.link_ld` |

`guarantee.declarations` 或 `guarantee.linker_sections` 字段提供结构化生成指导。

## D.5 典型运行命令

从 `vos/` 目录运行，项目路径为 `../examples/xv6-spec`：

```bash
# 检查环境
bun run vos -- --project-root ../examples/xv6-spec doctor

# 检查 spec
bun run vos -- --project-root ../examples/xv6-spec spec check-consistency

# 检查工具链
bun run vos -- --project-root ../examples/xv6-spec toolchain lint

# 构建
bun run vos -- --project-root ../examples/xv6-spec build

# 运行 QEMU
bun run vos -- --project-root ../examples/xv6-spec run qemu --case boot-smoke

# 公开验证
bun run vos -- --project-root ../examples/xv6-spec verify public

# 从 spec 生成源码
bun run vos -- --project-root ../examples/xv6-spec agent generate --apply

# 生成+构建+运行
bun run vos -- --project-root ../examples/xv6-spec agent generate --apply --build --run
```
