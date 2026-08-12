
# VeriSpecOSLab PPT 汇报大纲

---

## 第一部分：困境（4 页）

### P1 封面
- 标题：VeriSpecOSLab —— AI 辅助、规格驱动的个性化操作系统教学实验方案
- 副标题：2026 年全国大学生计算机系统能力大赛·操作系统设计赛
- 一句话：以规格约束 AI，以验证保障正确，以架构设计训练系统掌控能力

### P2 学生困境：千人一面
- MIT 6.S081：9000 行 xv6 框架，学生补代码缺口
- 清华 rCore：Rust 微内核，预设架构
- 症结：学生学到"怎么实现教师的答案"，没学到"为什么这是我的设计"
- 缺失：从零构建、个性化设计、架构决策训练

### P3 教师困境：被忽视的痛处
- 痛处一：大量时间消耗在低价值重复劳动（debug、环境问题、基础问答）
- 痛处二：评分缺乏设计维度客观依据（只看最终代码跑通率，无法区分"真懂"和"刚跑通"）
- 结果：教师的专业判断力被浪费

### P4 AI 时代的双重挑战
- 对学生：AI 越强，跳过思考的诱惑越大 → 可能变成 prompt engineer
- 对教师：AI 代写无法从最终代码识别 → 学术诚信新威胁
- 我们的回答：不禁止 AI，也不放任 AI

---

## 第二部分：回答一 —— 学生个性化（6 页）

### P5 个性化：5 维度自主设计空间
- 内核组织（宏内核/微内核/Exokernel/...每个选项的权衡）
- 执行模型（进程/线程/调度策略）
- 保护模型（特权级/权限机制/Capability/页表）
- 通信模型（syscall/IPC/消息传递/拷贝策略）
- 资源模型（FD/Handle/Capability/生命周期）

### P6 ArchitectureSeed：系统的第一份设计文档
- 展示真实 xv6-spec ArchitectureSeed YAML
- 关键字段：reference_systems（borrowed/modified/rejected）+ goals + constraints
- 教师价值：第一周就看到学生的设计起点

### P7 ADR：教师最重要的评价窗口
- 同一技术选择（Sv39），两份 ADR 折射的理解深度完全不同
- 教师审查标准：理由具体吗？替代方案被考虑了吗？后果被预见了吗？
- 三个问题 > 48 个测试用例

### P8 个性化目标：让学生定义"什么是我的成功"
- 10 类目标（性能/工程/安全/实时），可组合
- GoalValidationContract：baseline → target → verification → design_constraints
- 不是"附加加分项"，是倒逼全套方案设计的应力验证机制

### P9 指导手册创新
- "设计导航"型：描述问题不预设方案 / 定义门禁不指定方式 / 要求理据不接受"就是这样"
- 历史驱动教学：Atlas 1961→Sv39 / fork()来历 / Meltdown→KPTI
- 分层挑战：同一份材料覆盖零基础到有经验学生

### P10 物理硬件移植（创新点）
- QEMU → 真实 RISC-V/ARM 开发板
- 真实硬件的额外约束：U-Boot/UEFI 启动链、设备树配置、中断控制器手册核对
- 从"教学操作系统"到"真实系统"的关键一步

---

## 第三部分：回答二 —— Agent 受控协作（6 页）

### P11 Agent 身份与能力包
- 展示 `PROFILE_CONFIGS` 代码（taskKinds + toolProfile + skills + outputSchema）
- 7 个身份：spec-author / implementer / debugger / reviewer / reporter / toolchain-author / knowledgebase
- 每个身份绑定唯一能力包，编译时确定，运行时不可越权

### P12 StageGate：梯度释放
- 非二元开关，七级梯度
- Stage 0：spec-author + knowledgebase（只帮理解，不写代码）
- Stage 1：+ implementer（先写规格，再生成代码）
- Stage 3：+ debugger（早期 bug 自己排查）
- Stage 5：+ reviewer + reporter
- 核心逻辑：早期保护设计思维，后期释放效率工具

### P13 Agent 审计：学术诚信有据可查
- 完整审计链路：会话记录 → 工具调用 → 代码 diff → 验证结果 → commit ledger
- 展示 `CommitLedgerEntry` 类型定义（actor: "human"|"agent" / spec_refs / evidence_refs）
- "AI 写的是 AI 写的，我写的是我写的"

### P14 知识库：对抗 AI 幻觉
- 三类知识源（course/project/external）+ 强制引用机制
- 展示 `kb_search` / `kb_lookup` / `kb_add_source` MCP 代码
- 教师价值：知识分发 + 来源审计 + 发现学生普遍困惑

### P15 自动插桩调试 + QMP 可视化
- 四步流程：提取错误 → 推断原因 → 隔离 worktree 注入诊断 → 生成诊断报告
- `vos debug explain-log`：page fault → 页表 L2 缺失 → kvmalloc 问题
- QMP 集成：寄存器/内存映射/页表遍历实时可视化

### P16 可视化：Skill 驱动的交互式 HTML
- visualization skill + bret-victor-tutor skill
- Agent 动态生成交互式 HTML 网页（预计算状态、时间洗涤器、键盘控制）
- 两条发布路径：structured output `visualization_html` 字段 + `mcp__http-server__publish_html`
- 课堂演示：调度器时间片 10ms→1ms，cache 命中率 95%→70%，可拖拽回放

---

## 第四部分：回答三 —— 教师角色升维（5 页）

### P17 三个角色转变
- 转变一：批改作业 → 设计审核（从看代码到审 ArchitectureSlice）
- 转变二：高级调试员 → 规则制定者（配置 StageGate/AI Policy/Rubric）
- 转变三：终结性评价 → 过程性指导（9 阶段全程追踪）

### P18 六阶段审核表
| 阶段 | 教师看什么 | 传统对比 |
|------|-----------|---------|
| architecture-seed | 目标范围、设计方向 | **传统中这一步不存在** |
| boot-minimum | boot chain 设计、可观察性 | 传统：只看 Hello World |
| memory-management | 内存模型自洽、不变量完整 | 传统：只看测试过没过 |
| syscall-ipc | ABI 设计、错误语义、权限边界 | 传统：只看测试过没过 |
| personalized-goal | SpecPatch 合法性、合约可测量 | **传统：个性化目标不存在** |
| final-synthesis | 设计可追溯、证据完整 | 传统：一次考试或提交 |

### P19 评分工具箱 + Analytics
- 三类评分来源：自动验证 + 人工审核(ADR/Slice) + AI 审计(commit ledger)
- 评分从"48 测试过 45 个 = 94 分" → 对设计能力的综合评判
- 5 类 Analytics：阶段通过率 / 失败热区 / AI 使用强度 / 目标分布 / 门禁松紧

### P20 差异化教学
- 对比不同学生的 ArchitectureSeed → 发现设计模式
- 优秀学生：推荐挑战路线
- 困难学生：早期 ADR 中定位问题
- 教师不再对全班说同样的话，而是对每个学生说最需要的话

### P21 AI Policy：教学意图的技术表达
- "这个实验让学生自己设计调度器 → 禁止 Agent 在 process 阶段用 implementer"
- Policy 可版本化，强制执行而非口头提醒

---

## 第五部分：三线交汇 + 技术亮点（4 页）

### P22 三线交汇：OperationContract
- 学生："我的 kalloc 必须在无可用物理页时返回 NULL"
- Agent：读 OperationContract → 执行边界
- 教师：审查设计是否合理、Agent 是否越界
- 一份文档同时回答三个问题

### P23 六对依存关系全景图
- 个性化→教师 / Agent→教师 / 教师→Agent / 教师→个性化 / Agent→个性化 / 个性化→Agent
- 核心论断：Agent 让个性化可规模化，个性化让 Agent 使用可评价

### P24 VOS 工具链六大技术亮点
- 自动插桩调试（隔离 worktree + 四步诊断）
- Skill 驱动交互式可视化（bret-victor-tutor 设计系统）
- Git commit 全程追踪（CommitLedgerEntry 类型）
- 自动生成测例与评测（deriveTestMatrix 三源派生）
- 内置 Agent REPL（身份不混用的设计约束）
- 向量知识库 MCP（sqlite-vec + MCP 六工具）

### P25 平台架构：Portal vs VOS
- Portal = control plane / VOS = repo runtime
- 八子系统 + 三种部署模式
- MVP → Phase 2 → Phase 3 路线图

---

## 第六部分：证据 + 成果（3 页）

### P26 参考实现：xv6-spec
- 67 OperationContract / 21 内核模块 / 48 公开测试 / 9 架构切片
- 展示真实 ArchitectureSeed YAML + OperationContract YAML
- 学生 9 阶段全流程验证数据

### P27 综合对比表
- MIT 6.S081 / rCore / 裸 AI 编程 / VeriSpecOSLab
- 14 个维度全面对比
- 核心差异：个性化目标、AI 治理、教师设计审查、物理硬件移植

### P28 成果展示
- 视频演示：百度网盘链接，完整 vos 构建/运行/Agent debug 可视化全流程
- 在线 Demo：vos-demo.2018wzh.top，可直接体验 Agent 交互式问答
- 访问代码：8b5f14fd44cf9cb4a34716b91f0c6d8a

---

## 第七部分：总结与展望（2 页）

### P29 未来方向
- SpecLab 通用平台：六领域（OS/DB/编译器/网络/运行时/硬件）+ 两层架构
- CaseLab：真实案例驱动的 OS 实验，与 VeriSpecOSLab 互补
- 形式化验证深度集成（seL4 精神 + 教学轻量化路径）
- 跨课程连续化（OS → 编译器 → 数据库 → 网络 → 分布式）

### P30 总结页
- 三条主线一句话：学生设计自己的 OS / AI 在约束下辅助 / 教师审视设计思维
- 核心论断：Agent 让个性化可规模化，个性化让 Agent 使用可评价
- 参考文献：[1] SYSSPEC (ATC 2025) · [2] seL4 (SOSP 2009)
- 致谢 / 团队信息

---

## 附：PPT 制作建议

| 页面类型 | 建议 |
|---------|------|
| 困境页 (P2-P4) | 每页一个痛点，大字 + 简单图示，避免文字堆砌 |
| 架构页 (P5, P11, P22) | 以流程图/关系图为主，文字为辅 |
| 代码证据页 (P6, P11, P13, P14, P24) | 代码块控制在 15 行以内，关键行高亮 |
| 对比表页 (P18, P27) | 用颜色区分 VeriSpecOSLab 列和传统方案列 |
| 教师视角贯穿 | P6-P10, P17-P21 每页保留一句 "👨‍🏫 教师视角" 标注 |
| 成果页 (P28) | 视频截图 + 二维码 + Demo 链接 |

