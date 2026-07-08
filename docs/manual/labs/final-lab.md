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

## 自学者最终自检清单

如果你没有教师验收，以下是替代教师检查的自我评估清单。每一项都要诚实回答：

### 设计完整性
- [ ] ArchitectureSeed 中的每个 goal 都能在后续阶段找到对应的设计决策
- [ ] 每个 non-goal 在 9 个阶段中确实没有被意外实现
- [ ] 至少 3 个 ADR 记录了关键设计决策及其理由
- [ ] 至少 1 个 SpecPatch 诚实记录了设计变更

### 实现正确性
- [ ] 至少 5 个不变量检查器可运行且通过
- [ ] 至少 1 个跨组件不变量已在 CompositionSpec 中定义且可验证
- [ ] 系统运行 10 分钟不崩溃、不内存泄漏

### 文档自洽性
- [ ] seed.yaml → ArchitectureSlice → ModuleSpec → 实现代码 → 不变量检查器，五层之间没有矛盾
- [ ] 能用一张图画出你的 OS 的完整架构（模块 + 数据流 + 不变量）

### 失败记录
- [ ] 记录了至少 2 个"曾经失败、后来修复"的案例（现象 → 定位 → 根因 → 修复 → 验证）

### 如果还有时间
- [ ] 提供一个可启动的磁盘镜像（`qemu-system-riscv64 -drive file=myos.img`）
- [ ] 写一篇 500 字的 Reflection：如果重做，ArchitectureSeed 会有什么不同？
- [ ] 录制一个 3 分钟的演示视频
