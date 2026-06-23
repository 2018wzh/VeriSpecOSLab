# 00 Overview

回答的问题：

- 为什么 `workflow/` 需要独立成目录化文档集
- 课程实验的总闭环是什么
- 教师、助教、学生、平台、Agent 如何协作

上游依赖文档：

- [README.md](./README.md)
- [../spec/00-overview.md](../spec/00-overview.md)
- [../toolchain/00-overview.md](../toolchain/00-overview.md)
- [../platform/00-overview.md](../platform/00-overview.md)

下游消费者：

- 课程设计者
- 教师与助教实施团队
- 平台产品与实现设计
- Agent 治理与审计设计

## 1. 定位

`workflow/` 定义课程的递进式教学过程。它不管某个服务具体怎么实现，只管谁在什么时候做什么、依赖什么输入与证据、触发什么系统动作、看到什么反馈、如何进入下一阶段。

对 VeriSpecOSLab 而言，课程不是“交一次代码跑一次评测”，而是一个连续工程闭环：

```text
Progressive Design
  -> Spec Authoring
  -> Implementation
  -> Verification
  -> Feedback
  -> Evolution
  -> Final Synthesis
```

## 2. 核心原则

1. 学生先提交设计，再提交实现，再通过证据证明实现与设计一致。
2. 教师定义课程边界、阶段门禁和评分规则，不直接提供唯一标准答案。
3. 助教负责协助审核、异常排查、补跑、答疑和申诉处理，不替代教师做最终课程裁决。
4. Agent 只能在受控权限下读取公开投影和本地上下文，不能绕过阶段门禁与审计。
5. 平台依据设计、验证和过程证据评分，而不是只依据最终镜像是否跑通。

## 3. 角色协作总览

```text
教师
  -> 创建课程与实验
  -> 配置 stage gates / rubric / AI policy
  -> 审核关键阶段与最终结果

助教
  -> 维护审核队列
  -> 归因公开失败
  -> 处理补跑与申诉
  -> 向教师升级风险

学生
  -> 维护本地 spec/
  -> 提交 ArchitectureSlice / ModuleSpec / 实现 / 报告
  -> 根据公开反馈继续修正设计与代码

平台
  -> 供应仓库与工作区
  -> 派生公开/私有验证
  -> 归档 evidence
  -> 管理阶段状态与成绩发布

Agent
  -> 基于权限投影提供设计、实现、验证和报告辅助
  -> 保留完整审计链
```

## 4. 课程闭环

课程主线可以压缩为：

```text
course setup
  -> experiment publish
  -> enrollment and provisioning
  -> staged design review
  -> staged implementation and verification
  -> final freeze and scoring
  -> appeal and teaching retrospective
```

如果按角色视角展开，则是：

```text
教师发布实验
  -> 学生加入并获得仓库
  -> 学生提交阶段设计
  -> 平台执行自动检查
  -> 助教处理审核与异常
  -> 教师在关键阶段做裁决
  -> 学生继续演化设计与实现
  -> 平台冻结、评分、发布结果
  -> 教师与助教复盘课程数据
```

## 5. 阶段模板

`workflow/` 中每个阶段都按同一模板理解：

- 目标
- 输入
- 检查
- 角色动作
- 证据
- 失败分支
- 解锁条件

这套模板用于统一教师审核、助教排障、学生执行和平台状态流转。
