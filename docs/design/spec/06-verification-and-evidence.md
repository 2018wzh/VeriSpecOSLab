# Verification 与 Evidence 标准

## 1. 验证目标

验证层负责把前述 Spec 映射成：

- 公开验证
- 生成验证
- 私有验证标签
- 证据归档
- 报告与评分映射

## 2. 推荐目录

```text
spec/verification/
  public-matrix.yaml
  evidence-schema.yaml
  report-contract.yaml
```

## 3. Public Verification Matrix

推荐字段：

```yaml
stage:
public_requirements:
  - id:
    description:
    related_specs:
    required_tests:
    required_artifacts:
```

## 4. EvidenceSchema

每个验证项应能映射到标准化证据：

```yaml
evidence_item:
  id:
  kind: build_log | test_log | qemu_log | trace | benchmark | review_note
  producer:
  related_specs:
  pass_condition:
  artifact_paths:
```

## 5. OperationSpec 与验证的绑定规则

每个 `OperationContract` 至少应绑定：

1. 一个公开测试义务
2. 一个可观察结果
3. 一个失败语义检查点

并发或权限敏感操作还应绑定：

1. race / interleaving 类测试
2. invalid authority 类测试
3. resource lifetime 类测试

## 6. 报告契约

最终报告和阶段报告至少应引用：

- 相关 ArchitectureSlice
- 相关 ModuleSpec / OperationContract
- 对应验证证据
- 是否触发过 SpecPatch，以及对应的 `spec_patch_id`
- 复现锚点 `commit_sha`，必要时包括 `parent_sha`
- 是否有 AI 参与和参考材料使用

验证复现以 commit SHA 为输入锚点。SpecPatch metadata 用于解释设计影响、
选择最小验证范围和列出 required regressions；它不替代 commit diff。

## 7. 与评分映射的关系

评分不应只看“最终是否运行”，还应映射：

- 设计是否完整
- 规格是否明确
- 验证是否覆盖关键性质
- 证据是否可复现
- 演化是否可追溯
