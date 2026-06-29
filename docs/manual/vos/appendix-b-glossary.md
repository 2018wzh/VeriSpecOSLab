# 附录 B：术语表

| 术语 | 英文 | 说明 |
|------|------|------|
| 规格 | Spec | 项目设计真相的结构化描述，存放于 `spec/` 目录 |
| 架构种子 | ArchitectureSeed | 描述系统方向的顶层架构文件 |
| 架构切片 | ArchitectureSlice | 每阶段引入的机制和验证计划 |
| 架构决策记录 | ADR | Architecture Decision Record，关键设计决策及其替代方案 |
| 模块规格 | ModuleSpec | 描述模块状态、接口、不变量和测试表面 |
| 操作契约 | OperationContract | 描述单个操作的前后置条件、锁规则、失败语义、测试义务 |
| 组合规格 | CompositionSpec | 跨模块不变量 |
| 目标验证合约 | GoalValidationContract | 个性化目标的 baseline/target/correctness_guard |
| 规格补丁 | SpecPatch | commit-backed 设计演化记录 |
| 工具链规格 | ToolchainSpec | 工具无关的构建/链接/镜像/运行语义规范 |
| StageGate | StageGate | 阶段门禁，限定当前阶段允许的操作范围 |
| 验证矩阵 | Public Verification Matrix | 声明公开验证项及其关联 spec |
| 证据 | Evidence | 命令执行的记录，含 manifest、events、artifacts |
| 运行 ID | run-id | 每次命令执行的唯一标识 |
| 构建变体 | BuildVariant | 编译期配置集合（如 baseline、test） |
| Agent | Agent | 受控 AI 协作者，身份绑定固定能力包 |
| deterministic gate | deterministic gate | VOS 的确定性格裁决机制 |
| policy gate | policy gate | 策略门禁，拦截越权操作 |
| Provider | Provider | LLM 服务提供方配置 |
| KB | Knowledge Base | 本地知识库，支持语义搜索 |
| 可见性投影 | Visibility Projection | 按阶段控制 spec 的可见范围 |
| SBI | SBI | RISC-V Supervisor Binary Interface |
| Sv39 | Sv39 | RISC-V 三级页表方案 |
| QEMU | QEMU | 硬件模拟器 |
| OpenSBI | OpenSBI | RISC-V 开机固件 |
| freelist | freelist | 空闲页链表 |
| ecall | ecall | RISC-V 环境调用指令 |
