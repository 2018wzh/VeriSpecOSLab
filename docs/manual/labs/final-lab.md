# Final Lab: 综合验收与答辩

> 本页是最终实验入口。详细评分标准见 [教师评分细则](../teacher/rubric.md)，最终报告格式见 [最终报告模板](../appendices/final-report-template.md)。

## 目标

汇总阶段 1-9 的设计、实现、验证证据，证明你的 OS 满足 ArchitectureSeed、GoalValidationContract 和 ProfileSpec 中承诺的目标。

## 提交物

- 最终报告
- `vos verify public` 和 `vos verify full` 的运行证据
- 至少一个 SpecPatch 演化案例
- 至少一个失败分析或 AI 修正案例
- 答辩材料：架构图、关键不变量、质量门禁结果

## 验收命令

```bash
bun run vos -- verify public
bun run vos -- verify full
bun run vos -- report generate --final
```
