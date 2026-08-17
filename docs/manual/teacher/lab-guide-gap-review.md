# Lab 1–10 实验手册对照成熟指导书的差距审查报告

> 维护者内部资料，不属于学生 Book/Lab 发布内容。若后续要修订 `docs/manual/book/` 与 `docs/manual/labs/`，以本报告为整改清单；修订完成后可更新或归档本报告。
>
> 审查日期：2026-08-17（第二轮修订：对照 xv6 与 rCore 原始教程文档逐项扩充，新增 S16–S20 与第 7 节达标验收表）。审查范围：`docs/manual/book/`（11 章）、`docs/manual/labs/`（Lab 1–10 + Final Lab），以及作为支撑的 `docs/manual/specs/`、`docs/manual/vos/`、`docs/manual/teacher/`。
>
> 执行状态（2026-08-17 修订后）：P0 全部完成；P1 全部完成（含新增的 S16/S17/S18/S19/S20 与验收表 14 项）；P2 完成 S8（ch03/ch06/ch07 调试指引）与 S12（术语表），S13（示例报告）部分完成（Lab 卡片已加"可数报告要求"与输出样例，Final Lab 示例报告留待后续），S10/S14 完成（Lab 设计空间表改为教材引用，teacher/ 评分表与检查表已扩展）。遗留：ch01 工作区存在会话外的未提交修改（QEMU 板级移植段落），需人工确认后再提交；教师侧 stage-gates/lab-release-plan/defense-questions 保持原样，如需同步扩展请另行安排。

## 1. 审查方法与对照基准

对照基准采用三类成熟实验指导书共有的"内容组件清单"：

| 组件 | rCore-Tutorial-Book | MIT 6.S081 xv6 Labs | ucore 实验指导书 |
| --- | --- | --- | --- |
| 学习目标（可测） | 每章"实验"前有目标 | "Your job" 任务陈述 | 每 Lab "实验目的" |
| 前置知识/先修 | 章节开头说明 | 指向 kernel book 章节 | 实验原理前置 |
| 时间估计 | 部分章节 | 每 Lab 有 "Time spent" | 部分 |
| 环境搭建（工具链/版本/安装） | 有专门环境配置章节 | 工具链说明 | 有环境准备章节 |
| 步骤化任务 + 命令 | 实验流程带命令 | 分步 "Your job" + `make qemu` | 实验过程带命令 |
| 预期输出/验收 | 练习要求输出格式 | 测试命令 + "You'll know" | 检测脚本/输出 |
| 提示/Hints | 提示性段落 | 每 Lab "Hints" | 提示 |
| 常见错误/FAQ/排查 | FAQ 附录 | 每 Lab "FAQ" | 常见问题 |
| 调试方法 | GDB/日志章节 | 调试提示 | 调试要点 |
| 分级练习/分值 | 简单/中等/较难 + 分数 | 基础 + Optional challenges | 练习 1..N + 分数 |
| 参考实现讲解 | 每章参考实现 | 指向 xv6 源码 | 代码讲解 |
| 评分/提交要求 | 报告要求明确 | 评分脚本、提交说明 | 报告要求明确 |

审查方法：逐文件核对上述组件是否存在、是否可执行，并交叉核对章- Lab 分工、术语、文件名与编号一致性。所有"不足"均给出证据位置；未标注"证据待补"的条目均已在本仓库当前文件核验。

### 1.1 对照证据来源（本轮修订新增）

本轮修订不再只依赖经验性清单，而是把 xv6 与 rCore 的原始教程文档取回仓库外核对（2026-08-17 获取），逐条对照"易用性与零基础"组件：

- **xv6 / MIT 6.1810（6.S081）Fall 2023 课程页面**（获取自 `https://pdos.csail.mit.edu/6.S081/2023/`）：
  - `labs/util.html`（完整）、`labs/syscall.html`（完整）、`labs/guidance.html`（完整）、`tools.html`（完整）；
  - 其余 lab 页面与 xv6 book 以同一站点的已知结构为准，未逐页取回。
- **rCore-Tutorial-Book-v3**（克隆自 `https://github.com/rcore-os/rCore-Tutorial-Book-v3`，`source/` 为 Sphinx 源）：
  - `chapter0/5setup-devel-env.rst`（环境配置专章，全文核对）、`terminology.rst`（术语表，全文核对）、`chapter1/0intro.rst` 与 `chapter1/7exercise.rst`（章节结构与练习格式，全文核对）、`final-lab.rst`（综合练习与分值，全文核对）、`appendix-a/index.rst`（前置学习资源附录）。

对照中新增的"易用性与零基础"组件（前表未单列，本轮逐项核对）：安装后验证步骤、QEMU 交互热键、Git 零基础演练、实际耗时记录、任务级验收句（"Your solution is correct if…"）、难度分级标注、新手首次调试演练。详见 S4/S5/S7/S8/S11/S16–S20 与第 7 节验收表。

## 2. 总体评价（先承认优点）

这套手册在下列方面已达到或超过成熟指导书的水准，修订时应保留：

1. **Lab 卡片模板高度统一且完整**：Lab 1–8、Lab 10、Final Lab 均有"本 Lab 概览（学完能做什么/预计耗时/前置依赖/产出物）→ 设计问题 → 步骤化操作（含自检点）→ 质量门禁（自动+人工）→ 设计理据 → AI 使用边界 → 提交物 → 常见问题 → 参考卡"的完整结构，其中"质量门禁"以可勾选清单形式给出验收标准，相当于 xv6 的 "Your solution is correct if…"（2023 版 lab 页面的原话）与 rCore 的"实验检查"两段的合并，这是非常成熟的做法。
2. **证据/身份绑定纪律**：每个 Lab 都要求 evidence 绑定 build/HEAD/Spec hash、区分"QEMU 通过"与"板卡已验证"、`pending_human_review` 边界、遮蔽凭据，这是超越 rCore/xv6 的独特优势。
3. **书本章节的"设计维度 + 常见陷阱"闭环**：ch02（12 条陷阱 + §2.8a 调试指南）、ch03（9 条陷阱）、ch05（10 条陷阱 + 三段自学导航 + 每段验证目标）等章节把错误症状与排查命令直接绑定，ch09 的"QEMU≠板卡"差异矩阵非常专业。
4. **AI 使用边界**：每 Lab 都有明确的 Agent 读写边界与"不能做什么"，在同类课程中领先。

## 3. 系统性不足（跨文件/跨章节）

### S1. 组件缺失不均衡：Lab 9 是唯一缺少标准概览组件的实验

- **证据**：`labs/lab9-hardware-port.md` 概览块只有"前置依赖"和"产出物"，缺少其他所有 Lab 都有的"学完能做什么"与"预计耗时"（其余 10 个实验卡片均有）。
- **对照成熟做法**：rCore/ucore 每个实验都给出目的与工作量预期；Lab 9 是工作量弹性最大、硬件风险最高的阶段，反而最需要目标与工时预期。
- **建议**：补齐 Lab 9 概览的"学完能做什么"（"把 QEMU 上验证过的内核搬到 canonical board，独立完成启动链、串口、定时器/中断和至少一个存储外设的板级验收，并保持 QEMU 回归"）与"预计耗时"（参考实板各里程碑 20–40 小时，1–2 周，注明视板卡难度浮动）。

### S2. Spec 文件路径/模块 ID 命名前后不一致

- **证据**：
  - `book/ch04-interrupts.md` §4.6 写 `spec/modules/interrupt.yaml`、`spec/modules/uart.yaml`、`spec/modules/timer.yaml`（无 `kernel/` 前缀）；
  - 而 `book/ch02-boot.md` §2.6、`book/ch03-memory.md` §3.7、`book/ch05-user-space.md` §5.7 以及全部 Lab 2–7 均使用 `spec/modules/kernel/*.yaml`（`kernel/boot`、`kernel/memory`、`kernel/trap`、`kernel/process`、`kernel/syscall`、`kernel/virtio`、`kernel/bio`、`kernel/log`、`kernel/inode`、`kernel/file`、`kernel/pipe`）；
  - Labs 的产出物与骨架用 `kernel/trap`（Lab 4），与 ch04 的三个扁平模块名冲突。
- **风险**：学生按章命名与按 Lab 命名会产出两套目录结构，`vos spec lint` 只做确定性校验，不会自动纠偏；教师审查时也难以区分"学生命名分歧"与"手册自相矛盾"。
- **建议**：统一为 `spec/modules/kernel/*.yaml`，修订 ch04 §4.6；或在手册中明确"模块 ID 由学生自定，但目录须置于 `spec/modules/` 下"并给出一个统一约定。

### S3. 章- Lab 编号错位与章节编号断裂

- **证据**（均为核验结果）：
  - `book/ch02-boot.md`：`### 2.2.8 ⚡ 选读：Secure Boot` 出现在 `### 2.2.7 第一条输出：UART` 之前（§2.2.6 → §2.2.8 → §2.2.7）。
  - `book/ch07-resource-abi.md`：`## 7.3 ABI设计` 下第一个维度直接是 `### 维度 2：Syscall ABI 设计`，无"维度 1"。
  - `book/ch08-personal-goal.md`：`## 8.2.6` 之后直接是 `## 8.4 常见陷阱`，全章无 `## 8.3`。
  - `book/ch08-personal-goal.md`：F 簇方向编号自相矛盾——速查表（§8.2.0）用"F3=图形界面、F6=COW、F7=按需分页、F8=容器化、F9=LKM、F10=权限、F11=内核线程、F12=Hypervisor"，而方向节标题用"F2=GUI、F3=COW、F4=按需分页、F5=容器、F6=LKM、F7=权限、F8=内核线程、F9=Hypervisor"；正文 §8.2.0.1"F10 权限系统"、§8.2.1 迁移注"COW Fork (F6)"也按旧编号引用（F7/F9 节内另有自指 F10/F12 的表述）。
- **风险**：学生引用"方向 F7"时可能指权限系统也可能指按需分页，直接破坏选题与 GoalSpec 的可沟通性。
- **建议**：重排 ch08 F 簇为单一编号体系（建议以节标题为准，同步改速查表与正文引用），补回/删除 8.3 编号，重排 ch02 §2.2.7/2.2.8 顺序，补 ch07 维度 1。

### S4. 环境搭建指引缺失（工具链安装、版本锁定）

- **证据**：书本章节几乎没有"安装命令 + 版本号"：
  - ch01 §1.8"开始之前"只有一句"确认你的环境：操作系统，开发环境，大模型提供商等"；
  - ch02 有命令（`qemu-system-riscv64 -machine virt -bios default -nographic`、GDB `-S -s` 等）但无安装步骤、无版本要求；"GRUB 安装命令 `grub-mkrescue`"表述不准确（`grub-mkrescue` 是打包命令）；
  - ch03–ch07、ch10、ch11 均无任何工具链安装指引；ch08 有散落的 QEMU 参数示例但无安装；ch09 有 OpenOCD/GDB/U-Boot 命令但无安装与版本；
  - 唯一例外是 `labs/lab1-seed.md` 步骤 1 给出了 Bun/vos 安装流程——但那是 vos CLI，不是内核工具链（交叉编译器、QEMU、GDB）。
- **对照成熟做法**：rCore 有专门的环境配置章节（rustup、qemu、gdb、工具链版本对应表）；xv6 labs 发布时锁定工具链。本课程"记录实际工具版本"的思想（lab1 参考卡）是对的，但学生需要一条"已知可用安装路径"作为起点，而不是从零摸索。
- **对照补充（本轮核验）**：
  - xv6 `tools.html` 明确给出**版本下限**（"QEMU 5.1+, GDB 8.3+, GCC, and Binutils"）、**分平台最小命令**（Debian/Ubuntu `apt-get install git build-essential gdb-multiarch qemu-system-misc gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu`、Arch pacman、macOS `brew tap riscv/riscv`、Windows 直接劝到 WSL2 并教 `wsl -l -v` 验证是 WSL2），还有专门的 **"Testing your Installation"** 小节（`qemu-system-riscv64 --version` 应输出 5.1.0、两个 GCC 变体的 `--version` 应有回显）；
  - rCore `chapter0/5setup-devel-env.rst` 把环境配置做成**带依赖关系图的五阶段**（基础准备 → Rust 工具链 → QEMU → IDE/GDB → 运行项目），提供三条路线（GitHub Classroom 在线环境只需浏览器 / Docker / 本地原生），对每个版本敏感点给 `warning`（QEMU 需 7.0+、`rust-toolchain.toml` 必须与分支一致），并给国内镜像（rustup/crates.io 的 USTC/tuna 源）与 QEMU 源码编译的 configure 常见错误 FAQ；章节末尾还有"当代码跑不起来的时候可以尝试…"的 Q&A 清单。
- **建议**：在 Lab 1 增加"内核工具链安装卡"（按 macOS/Linux/WSL2 三平台列出 Bun、vos、RISC-V 交叉编译器、QEMU、GDB 的最小安装命令与已验证版本），并带 xv6 式的"安装后验证命令 + 期望输出"（详见 S18）；各书本章节引用它而非重复；ch02/ch09 的调试命令注明"版本要求见 Lab 1 工具链卡"。

### S5. 时间估计缺失（book 各章；Lab 9）

- **证据**：Lab 卡片有"预计耗时"（Lab 9 除外，见 S1）；书本章节全部没有整章时间估计（ch05 §5.11 有"每段预计 2-3 天"、ch08 速查表有周级"典型工期"，但无章节总投入）。全套课程没有一处给出"全部 11 个实验合计投入/建议排期"。
- **对照成熟做法**：xv6 每个 lab 有 "Time spent"；rCore 实验说明建议投入。学生需要全局工作量认知来规划学期。
- **对照补充（本轮核验）**：xv6 每个 lab 的提交物强制包含 `time.txt`（"put in a single integer, the number of hours you spent on the lab"），这是教师校准难度与学生规划进度的双向数据；xv6 `guidance.html` 还给出官方难度-工时标尺（Easy <1 小时 / Moderate 1–2 小时 / Hard >2 小时）并注明"如果你花的时间远超预期，请来 office hours"，把预期管理做成显式机制。
- **建议**：在 ch01 或 README 加一张"11 个实验工作量总览表"（累计约 130–170 小时），并为缺时间的书本章节补整章估计（一句话即可）；同时把 xv6 的 `time.txt` 机制引入每个 Lab 的提交物（详见 S19），让"预计耗时"有实测回流。

### S6. 学习目标表述缺失（book 各章）

- **证据**：仅 ch02 §2.1.1 有"核心任务清单"（7 条可测项）；ch01/ch03/ch04/ch05/ch06/ch07/ch08/ch09/ch10/ch11 均无章级"学完你将能做到…"的可测目标清单（Lab 概览的"学完能做什么"在 Lab 卡片里，教材章节本身没有）。
- **对照成熟做法**：ucore 每章"实验目的"、rCore 每章目标段落、xv6 每 lab "Your job"。
- **建议**：每章开头补 3–5 条"学完本章你能…"清单，与对应 Lab 的质量门禁一一呼应（ch02 的做法可推广）。

### S7. 分级练习与分值体系缺失

- **证据**：
  - 书本章节的练习只有"⚡ 挑战"（ch02 A/B、ch03 A/B/C、ch04 A/B/C、ch05 A/B/C、ch06 A/B/C、ch07 A–E、ch08 方向、ch09 A/B/C、ch10 A/B、ch11 无），全部没有简单/中等/较难三档标注、没有分值、没有与 Lab 门禁的积分关系；
  - Lab 卡片没有任何"挑战/加分"栏目——挑战只存在于教材，不在实验卡片里兑现为分数或门禁；
  - `teacher/rubric.md` 只有 5 行维度表，无分 Lab 权重、无分值分布；`teacher/judge-policy.md` 明确把"风险评分、真正的课程 hidden tests 和硬件自动评分"留给"未来 Judge"。
- **风险**：学生不知道基础/进阶/挑战各自在总分中的分量，"全部做完=及格、挑战=加分"的预期无法建立；教师评分缺乏统一依据。
- **对照成熟做法**：ucore 每个 lab 的练习编号带分值；xv6 的 optional challenges 明确"加分"。
- **对照补充（本轮核验）**：xv6 `guidance.html` 用显式的三档工时难度（Easy <1h / Moderate 1–2h / Hard >2h）标注每个任务；rCore 每章"课后练习"用星号分级（`*`/`**`/`***`），"实验练习"的 challenge 单独标注，`final-lab.rst` 则给出总分上限与加分规则（基础实验必做；拓展作业加分不超过满分 30 分，"如果前面实验有失分，可以通过一个简单扩展把这部分分数拿回来"）。
- **建议**：在 Lab 卡片增加"评分构成"一行（如"质量门禁 70% + 设计理据 20% + 挑战 10%（可选）"）；为书本章节的 ⚡ 挑战标注难度与建议分值（可直接复用 xv6 的 <1h/1–2h/>2h 标尺或 rCore 的星号）；把 rubric 扩展为"按 Lab 的评分表模板"，即使最终裁定权仍在教师，也要让学生看到评分维度。

### S8. 调试方法覆盖不均衡

- **证据**（按章节）：
  - 强：ch02（§2.8a 四阶段排查 + GDB 命令 + 二分法）、ch05（§5.11 GDB 单步 + 卡住指引）、ch09（维度 4 + 挑战 A JTAG/OpenOCD）、ch10（参考卡五层调试方法论 + GDB 命令）；
  - 弱/缺：ch03（只有运行时断言/检查器，无 GDB 命令）、ch06（无 GDB，只有设备观测纪律）、ch07（无任何调试指引）、ch08（仅 C1 有 strace/GDB）、ch11（无调试内容）。
- **对照成熟做法**：xv6 网络课每个 lab 都带调试建议；ucore 有调试要点。内存管理（ch03）恰恰是最需要 GDB/转储手段的阶段。
- **对照补充（本轮核验）**：
  - xv6 `labs/syscall.html` 有一段完整的"第一次用 GDB 调内核"演练（`make qemu-gdb` → `b syscall` → `layout src` → `backtrace` → `p /x *p` → `p /x $sstatus` → 故意制造 panic → 用 `sepc` 在 `kernel/kernel.asm` 里定位崩溃指令 → `b *0x…` → `p p->name`），并把"调内核 panic 的标准姿势"（panic 打印 sepc → 搜 kernel.asm → addr2line）教成流程；
  - xv6 `guidance.html` 的 Debugging tips 是一份可直接照抄的清单：`script(1)` 记录全部控制台输出、`gdb-multiarch` 连接 `make qemu-gdb`、`b panic` 后 `bt` 拿内核 backtrace、内核挂死时 Ctrl-C + `bt`、QEMU monitor（`Ctrl-a c`）里 `info mem` 看页表、`make CPUS=1 qemu` 排除多核干扰；
  - rCore 每章问答作业直接给 GDB 命令表（`x/10i 0x80000000`、`x/10xw`、`info register`、`break *0x80200000`、`si`）并要求"通过 gdb 简单跟踪从机器加电到跳转 0x80200000 的过程"，把 GDB 作为零基础必修技能。
- **建议**：为 ch03 补"页表调试卡"（GDB 查看 satp/PTE 转储、`info registers`、遍历页表脚本；xv6 的 `info mem` 思路可直接参考），为 ch06 补"崩溃注入观察点"示例，为 ch07 补泄漏/死锁调试（可引用 lab7 FAQ 已有的三条排查法并展开命令）；同时把 ch02 的 GDB 片段升级为 xv6 syscall lab 式的"第一次 GDB 演练"（含预期输出，详见 S20）。

### S9. 参考实现/工作示例密度不均衡，且未链接参考子模块

- **证据**：
  - ch02 有完整链接脚本/自旋锁/MMIO UART 示例；ch10 有完整可照抄的不变量检查器教程；但 ch03 几乎无参考代码（只有接口签名与静态页表一行提示），ch04/ch05 只有概念性签名，ch06/ch07 只有布局/API 签名；
  - 仓库中 `examples/xv6-spec` 是完整的参考实现子模块，但 `docs/manual/book/` 与 `docs/manual/labs/` 全文没有一处链接它（xv6 只在概念引用中出现；唯一指引在内部文档 `vos/appendix-d-xv6-reference.md`）；
  - `docs/manual/specs/examples/` 有 4 份完整示例 Spec（page-allocator/scheduler/syscall-write/trap-handler），但属于内部资料，学生发布包看不到——学生手里只有 TODO 骨架，没有一份"完成的 ModuleSpec 长什么样"的完整样例。
- **风险**：学生对"字段填到什么程度算合格"缺乏锚点，Spec 质量方差会很大。
- **建议**：在 Lab 1–2 的参考卡中链接 `examples/xv6-spec`（指明"参考源码可读，不作为保密边界"——这与附录 D 的表述一致）；将 specs/examples 中的某一份（如 `page-allocator.yaml`，与课程验收无直接对应）移入学生可见位置作为"带注释的完整示例"，或复制一份脱敏示例到 Lab 3 的参考卡。

### S10. 教材-实验分工的重复与漂移风险

- **证据**：
  - Lab 卡片重复了教材的"设计空间"表格（Lab 2/3/4/6 均有独立"设计空间"表），与 README"教材保留背景与设计空间、实验卡片负责映射学生契约"的分工声明有出入——重复本身不致命，但两份内容可能漂移（ch04 的扁平模块名 vs Lab 4 的 `kernel/trap` 就是实例）；
  - 教材的"常见陷阱"（各章）与实验的"常见问题与排查"（各 Lab）内容相近却互不引用（如 ch02 12 条陷阱 vs Lab 2 4 条 FAQ 无交叉链接）。
- **对照成熟做法**：xv6 教材（xv6 book）与 lab 页面职责分明：lab 页面引用 book 章节而不是重述。
- **建议**：Lab 卡片的"设计空间"表改为"指向教材 §x.x + 本 Lab 决策问题"的短表；两边陷阱/FAQ 增加双向链接（如"详细陷阱见 ch02 §2.8"）。

### S11. 预期输出样例缺失（命令-输出对偶不完整）

- **证据**：Lab 卡片给出大量命令（`vos build`、`vos run qemu`、`vos verify`…），但几乎不给出"运行后应当看到什么"的完整输出样例：只有零散标记（banner、`MMU:PREPARED`/`MMU:ON`、`XV6_BOOT_OK` 成功正则、ch09 的 U-Boot 会话片段）。成败判断依赖学生自己理解 success_pattern。
- **对照成熟做法**：xv6 每个 lab 给出测试命令的期望输出；rCore 给出运行结果截图/输出。
- **对照补充（本轮核验）**：xv6 每个任务都给出**从 `$` 提示符开始的完整可复制会话**（如 `$ sleep 10` → `(nothing happens for a little while)` → `$`），并配一句 "Your solution is correct if…"；首次运行 `make qemu` 还给整段启动日志（"xv6 kernel is booting / hart 2 starting / init: starting sh"）与 `Ctrl-p` 查进程、`Ctrl-a x` 退出的演示。rCore 每章"实践体验"同样给出 `make run` 的完整预期日志（RustSBI banner → `[kernel] Hello, world!` → 各段内存布局日志）与截图。这类"会话级样例"是零基础学生判断"我到底成没成"的最低成本手段。
- **建议**：为每个 Lab 增加一个"最小成功输出样例"小节（真实命令 + 截断日志 + 标注哪个字段对应门禁），并升级为"含提示符的完整会话"格式，尤其 lab2（banner 格式）、lab3（内存地图/MMU 标记）、lab4（IRQ 统计）、lab7（shell 演示）。

### S12. 无统一术语表，术语引入无定义锚点

- **证据**：`grep "术语表|词汇表" docs/manual/book docs/manual/labs` 无匹配；唯一的术语表在内部文档 `vos/appendix-b-glossary.md`（且只覆盖 VOS 命令域）。book/labs 中 `DesignSpec`、`ModuleSpec`、`InterfaceSpec`、`GoalSpec`、`SpecPatch`、`owns`、`stable Spec ID`、`clean HEAD`、`pending_human_review`、`verifies`、`runner` 等术语大量出现，部分在首次出现处有解释（README），部分没有（ch03 直接使用 `ModuleSpec 操作条目`、ch05 直接使用 `verifies`）。
- **对照成熟做法**：rCore 有术语表，xv6 教材有符号表；读者零基础入场（Lab 1 定位"第一次接触 OS 开发也没关系"）。
- **对照补充（本轮核验）**：rCore 的 `terminology.rst` 就是可直接套用的模板——中英文对照表 + **每个术语标注首次出现的章节**（ref 链接），按章组织、共覆盖 100+ 术语（执行环境/系统调用/特权级/SBI/CSR/多级页表/跳板/TLB…），与正文锚点互相跳转。
- **建议**：在学生发布包（README 或 Lab 1 参考卡）增加学生版术语表，覆盖课程特定术语 + 常用 OS 术语（trap、HART、MMIO、PTE、TLB、inode…），并为每个术语标注"首次出现在第 X 章"（照抄 rCore 模板结构）。

### S13. 缺少"成功示例"（已完成 Spec/报告样例）

- **证据**：见 S9（Spec 示例内部化）+ ch11/Final Lab 只有报告结构清单（5 部分 + 页数），没有任何"一份好报告长什么样"的样例或反例对照。ch11 §11.6 有"把最终报告写成日志"的反例，但无正例。
- **对照成熟做法**：rCore 提供实验报告模板；ucore 给报告样板。
- **对照补充（本轮核验）**：rCore 的机制是"每章练习 → 每章答案"（`chapter1/8answer.rst` 等，参考答案直接公开）+"报告要求"具体到条目（`final-lab.rst`：分析 2–4 个失败测例即可满分、实现 1–2 个即可；`chapter1/7exercise.rst`：总结 5 行以内不贴代码、附运行截图、完成问答），即"合格线"是逐条可数的；xv6 则用 `answers-*.txt` 要求把问答作业写下来一起提交。
- **建议**：为 Final Lab 提供一个"1 页摘要版示例报告"（脱敏/虚构）或至少一个报告章节级提纲 + 每节的"合格/不合格"对照句；同时把 rCore 式"可数的报告要求"（几段分析、几张截图、几个问题）写进每个 Lab 的提交物清单。

### S14. 教师侧支撑文档过度简略，评分与计划不成体系

- **证据**：`teacher/` 共 8 个文件，合计约 2.5KB：`course-plan.md` 3 行、`rubric.md` 5 行、`lab-release-plan.md` 4 行、`stage-gates.md` 5 条、`ta-checklist.md` 6 条。无分 Lab 评分表、无检查清单与 Lab 的对应、无课程日历/发布节奏、无"教师侧每个 Lab 要验收什么"的映射。
- **风险**：手册承诺"人工检查"（如"能解释…"），但教师没有可勾选的验收清单副本；Lab 9 硬件验收需要的人工复核项目没有教师侧模板。
- **建议**：把 rubric.md 扩展为 11 个实验的评分表（直接引用各 Lab 质量门禁清单），ta-checklist 扩展为"按 Lab 分节的验收表"，course-plan 补充发布节奏与依赖关系（对应 S5 的总工作量表）。

### S15. 术语/外链/占位符等编辑级问题（详见第 5 节）

概括：ch11 与 final-lab 的重复引用块、`<goal-id>`/`<module>` 占位符、lab5 "lab2-4" 大小写、ch04 无 URL 的外部文献引用、ch08 疑似丢失加粗的分散空格、`维度 2a/3a/8a` 插入式编号、"最终参考卡"与"参考卡"重复等。

### S16. QEMU 交互热键/退出方式未成卡（易用性）

- **证据**：`grep "Ctrl-a|Ctrl+a|ctrl-a|退出 QEMU" docs/manual/book docs/manual/labs` 无匹配（2026-08-17 核验）。ch02 教了启动命令但没说"怎么退出、怎么进 monitor、怎么在 qemu 里看进程"；lab1 的 QEMU 热身也没有退出热键说明。学生第一次 `vos run qemu` 后大概率卡在"不知道按什么退出"。
- **对照成熟做法**：xv6 在第一次运行的页面就直接教 `Ctrl-a x` 退出、`Ctrl-p` 打印进程表，并在 guidance 里教 `Ctrl-a c` 进入 QEMU monitor（`info mem` 查页表）；rCore 环境配置章节同样教 `Ctrl+a x` 退出 QEMU、`Ctrl+]` 退出串口终端（K210 实板路径）。
- **建议**：Lab 1 参考卡加一张"QEMU 交互热键卡"（启动、退出、monitor 切换、串口终端退出、常用 monitor 命令 `info mem`/`info registers`/`info qtree`），并让 ch02/ch09 引用它。这是"零基础"最低成本的收益项。

### S17. Git 零基础演练缺失

- **证据**：lab1 步骤 2 只有一行 `git config user.name "Your Name"`（README 提及 `git init` 行为一句）；Lab 2–9 直接要求学生执行 `git commit -m "[spec]…"`，但没有一处讲解 clone/status/diff/log/branch/checkout 语义；`vos implement` 的 clean HEAD 门禁、`vos submit` 的归档都依赖学生对 Git 状态的理解。
- **对照成熟做法**：xv6 每个 lab 的 "Boot xv6" 段直接教 `git clone`、`git checkout` 分支、`git commit -am`（含命令输出示例）、`git diff` 与 `git diff origin/util` 的区别；rCore 环境配置教 `git checkout ch1` 切换章节分支——Git 被当作零基础必修技能直接教，而不是默认学生会。
- **风险**：第一周就要用 Git 提交 Spec 的学生，若没有 5 分钟的入门演练，"commit 了但没 add"、"推错分支"、"clean HEAD 门禁失败"等会成为摩擦点，且教师难以区分"不会 Git"与"理解错误"。
- **建议**：Lab 1 步骤 2 之前加"Git 五分钟演练"（init → status → add → commit → log → diff → branch 切换，全部给出命令与预期输出），参考卡放常用命令表；后续 Lab 需要新 Git 概念时（如 `git stash`、rebase、detached worktree）在首次出现处一行解释。

### S18. 工具链安装后的"验证步骤"不完整

- **证据**：lab1 步骤 1 对 vos CLI 有验证命令与自检点（`bun --version` 至少 1.3、`vos --help` 能看到命令列表，这是正确的先例）；但全书没有任何针对内核工具链的"安装后验证"（RISC-V 交叉编译器 `riscv64-…-gcc --version`、`qemu-system-riscv64 --version`、GDB 变体存在性），学生装完不知道自己装没装对。
- **对照成熟做法**：xv6 `tools.html` 有专门的 "Testing your Installation" 小节（`qemu-system-riscv64 --version` 应输出 5.1.0，`riscv64-linux-gnu-gcc`/`riscv64-unknown-elf-gcc` 两个变体 `--version` 都应有回显）；rCore 阶段 3/5 也用 `qemu-system-riscv64 --version` 确认。
- **建议**：S4 的工具链安装卡必须带"验证命令 + 期望输出 + 版本下限"三件套，并给失败时的排查路径（PATH 未生效、`bun link` 未执行、发行版软件源版本过低需换源或源码编译——后一点直接参考 rCore 的 QEMU 7.0+ 源码编译段）。

### S19. 缺少实际耗时记录机制（计划校准数据）

- **证据**：Lab 卡片有"预计耗时"，但全手册没有任何要求学生**记录实际耗时**的机制（无 xv6 `time.txt` 等价物）；S5 的"全局工作量表"即使做出来也没有实测数据回流。
- **对照成熟做法**：xv6 每个 lab 的提交物强制包含 `time.txt`（"the number of hours you spent on the lab"），教师据此校准 lab 难度、调整发布节奏；xv6 guidance 的三档工时难度（<1h/1–2h/>2h）也是建立在实测数据上的。
- **风险**：本课程把"预计耗时"写死在卡片里（且 Lab 9 弹性最大），但没有学生实测回流，一学期后预计值继续失真。
- **建议**：每个 Lab 提交物清单加一行 `time.txt`（或并入报告头部的"实际耗时"字段），成本极低；一学期后按实测修订各 Lab 预计耗时与全局总投入表。

### S20. 零基础"语言/工具前置自学路径"未成体系

- **证据**：lab1 概览承诺"第一次接触 OS 开发也没关系"，但全书没有一条"我需要先会什么"的自检清单与对应学习路径：C/Rust 语法、汇编、链接器、Git、GDB 首次使用都没有明确的入门指引；ch01 没有参考卡（E11）使该问题加重。
- **对照成熟做法**：xv6 把先修落到具体书与章节（"Before you start coding, read Chapter 1 of the xv6 book"、"Look at K&R, for example Section 5.5"、guidance 页"Make sure you understand C and pointers"并给示例代码），零基础学生有明确的"先去读什么"；rCore 有附录 A "Rust 系统编程入门"（按需列出自学资源清单），并把 GDB 命令表放进每章问答作业。
- **建议**：Lab 1 参考卡加"零基础自检表"（"会不会 C/Rust？会不会用 Git？会不会 GDB 单步？"每个 No 指向一个具体资源：K&R 第 5 章、Git 演练、xv6 syscall lab 式 GDB 演练），并把 ch02 的 GDB 片段升级为"第一次 GDB 演练"（含预期输出，模仿 xv6 syscall lab 的 `b syscall` → `layout src` → `p /x *p` 全流程）。注意课程定位与 rCore 不同（rCore 假设 Rust 先修、xv6 假设 C 先修）：本课程是"设计先行"，语言由学生自选，因此自学路径要按语言分支给出，而不是预设某一种。

## 4. 分文件缺口矩阵

### 4.1 实验卡片（labs/）

| 组件 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | Final |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 概览（学完/耗时/前置/产出） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✗（缺两项）** | ✓ | ✓ |
| 设计问题 | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | —（选题为主） | ✓ | — | — |
| 步骤化操作 + 自检点 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（推荐顺序） | ✓（实验设计步） | ✓ | ✓（工作流） | —（验收清单） |
| 质量门禁（自动+人工） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 设计理据 | —（决策引导） | —（设计自检） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | —（答辩问题） |
| AI 使用边界 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 提交物清单 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 常见问题与排查 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | —（在教材 ch11） |
| 参考卡 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 评分构成/分值 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 挑战/加分项 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 最小成功输出样例 | ✗ | 部分 | 部分（MMU 标记） | 部分（IRQ 统计） | 部分（hello/AB 输出） | ✗ | ✗ | ✗ | 部分（U-Boot 会话） | ✗ | ✗ |
| **难度分级标注（xv6 工时档/rCore 星号）** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **实际耗时记录（time.txt 式）** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **QEMU 交互热键卡** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Git 演练** | 部分（config 一行） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **安装后验证步骤（工具链）** | 部分（仅 vos） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 4.2 教材章节（book/）

| 组件 | ch01 | ch02 | ch03 | ch04 | ch05 | ch06 | ch07 | ch08 | ch09 | ch10 | ch11 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 章级学习目标 | ✗ | ✓（任务清单） | ✗ | ✗ | ✗ | ✗ | ✗ | 部分（方向级） | ✗ | ✗ | ✗ |
| 前置知识小节 | ✗（散落） | ✗（隐含） | ✗ | 部分（阶段依赖） | 部分（阶段依赖） | 部分（阶段依赖） | 部分（阶段依赖） | ✓（前置阶段） | ✗ | ✗ | ✗ |
| 时间估计 | ✗ | ✗ | ✗ | ✗ | 部分（按段） | ✗ | ✗ | 部分（周级表） | ✗ | ✗ | ✗ |
| 环境搭建（安装/版本） | ✗（一句） | 部分（命令无安装） | ✗ | ✗ | ✗ | ✗ | ✗ | 部分（命令无安装） | 部分（命令无安装） | ✗ | ✗ |
| 步骤化任务+命令 | 部分 | 部分（调试部分强） | 部分（无命令） | 部分 | ✓（三段导航） | 部分 | 部分 | ✓（方向步骤） | ✓ | ✓（教程级） | 部分 |
| 预期输出/验收（门禁） | 部分（问题式） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 提示/Hints | ✓ | ✓ | 部分 | ✓ | ✓ | ✓ | 部分（决策树） | 部分 | 部分 | 部分（原则） | 部分 |
| 常见陷阱/FAQ | ✓（5 条） | ✓（12 条） | ✓（9 条） | ✓（8 条） | ✓（10 条） | ✓（7 条） | ✓（7 条） | ✓（6 条） | ✓（11 条） | ✓（4 条） | ✓（5 条） |
| 调试方法 | ✗ | ✓（强） | 部分（断言类） | ✓（csrr/monitor） | ✓（GDB） | 部分 | ✗ | 部分（仅 C1） | ✓（JTAG/OpenOCD） | ✓（五层法） | ✗ |
| 分级练习/分值 | ✗（思考题未分级） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | 部分（探索问题无分值） | 部分（⚡ 无分值） | 部分（⚡ 无分值） | ✗ |
| 参考实现/代码示例 | ✓（教学示例） | ✓（完整代码） | ✗（几乎无） | 部分（签名级） | 部分（伪代码） | 部分（布局/签名） | 部分（API 签名） | 部分（A1 完整 C） | 部分（HAL 示例） | ✓（教程级完整） | ✗ |
| 与 Lab 的显式衔接 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（但重复引用块） |
| 参考卡 | **✗（无）** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **QEMU 交互热键说明** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Git 基础讲解** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **首次 GDB/工具演练（含预期输出）** | ✗ | 部分（命令无演练） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **语言/工具前置自学路径** | ✗（一句承诺） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## 5. 具体不一致与编辑错误清单（已核验）

| # | 位置 | 问题 | 修复建议 |
| --- | --- | --- | --- |
| E1 | `book/ch02-boot.md` §2.2 | 节顺序 2.2.6 → 2.2.8 → 2.2.7，且开头称"七个主题"而编号有 1–8 | 重排 2.2.7/2.2.8；"七个主题"改为"八个主题（含一节选读）" |
| E2 | `book/ch04-interrupts.md` §4.6 | `spec/modules/interrupt.yaml`/`uart.yaml`/`timer.yaml` 无 `kernel/` 前缀，与 ch02/03/05 和 Lab 4 的 `kernel/trap` 冲突 | 统一为 `spec/modules/kernel/*.yaml`（或全书声明模块目录约定） |
| E3 | `book/ch07-resource-abi.md` §7.3 | 直接以"维度 2"开头，无"维度 1" | 补维度 1（建议：资源类型与句柄空间——即 7.2 六范式的决策映射）或改编号 |
| E4 | `book/ch08-personal-goal.md` | 无 §8.3（8.2.6 跳 8.4） | 补 8.3 或重排编号 |
| E5 | `book/ch08-personal-goal.md` §8.2.0/§8.2.0.1/§8.2.1 与各方向节标题 | F 簇编号两套并存（速查表 F3=GUI/F6=COW… vs 节标题 F2=GUI/F3=COW…），正文引用（F6 COW、F10 权限、F12 Hypervisor）与之一并冲突 | 统一编号并全局替换引用；迁移说明补 F 簇重编号记录 |
| E6 | `book/ch11-comprehensive-assessment.md` | "对应实验"块quote在 L3 与 L130 重复出现 | 删除其一 |
| E7 | `labs/final-lab.md` | §8"参考卡"与 §9"最终参考卡"内容重复 | 合并 |
| E8 | `labs/lab8-personal-goal.md` §5 | 命令使用 `<goal-id>`、`<module>` 占位符，是全部 Lab 命令中唯一未给出具体 ID 的（其余 Lab 均用 `kernel/boot` 等真实 ID） | 给出示例 ID（如 `goal/sched-latency` 或注明"替换为你的 GoalSpec 稳定 ID"并给一个示例值），消除"复制粘贴后直接运行"的失败路径 |
| E9 | `labs/lab7-resource-abi.md` | 概览/提交物写"resource ModuleSpec"，但契约骨架与工作流只实现 `kernel/pipe`；正文一段说明资源管理通常为 L3 ModuleSpec，但没有给出 resource 模块（对象表/引用计数）的骨架 | 明确"本 Lab 至少产出 resource 模块 + pipe 模块"两个骨架，或把骨架改名为 `kernel/resource` 并让 pipe 作为其首个实例 |
| E10 | `labs/lab5-user-space.md` | "lab2-4"/"lab5"小写写法与全手册"Lab N"大写不一致 | 统一大写 |
| E11 | `book/ch01-overview-design.md` | §1.7 承诺"命令、平台和调试要点直接放在对应正文的参考卡中"，但 ch01 本身没有参考卡（ch02+ 均有） | 为 ch01 补参考卡（至少含"工具链/查阅路径速查"，并承载 S20 的零基础自检表） |
| E12 | `book/ch04-interrupts.md` §4.9-7、§4.7-C | "QEMU monitor `info qtree` 查看 PLIC 状态"与"通过 QEMU monitor 注入中断"不可直接执行（`info qtree` 只转储设备树；monitor 无通用中断注入命令） | 改写为可执行手段（`info qtree` 查看设备模型 + GDB 写 PLIC 寄存器/用测试设备触发；注入改 qtest 或注明"需自定义测试 harness"） |
| E13 | `book/ch04-interrupts.md` 参考文献 | 外部文献（IBM S/360 手册等）无 URL | 补可点击链接或归档位置 |
| E14 | `book/ch06-filesystem.md` §6.2 | "维度 8a"插入式编号（介于维度 8 与 9 之间）；ch09 有"维度 2a/3a"同型问题 | 统一为常规编号或全篇统一"2a"式子编号并在首次出现处说明 |
| E15 | `book/ch08-personal-goal.md` | "多个 GoalSpec 和 DesignSpec 组合不变量"以分散空格强调出现至少 4 次（疑为丢失的加粗标记）；F6 陷阱 5"网络栈复制重定位代码"疑为"代码栈"笔误 | 恢复标记/修正文字 |
| E16 | `book/ch07-resource-abi.md` | "## 7.3 ABI设计"中英之间缺空格（全章唯一） | 改为"ABI 设计" |
| E17 | `book/ch08-personal-goal.md` | 方向结构不统一：F1/F2/F6/F7/F8/F9/A1 有完整目标设计工作表；F3/F4/F5、C/O/X/A2–A4 没有；H1/H2 有步骤+里程碑而 H3/H4/H5 只有概述+检查点 | 统一结构或注明"探索类方向只需检查点"的公开约定 |
| E18 | `docs/manual/README.md` | 学生手册 README 提到"参考实现与实验索引"等，但没有全局工作量汇总、术语表入口（见 S5/S12） | 增补 |
| E19 | `labs/lab1-seed.md` §步骤2a 与 `labs/lab9-hardware-port.md` | Lab 9 §1 只回指"确认 Lab 1 的板卡身份、启动介质和串口记录已经提交"，未回指 Lab 1 步骤 2a 的"准备 request 和材料"清单；两份重复描述的 request 形状规则（`revision: 0`/`status: request`/材料目录）有漂移风险 | Lab 9 增加"request 与材料按 Lab 1 步骤 2a 准备"的精确回指，避免两处各自维护规则 |
| E20 | `ch08` §8.2.1 迁移注 | "USB 设备驱动和 PCI 总线枚举已迁移到硬件驱动簇 (H1/H2)"——该注解释了 USB/PCI 迁移，但未解释 F 簇重编号（与 E5 关联） | 合并进重编号说明 |

## 6. 按优先级排序的改进建议

### P0（影响正确性与可执行性，应在下一版修订前完成）

1. **E5**：统一 ch08 F 簇方向编号并修正速查表与正文引用（学生选题与 GoalSpec 依赖方向 ID）。
2. **E2**：统一 Spec 路径/模块 ID 约定（ch04 §4.6 改 `kernel/` 前缀，或全书声明约定）。
3. **S2 相关 + E3**：修复 ch02 节顺序、ch07 维度 1、ch08 §8.3 等编号断裂。
4. **E12**：改写 ch04 不可执行的调试/注入指引（否则学生照做会卡死）。
5. **S1**：补齐 Lab 9 概览缺失的两项。
6. **E4/E6/E7/E8/E9**：编辑级错误与占位符清理。

### P1（显著提升教学效果，建议一学期内完成）

1. **S4 + S18**：Lab 1 增补内核工具链安装卡（分平台 + 版本 + 安装后验证命令与期望输出，三件套）；书本章节引用之。
2. **S16 + S17**：Lab 1 参考卡增补"QEMU 交互热键卡"与"Git 五分钟演练"（均带命令与预期输出，照 xv6 做法）。
3. **S20**：Lab 1 参考卡增补"零基础自检表"（C/Rust/Git/GDB 各自的"不会→去学什么"），并把 ch02 的 GDB 片段升级为含预期输出的首次演练。
4. **S5 + S19**：全局工作量总览表（ch01/README）+ 缺时间章节补估计 + 每个 Lab 提交物加 `time.txt` 式实际耗时记录。
5. **S6**：各章补"学完你能…"目标清单（推广 ch02 做法）。
6. **S7**：Lab 卡片增加"评分构成"；⚡ 挑战标注难度（复用 xv6 <1h/1–2h/>2h 或 rCore 星号）与建议分值；扩展 rubric.md。
7. **S11**：每个 Lab 增加"最小成功输出样例"（升级为含提示符的完整会话格式）。
8. **S9**：公开链接 `examples/xv6-spec`；将一份示例 Spec（如 page-allocator）纳入学生可见位置并加注释。

### P2（锦上添花）

1. **S8**：补齐 ch03/ch06/ch07 的调试指引（ch03 页表调试卡可参考 xv6 `info mem` 思路）。
2. **S12**：学生版术语表（README 或 Lab 1 参考卡，照 rCore `terminology.rst` 的"中英对照 + 首现章节"结构）。
3. **S13**：Final Lab 报告示例或报告样式对照 + 每个 Lab 的"可数报告要求"。
4. **S10**：教材-实验内容分工收敛与双向引用。
5. **S14**：教师侧评分表/验收表扩展。

## 7. 对照 xv6/rCore 的"易用性与零基础"达标验收表

下列验收项均直接取自 xv6 6.1810/Fall 2023 课程页面与 rCore-Tutorial-Book-v3 的实际做法（对照证据见 §1.1）。手册修订时逐项勾选；全部达成后，即可认为 vos 手册在"易用程度与零基础可入门"上达到 xv6/rCore 水平。本表不要求逐字照搬——vos 的"规格优先 + 确定性验证"是更重的方法论，学生侧体验组件应保留 vos 特色（如质量门禁、AI 边界），只补"学生第一次使用"的体验缺口。

| # | 验收项 | xv6/rCore 的做法（证据） | vos 手册现状 | 达标标准 |
| --- | --- | --- | --- | --- |
| 1 | 工具链安装给出分平台最小命令 | xv6 tools.html：Debian/Arch/macOS/WSL2 各一段；rCore 阶段 1.1 起分平台 | lab1 只有 Bun/vos（S4） | Lab 1 出现"内核工具链安装卡"：每平台 ≤5 条命令 + 版本下限 |
| 2 | 安装后有验证命令与期望输出 | xv6 "Testing your Installation"（`qemu-system-riscv64 --version` → 5.1.0） | 仅 vos CLI 有验证（S18） | 安装卡带 `--version` 验证 + 失败排查路径 |
| 3 | 第一次运行给出完整预期会话 | xv6 util lab 整段启动日志 + `$ sleep 10` 会话；rCore 实践体验完整日志 | 零散标记，无会话级样例（S11） | 每个 Lab 至少一个"命令 → 完整输出 → 哪个字段对应门禁"的样例块 |
| 4 | 退出/交互热键明确教授 | xv6：`Ctrl-a x`/`Ctrl-p`/`Ctrl-a c`；rCore：`Ctrl+a x`/`Ctrl+]` | 全书无（S16） | Lab 1 参考卡有 QEMU 热键卡，ch02/ch09 引用 |
| 5 | 任务级验收句 | xv6 每任务 "Your solution is correct if…" | Lab 级质量门禁（已有，保留） | 步骤化操作的每个自检点配一句"通过的标准是…" |
| 6 | Git 零基础演练 | xv6 lab 页直接教 clone/checkout/commit/diff（含输出） | 仅 `git config` 一行（S17） | Lab 1 有"Git 五分钟演练"，含 add/commit/status/diff/log/branch |
| 7 | 难度分级标注 | xv6 guidance：Easy/Moderate/Hard 工时档；rCore：`*`/`**`/`***` | ⚡ 挑战无分级（S7） | ⚡ 挑战标注难度档或建议工时 |
| 8 | 实际耗时记录 | xv6 每 lab 提交 `time.txt` | 无（S19） | 每个 Lab 提交物含 `time.txt` 或报告头部"实际耗时"字段 |
| 9 | 零基础自学路径 | xv6 指向 K&R 具体章节；rCore 附录 A 列 Rust 资源 | 一句承诺（S20） | Lab 1 参考卡有"零基础自检表"，每个 No 指向具体资源 |
| 10 | 首次 GDB 演练（含预期输出） | xv6 syscall lab：`make qemu-gdb` → 断点 → 崩溃定位全流程 | ch02 有命令无演练（S8） | 教材出现一段"第一次 GDB"逐步演练，附预期输出 |
| 11 | 术语表带首现章节 | rCore terminology.rst：中英对照 + 出现章节 ref | 无（S12） | 学生发布包有术语表，条目标注"首次出现章节" |
| 12 | 报告要求可数 | rCore final-lab：分析 2–4 个 / 实现 1–2 个；xv6：`answers-*.txt` | 结构清单，无数量级要求（S13） | 每个 Lab 提交物列出可数条目（几段分析/几张截图/几个问答） |
| 13 | 失败时的排查清单 | rCore 环境配置章末 Q&A（"跑不起来时尝试…"）；xv6 guidance 调试技巧 | 各 Lab 有 FAQ（已有，保留） | 工具链安装卡附"装完跑不起来的检查清单"（版本/镜像/PATH） |
| 14 | 每章学习目标可测 | xv6 "Your job"；rCore 章首目标 | 仅 ch02（S6） | 每章开头 3–5 条"学完你能…"，与 Lab 门禁呼应 |

## 8. 结论

整体而言，这套手册的**执行骨架（步骤 → 自检 → 质量门禁 → 提交物 → AI 边界）与证据纪律已达到甚至超过 rCore/xv6 类指导书的水准**，其"规格优先 + 确定性验证 + 人工复核边界"的设计在同类课程中独树一帜。主要不足集中在四块：

1. **一致性与完成度**：编号断裂、模块命名分歧、重复引用、占位符等编辑问题（P0 清单），会直接消耗学生与教师的信任成本；
2. **教学法组件缺失**：书本章节缺学习目标、时间估计、环境搭建与分级分值，教材侧"读物感"强于"指导感"，工作负担几乎全部压在 Lab 卡片上；
3. **脚手架缺失**：缺少已完成 Spec/报告的可见样例、最小成功输出样例、学生版术语表与教师侧评分表，导致"目标明确但合格线模糊"；
4. **零基础与易用性缺口（本轮新增）**：对照 xv6/rCore 原始文档逐项核对后发现，手册缺少 xv6 式的"完整会话样例、任务级验收句、Git/GDB 首次演练、安装验证、time.txt 耗时记录"与 rCore 式的"环境配置分阶段专章、带首现章节的术语表、可数的报告要求"。这些组件成本低、收益集中，且几乎全部可以收进 Lab 1 参考卡与 ch01 参考卡（对应 E11 一并修复），一次修订即可把"第一次接触 OS 开发也没关系"从承诺变成可执行的路径。

建议按 P0 → P1 → P2 顺序整改，并以第 7 节验收表逐项勾选；修订完成后，本报告可在保留审计价值的前提下归档或删除。
