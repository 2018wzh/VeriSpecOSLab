# TODO: 剩余缺口

> 所有 spec 已统一为 `spec/modules/*/ops/*.yaml` 的 OperationContract 格式。
> 每个模块都有 `module.yaml`，每个生成目标都是一个 `editable_region` 操作。
> 总计 7 个模块、64 个 OperationContract，统一由 `vos agent generate <module>` 驱动。

## 生成器注意事项

| 操作类型 | 示例 | editable_region 指向 | 说明 |
|---------|------|---------------------|------|
| C 函数 | memory.kalloc | kernel/memory.c | 标准代码生成 |
| 汇编函数 | process.swtch | kernel/swtch.S | 需生成 RISC-V 汇编 |
| 头文件 | headers.types | include/types.h | 需生成 C 头文件 |
| 链接脚本 | headers.link_ld | kernel/link.ld | 需生成 GNU ld 脚本 |
| 用户程序 | user.init | user/init.c | 需生成 freestanding 用户 C 代码 |
| 用户链接脚本 | user.user_ld | user/user.ld | 需生成用户态 ld 脚本 |

生成器需要根据 `editable_region.file` 的扩展名选择目标语言/格式。
`guarantee.declarations` 或 `guarantee.linker_sections` 字段提供结构化生成指导。

## 轻量未覆盖项

- `include/defs.h` 的函数声明应与各模块 ops 同步（当前手动维护在 `headers.defs` 中）
- 更多用户程序（shell, cat, echo 等）—— 需新增 user ops

## 已全部由 spec 覆盖

以下所有项均通过对应的 OperationContract 覆盖，无需手写代码：
- ✅ 53 个内核操作（boot/memory/trap/process/syscall）
- ✅ 8 个头文件 + 1 个链接脚本（headers 模块）
- ✅ 1 个用户程序 + 1 个用户链接脚本（user 模块）
- ✅ 3 个汇编文件（entry.S, kernelvec.S, trampoline.S, swtch.S）
