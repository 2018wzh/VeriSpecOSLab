# 06 Knowledgebase And Reference Policy

## 1. 目标

Knowledge base 负责教学支持，不负责给出可提交答案。

其输出必须：

- 可解释
- 可裁剪
- 可审计
- 可限制复用粒度

## 2. 参考材料类型

建议支持：

- `design_doc`
- `spec_example`
- `code_snippet`
- `anti_pattern`
- `debug_case`

对应输出结构：

```yaml
ReferencePayload:
  source_type:
  visibility: public | agent-only
  excerpt:
  usage_limit: explanation_only | snippet_only
  how_design_differs:
```

## 3. 可见性分级

- `public`：课程公开设计文档、公开 spec 样例、教学反例
- `agent-only`：仅供 agent 生成解释的裁剪材料，不直接面向学生原样展示

禁止：

- 输出其他学生仓库代码
- 输出 hidden tests 全文
- 输出可直接拼成完整提交的长代码段

## 4. 输出规则

KnowledgeBaseAgent 必须同时给出：

- 相关性说明
- 与当前设计的差异
- 使用限制说明

对于 `code_snippet`：

- 默认限制为最多 N 行的片段化解释
- 必须附带“不能直接提交”的提醒

## 5. 引用审计

每次输出参考材料，都应记录：

- 来源标识
- 材料类型
- 可见性
- 使用限制
- 当前绑定任务

运行时应把这类记录汇总进 `KnowledgeBaseReferenceLog`。

## 6. 防抄袭策略

最小策略：

- 优先输出 spec 示例和反例，次选代码片段
- 代码片段仅用于解释局部模式
- 要求学生或上层 UI 能看到“how my design differs”
- Review 阶段可结合 patch 相似度和引用日志复核

## 7. SpecFS 参考的使用方式

SPECFS / AtomFS 风格参考适合用于：

- 展示 rely / guarantee 如何切分
- 展示两阶段 prompt 输入如何组织
- 展示操作级 spec 到单函数实现的映射方式

不适合直接作为：

- VeriSpecOSLab 的标准实现模板
- 学生可直接提交的 C 代码来源
