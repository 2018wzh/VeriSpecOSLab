# AI 协作日志指南

AI 协作日志（`reports/ai-collaboration-log.md`）是你在 VeriSpecOSLab 中所有 AI 交互的完整记录。它有三个作用：

1. **对你**：追溯设计思路的演化，复盘 AI 辅助的效果
2. **对教师**：审计你的 AI 使用是否符合策略
3. **对平台**：关联 AI 交互与 git commit 历史，验证代码来源

## 日志格式

每条交互记录使用以下格式：

```markdown
## [2026-03-15 14:30] 审查页分配器 ModuleSpec

**Agent 身份**: spec-author.v2
**阶段**: memory-management
**关联 Spec**: spec/modules/kernel/memory/module.yaml

### 输入
提交了页分配器 ModuleSpec 草稿，要求检查：
- module_invariants 是否完整？
- error_model 是否覆盖所有错误路径？

### 输出
AI 指出：
- 缺少 "free 后该页不可再被访问" 的不变量
- kfree(NULL) 的语义未定义
- 建议增加 allocated_count 用于泄漏检测

### 处理
- ✅ 采纳：添加了 "freed_page_not_accessible" 不变量
- ✅ 采纳：定义了 kfree(NULL) = no-op
- ✅ 采纳：增加了 allocated_count
- ❌ 拒绝：AI 建议使用 buddy allocator 替代 freelist
  - 理由：freelist 足够满足我的需求，buddy 增加了复杂度但不增加教学价值

### 验证
- vos spec lint 通过
- page_allocator_invariant_checker 通过
- 确认 kfree(NULL) 在所有调用路径上行为正确
```

## 必须记录的交互

以下类型的 AI 交互**必须记录**：

| 交互类型 | 必须记录 |
|---------|:---:|
| AI 审查了你的 Spec 草稿 | ✅ |
| AI 生成了代码 patch | ✅ |
| AI 帮助诊断了错误 | ✅ |
| AI 建议了设计变更 | ✅ |
| AI 生成了测试用例 | ✅ |
| AI 帮助整理了报告 | ✅ |
| 纯信息查询（"什么是 Sv39"） | 可选（建议记录） |

## 记录的三个核心问题

每条记录必须回答：

1. **AI 给了什么？** — 如实记录，不美化不删减。
2. **你做了什么？** — 采纳？修改？拒绝？为什么？
3. **结果如何？** — 验证通过了吗？出过错吗？

## 日志与 Git 的对应

Git commit 中由 AI 生成的代码应该能在日志中找到对应的交互记录。审查原则：

```text
如果一段代码出现在 commit 中，但在 AI 日志中找不到来源 →
要么是学生自己写的（没问题），
要么是 AI 生成但未记录（违反策略）。
```

## 日志质量

好的日志：

- 记录了具体的 Spec 文件和操作名，不是模糊的"讨论了内存管理"
- 记录了采纳/拒绝的具体理由，不是"AI 说……就改了"
- AI 的错误或不当建议也被记录，不是只记录成功的交互

差的日志：

```markdown
## AI 帮助了很多

AI 帮我写了代码。很好。
```
