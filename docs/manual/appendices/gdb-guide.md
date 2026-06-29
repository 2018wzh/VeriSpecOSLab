# GDB 调试指南

GDB 是调试内核的主要工具。由于内核运行在 QEMU 中，调试通过 QEMU 的 GDB 服务器进行。

## 启动调试会话

### 第一步：启动带 GDB 服务器的 QEMU

```bash
qemu-system-riscv64 -machine virt -kernel build/kernel.elf -nographic -s -S
```

`-s` 在 TCP 1234 端口开启 GDB 服务器。
`-S` 让 CPU 在启动时暂停，等待 GDB 连接。

### 第二步：连接 GDB

```bash
gdb-multiarch build/kernel.elf \
  -ex "target remote :1234"
```

## 常用 GDB 命令

### 执行控制

```gdb
continue          # 继续执行
stepi             # 单步（汇编指令级）
nexti             # 单步跳过（汇编指令级）
finish            # 执行到当前函数返回
```

### 断点

```gdb
break _start                # 在 _start 符号处设断点
break kernel/main.c:42      # 在文件行号设断点
break kalloc                # 在函数入口设断点
info breakpoints            # 列出所有断点
delete 1                    # 删除 1 号断点
```

### 查看状态

```gdb
info registers              # 查看所有寄存器
print/x $a0                 # 以十六进制查看 a0 寄存器
x/10i $pc                   # 查看当前位置的 10 条指令
x/16x 0x80000000            # 以十六进制查看内存
backtrace                   # 查看调用栈
info frame                  # 查看当前栈帧
```

### 数据查看

```gdb
print variable              # 打印变量值
print *ptr                  # 打印指针指向的值
print/x value               # 十六进制打印
display $a0                 # 每次停顿时自动显示 a0
```

## 调试场景

### 场景 1：内核启动失败

在 `_start` 设断点，单步执行，检查每个初始化步骤。

```gdb
break _start
target remote :1234
stepi
# 逐步跟踪启动过程
```

### 场景 2：页错误（Page Fault）

在 trap handler 入口设断点，检查 `scause` 和 `stval` 寄存器。

```gdb
break usertrap
continue
# 触发页错误后，GDB 会在 usertrap 处停下
print/x $scause    # 异常原因
print/x $stval     # 出错的地址
```

### 场景 3：内存损坏

使用硬件观察点（watchpoint）定位内存被谁修改。

```gdb
watch my_variable          # 当 my_variable 被写入时停下
watch *0x80001000          # 当该地址被写入时停下
```

### 场景 4：死锁

在 `acquire` 和 `release` 函数设断点，观察锁的获取/释放顺序。

```gdb
break acquire
break release
# 查看哪些锁被持有，等锁的调用栈
```

## GDB 脚本

你可以创建 `.gdbinit` 文件来自动加载常用设置：

```gdb
# .gdbinit
set architecture riscv:rv64
target remote :1234

# 常用断点
break _start
break usertrap
break kerneltrap
break panic

# 布局
layout split
```

使用：

```bash
gdb-multiarch -x .gdbinit build/kernel.elf
```

## 注意事项

- QEMU 的 GDB 服务器不支持硬件断点数无限制，大量使用软件断点可能影响性能。
- 在内核初始化 MMU 之后（启用分页），GDB 的虚拟地址解析可能与实际物理地址不一致，需要手动切换。
- `stepi` 单步进入中断处理时，QEMU 可能会多次暂停，属于正常现象。
