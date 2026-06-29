# 阶段门禁说明

> 本文档描述 VeriSpecOSLab 的阶段门禁模型及其在平台上的配置方式。

## 门禁模型

每个 StageGate 包含以下要素：

| 要素 | 说明 |
|------|------|
| 阶段名 | 如 `architecture-seed`、`boot-minimum` |
| 前置阶段 | 必须先通过哪些阶段 |
| 必需产物 | 当前阶段必须提交的 Spec 和代码文件 |
| 自动检查 | 平台自动运行的验证项 |
| 人工审核 | 需要教师/助教审核的项目 |
| 解锁条件 | 满足什么条件后才能进入下一阶段 |
| 超时/补交 | 阶段超时后的处理策略 |

## 各阶段门禁配置

### architecture-seed → boot-minimum

```yaml
stage: architecture-seed
prerequisites: []
required_artifacts:
  - spec/architecture/seed.yaml
  - spec/architecture/composition.yaml（骨架）
automatic_checks:
  - vos arch lint
manual_review_policy: required  # 必须人工审核
unlock_condition: all_checks_passed AND manual_review_approved
```

### boot-minimum → memory-management

```yaml
stage: boot-minimum
prerequisites: [architecture-seed]
required_artifacts:
  - spec/architecture/slices/01-boot.yaml
  - spec/modules/boot/module.yaml
  - spec/toolchain/toolchain.yaml
automatic_checks:
  - vos build
  - vos run qemu --timeout 30
  - serial_banner_check
manual_review_policy: optional
unlock_condition: all_automatic_checks_passed
```

### memory-management → interrupt-device

```yaml
stage: memory-management
prerequisites: [boot-minimum]
required_artifacts:
  - spec/architecture/slices/02-memory.yaml
  - spec/modules/memory/module.yaml
  - spec/modules/memory/concurrency.yaml
  - ADR（分页模型）
automatic_checks:
  - vos spec lint
  - vos build
  - vos test --suite memory
manual_review_policy: recommended
unlock_condition: all_automatic_checks_passed
```

### interrupt-device → user-space

```yaml
stage: interrupt-device
prerequisites: [memory-management]
required_artifacts:
  - spec/architecture/slices/03-interrupt.yaml
  - spec/modules/interrupt/module.yaml
automatic_checks:
  - vos test --suite interrupt
  - timer_interrupt_verified
manual_review_policy: optional
unlock_condition: all_automatic_checks_passed
```

### user-space → filesystem

```yaml
stage: user-space
prerequisites: [interrupt-device]
required_artifacts:
  - spec/architecture/slices/04-user-space.yaml
  - spec/modules/trap/module.yaml
  - spec/modules/process/module.yaml
  - spec/modules/syscall/module.yaml
automatic_checks:
  - vos build
  - vos test --suite trap
  - vos test --suite process
  - vos test --suite syscall
manual_review_policy: required  # trap 路径需人工重点审查
unlock_condition: all_automatic_checks_passed AND manual_review_approved
```

### filesystem → resource-abi

```yaml
stage: filesystem
prerequisites: [user-space]
required_artifacts:
  - spec/architecture/slices/05-filesystem.yaml
  - spec/modules/fs/module.yaml
automatic_checks:
  - vos test --suite filesystem
manual_review_policy: optional
unlock_condition: all_automatic_checks_passed
```

### resource-abi → personal-profile

```yaml
stage: resource-abi
prerequisites: [filesystem]
required_artifacts:
  - spec/architecture/slices/06-resource.yaml
  - goal_validation_contract（如非 fd-based 路线）
automatic_checks:
  - vos test --suite resource
  - vos verify full --target goal（如适用）
manual_review_policy: recommended
unlock_condition: all_automatic_checks_passed
```

### personal-profile → hardware-port

```yaml
stage: personal-profile
prerequisites: [resource-abi]
required_artifacts:
  - spec/goal/profile.yaml（ProfileSpec）
  - spec/goal/<direction_id>.yaml（每个方向的 GoalValidationContract）
automatic_checks:
  - vos verify full --target <id>       # 逐方向验证
  - vos verify full --target profile    # 剖面整体验证（含跨方向不变量）
manual_review_policy: required  # 剖面设计需人工审核方向融合的合理性
unlock_condition: all_automatic_checks_passed AND manual_review_approved
```

## 状态与转换

```text
not_started → active → under_review → passed → next_stage_unlocked
                       ↘ needs_fix → active（修正后重新提交）
                                        ↘ timeout → 人工介入
```

## 代理与自动化

- 自动检查由 CI/CD pipeline 触发（每次 push）。
- 人工审核通过 Portal 界面完成。
- 审核意见通过 Portal 通知学生。
- 门禁状态变化触发 Webhook 通知（可选）。
