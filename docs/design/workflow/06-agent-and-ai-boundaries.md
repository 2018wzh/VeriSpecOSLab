# 06 Agent And AI Boundaries

回答的问题：

- Agent 在课程工作流中的介入点是什么
- 面向教师、助教、学生三类角色时，Agent 分别读什么、产出什么
- AI 使用边界和审计要求是什么

上游依赖文档：

- [01-artifacts-and-visibility.md](./01-artifacts-and-visibility.md)
- [05-student-workflow.md](./05-student-workflow.md)
- [../platform/08-agent-gateway-and-ai-governance.md](../platform/08-agent-gateway-and-ai-governance.md)

下游消费者：

- Agent Gateway
- 课程 AI Policy
- 审计与教学诚信流程

## 1. 总原则

Agent 的角色是阶段化辅助，而不是替角色做未经授权的决定。

统一边界：

- 只能读取角色允许的上下文投影
- 只能调用平台允许的工具
- 只能生成受当前阶段约束的建议
- 每次会话都必须进入审计链

## 2. 面向学生的 Agent

学生 Agent 典型介入点：

- 审查 `ArchitectureSeed` 与 `ArchitectureSlice`
- 检查 `ModuleSpec` 缺陷
- 根据已批准 Spec 生成局部 patch 建议
- 解释构建、QEMU、测试和公开验证日志
- 协助整理验证报告和 AI 协作日志

学生 Agent 可读：

- 本项目 repo
- 本地 `spec/` 摘要
- 当前阶段公开规则
- 公开验证摘要

学生 Agent 不可读：

- hidden tests 全文
- staff-only rubric
- 其他学生项目代码

## 3. 面向助教的 Agent

助教 Agent 典型介入点：

- 归类公开失败模式
- 汇总补跑候选项目
- 帮助区分 infra failure 与 impl failure
- 提示需要升级给教师的风险案例

助教 Agent 可额外读到：

- staff 诊断摘要
- 历史补跑记录
- 受控风险标签

## 4. 面向教师的 Agent

教师 Agent 典型介入点：

- 汇总关键阶段审核证据
- 聚合高风险项目
- 解释评分证据映射
- 生成课程复盘摘要

教师 Agent 可额外读到：

- staff-only 评分映射
- 受控 hidden 结果摘要
- 课程级 analytics

## 5. 允许与禁止

允许：

- 解释课程要求摘要
- 审查阶段设计
- 检查 ModuleSpec 缺陷
- 根据已批准规格和当前 StageGate 生成候选实现
- 根据日志定位问题
- 整理证据与报告结构

禁止：

- 越过当前 StageGate 生成未来阶段或未批准模块
- 跳过 ArchitectureSlice 直接生成核心模块
- 没有 ModuleSpec 时生成核心实现
- 删除测试或关闭 invariant checker
- 绕过权限检查
- 直接复制知识库代码
- 隐瞒 AI 参与
- 编造验证结果

## 6. 审计要求

每次 Agent 会话至少记录：

- 会话时间
- 用户、角色、项目、阶段
- 上下文投影摘要
- 工具调用与参数
- 是否产生 patch 建议
- 用户是否接受
- 风险标记

高风险示例：

- 大规模代码生成
- 未运行测试即建议核心 patch
- 试图访问未授权 hidden 信息
- 鼓励删除测试或规避检查
