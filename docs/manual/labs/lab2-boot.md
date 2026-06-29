# Lab 2: 最小内核启动 — 从硬件到第一条指令

## 1. 设计问题

从硬件上电到你的内核输出第一条消息，这条路径上发生了什么？你的内核如何从固件手中接管控制权？最小的可运行内核需要建立什么执行环境？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 启动序列 | 固件给你的内核了什么状态？从 `_start` 到 `kernel_main` 之间需要哪些步骤？ |
| 启动方式 | 固件直启（如 OpenSBI → kernel）还是通过 bootloader（GRUB/Limine/U-Boot）？还是 UEFI 直启？每种方式把 CPU 留在什么状态、给你什么信息？ |
| 多核策略 | 多个 HART 同时启动还是主从模式？非启动 HART 如何等待？ |
| 内存布局 | 栈放哪里？代码和数据段的加载地址？BSS 在哪里？ |
| 构建链路 | 用什么编译器？什么链接脚本？产生什么格式的镜像？ |
| 验证手段 | 如何确认内核成功启动了？banner 输出、超时检测还是其他？ |

## 3. 背景阅读

- [附录：开发环境搭建](../appendices/dev-environment.md)
- [附录：QEMU 使用指南](../appendices/qemu-guide.md)
- [附录：链接脚本指南](../appendices/linker-script.md)
- [附录：RISC-V 参考](../appendices/riscv-reference.md)（启动和特权级部分）
- 你目标平台的技术文档（QEMU `virt` 机器手册）

## 4. 规格要求

### 4.1 ArchitectureSlice(boot)（必做）

创建 `spec/architecture/slices/01-boot.yaml`，定义本阶段引入了什么机制、依赖什么前序决策。

### 4.2 ModuleSpec（必做）

为你的启动模块编写 ModuleSpec：
- `spec/modules/boot/module.yaml`：描述启动模块的状态、接口和不变量

至少为以下操作编写 OperationContract：
- 汇编入口：从固件跳转到 `_start` 的契约
- BSS 清零操作
- 启动主函数（如 `kernel_main`）

### 4.3 ToolchainSpec（必做）

创建 `spec/toolchain/toolchain.yaml`，至少定义：
- 目标架构和编译器
- 链接布局（入口地址、段布局）
- 运行参数（QEMU 机器型号、内存大小）

可使用 `vos build generate` 生成初始骨架，再手动调整。

## 5. 质量门禁

### 构建门禁

```bash
vos build          # 编译并链接内核
```

确认 `build/kernel.elf` 或等价产物存在。

### 运行门禁

```bash
vos run qemu       # 启动 QEMU
```

确认：
- [ ] 串口有输出
- [ ] 输出中包含你的 kernel banner
- [ ] QEMU 在超时时间内正常运行（无 panic）

### BSS 清零验证

在你的 `kernel_main` 开头添加检查代码，验证 BSS 区域全为零。或者，在 BSS 清零前后分别检查 BSS 内容。

### 多核验证

确认只有 HART 0 执行初始化代码。其他 HART 在确定的位置等待。

## 6. 设计理据要求

1. 你的启动序列为什么是这个顺序？有没有步骤可以调换或省略？
2. 你的链接脚本中内核加载地址的由来是什么？
3. 你如何处理非启动 HART？如果非启动 HART 意外进入了初始化代码，会发生什么？

## 7. AI 使用边界

**允许**：
- 让 AI 审查你的链接脚本
- 让 AI 解释 QEMU 启动日志或崩溃原因
- 让 AI 生成汇编入口的框架（你需理解每一条指令）

**禁止**：
- 让 AI 一次性生成完整的启动代码而不写对应的 ModuleSpec

## 8. 提交物

- `spec/architecture/slices/01-boot.yaml`
- `spec/modules/boot/module.yaml` 及相关 OperationContract
- `spec/toolchain/toolchain.yaml`
- 内核源码（入口汇编、启动 C 代码、链接脚本）
- QEMU 启动日志（含 banner）

（进阶方向：从固件或设备树获取物理内存布局为阶段 3 做准备；测量从 `_start` 到 `kernel_main` 的时钟周期数以建立启动性能基线。）
