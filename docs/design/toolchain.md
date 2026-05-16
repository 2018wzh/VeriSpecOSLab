# VeriSpecOSLab VOS 工具链 CLI 设计文档

> **定位**：`vos` 是 VeriSpecOSLab 课程实验中的统一工具链入口，只面向 **Agent 驱动的开发、验证、调试、审计与报告生成**。  
> 在新的模型下，`vos` 面向的是“本地单层 `spec/` + 云端 Spec Service 投影”的工作方式，而不是本地三层 Spec 仓库。

---

## 1. 设计依据

VeriSpecOSLab 的闭环是：

```text
Spec → Agent → Patch → Build → Test → Validate → Feedback → Spec / Code 修正
```

统一入口示例：

```bash
vos init
vos stage show
vos spec lint spec/modules/memory/page_allocator.yaml
vos arch lint spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos build
vos run qemu
vos test
vos verify public
vos verify patch spec/evolution/patch-003.yaml
vos trace
vos debug
vos agent serve
vos submit pack
```

`vos` 的核心职责是：

```text
把 Agent 的“意图”变成可审计、可复现、可验证的工具调用；
同时把本地项目 Spec 与云端课程约束、隐藏验证和证据采集统一起来。
```

---

## 2. 设计目标

### 2.1 主要目标

`vos` 应支持以下能力：

```text
1. 为 Agent 提供稳定、结构化、可审计的命令接口。
2. 统一调用 spec lint、arch lint、build、QEMU、test、verify、trace、debug、report。
3. 将每次 Agent 行为绑定到本地 spec、patch、test、log 和 evidence。
4. 支持从云端拉取当前阶段公开约束投影和私有验证约束。
5. 支持课程平台、CI/CD、Online Judge 和本地 DevBox 复用同一命令入口。
6. 防止 Agent 绕过规格、测试、权限和审计。
```

### 2.2 非目标

`vos` 明确不做：

```text
1. 不提供“一键生成完整 OS”。
2. 不允许无 Spec 直接生成核心模块实现。
3. 不暴露隐藏测试源码、mutation 点和 anti-gaming 规则。
4. 不替代教师评分策略。
5. 不允许 Agent 删除测试、关闭 invariant checker 或绕过验证。
6. 不面向学生提供不受控 shell 权限。
7. 不把 LLM prompt 作为唯一开发依据。
```

---

## 3. 总体架构

```text
IDE / Web / CLI Agent
        |
        v
OpenAI-compatible Agent Gateway
        |
        v
Cloud Spec Service
        |
        v
vos CLI
        |
        +----------------------------+
        |                            |
        v                            v
Project Spec Engine          Toolchain Runtime
- spec parser                - build
- spec lint                  - qemu
- arch lint                  - gdb
- patch impact               - unit tests
- local spec index           - fuzz / trace
- cloud projection client    - report
        |
        v
Evidence / Audit / Report
```

`vos` 不做复杂智能决策，而是负责：

```text
- 读取本地 spec/
- 请求云端公开投影
- 执行验证与证据采集
- 把结构化结果返回给 Agent 或平台
```

---

## 4. 命令设计原则

### 4.1 Spec-first

核心模块开发必须先存在对应本地规格。

执行 patch 相关命令前必须检查：

```text
- 是否存在 ModuleSpec
- 是否通过 spec lint
- 是否绑定测试义务
- 是否需要 SpecPatch
- 是否处于允许修改的阶段
```

### 4.2 Validation-first

每个核心 patch 必须触发最低验证集：

```text
spec lint
arch lint
build
unit test
qemu boot test
relevant regression test
invariant check
```

### 4.3 Machine-readable first

所有命令都应支持：

```bash
--json
--report <path>
--evidence-dir <dir>
--agent-session <id>
```

### 4.4 Audit-always

每次命令执行都应记录：

```text
- command
- arguments
- git commit
- spec hash
- input files
- output files
- tests run
- pass/fail
- logs
- artifacts
- agent session id
- cloud projection version
```

---

## 5. 项目与环境命令

### `vos init`

初始化课程实验仓库。

```bash
vos init \
  --course verispec-oslab-2026 \
  --profile riscv64-qemu \
  --mode agent-driven
```

职责：

```text
- 创建标准目录结构
- 初始化本地 spec/
- 初始化 reports/
- 初始化 .vos metadata
- 记录课程 id 和云端 spec endpoint
- 检查 DevBox 工具链
```

输出示例：

```json
{
  "ok": true,
  "project": "verispec-oslab-2026",
  "profile": "riscv64-qemu",
  "created": [
    "spec/",
    "src/",
    "tests/",
    "reports/",
    ".vos/"
  ]
}
```

### `vos doctor`

检查开发环境与云端连接。

```bash
vos doctor --json
```

检查项：

```text
- clang / gcc / rust / zig
- qemu-system-riscv64 / x86_64 / aarch64
- gdb-multiarch
- python / node / jq / yq
- spec_lint / arch_lint
- workspace 可写性
- cloud spec endpoint reachability
- current course projection availability
```

### `vos stage show`

显示当前阶段的公开约束投影。

```bash
vos stage show --json
```

输出：

```json
{
  "ok": true,
  "stage": "memory-management",
  "public_requirements": [
    "memory_invariants_declared",
    "spec_lint_passed",
    "page_allocator_tests_passed"
  ]
}
```

---

## 6. Spec 命令

### `vos spec lint`

检查模块规格语法与语义完整性。

```bash
vos spec lint spec/modules/memory/page_allocator.yaml --json
```

### `vos spec normalize`

将本地 `spec/` 规格规范化，生成运行时中间表示。

```bash
vos spec normalize \
  spec/modules/memory/page_allocator.yaml \
  --out .vos/cache/normalized/page_allocator.json
```

### `vos spec check-consistency`

检查本地多个规格之间的一致性。

```bash
vos spec check-consistency \
  --modules spec/modules \
  --architecture spec/architecture/composition.yaml
```

### `vos spec patch lint`

检查规格补丁是否合法。

```bash
vos spec patch lint spec/evolution/patch-003.yaml
```

### `vos spec patch apply`

应用本地规格补丁，并触发验证计划更新。

```bash
vos spec patch apply spec/evolution/patch-003.yaml
```

执行时必须：

```text
- 检查 patch DAG 依赖
- 检查影响模块
- 更新 normalized design
- 请求云端重新派生验证计划
- 标记受影响测试
```

---

## 7. 架构命令

### `vos arch lint`

检查架构设计规格。

```bash
vos arch lint spec/architecture/seed.yaml --json
vos arch lint spec/architecture/slices/01-boot.yaml --json
```

### `vos arch compose`

检查架构组合规格。

```bash
vos arch compose \
  --design spec/architecture/seed.yaml \
  --composition spec/architecture/composition.yaml
```

### `vos arch derive-tests`

从本地架构规格派生公开测试计划，并请求云端补全私有验证。

```bash
vos arch derive-tests \
  spec/architecture/seed.yaml \
  --out .vos/cache/derived-test-matrix.public.yaml
```

---

## 8. 构建、运行与测试命令

### `vos build`

```bash
vos build --target kernel --json
vos build --target image --profile riscv64-qemu --json
```

### `vos run qemu`

```bash
vos run qemu \
  --profile riscv64-virt \
  --timeout 30s \
  --serial-log build/qemu/serial.log \
  --json
```

### `vos test`

统一测试入口。

```bash
vos test --suite unit --json
vos test --suite syscall --json
vos test --suite memory --json
vos test --suite regression --json
```

### `vos test list`

只列出学生可见测试。

```bash
vos test list --visible public,generated
```

---

## 9. 验证命令

### `vos verify public`

运行学生可见验证。

```bash
vos verify public
vos verify public --stage memory-management
```

### `vos verify patch`

针对某个规格补丁运行影响范围验证。

```bash
vos verify patch spec/evolution/patch-003.yaml
```

### `vos verify full`

仅平台 / CI / 教师使用，包含隐藏验证。

```bash
vos verify full --json
```

### `vos verify invariant`

```bash
vos verify invariant --module memory --runtime --json
```

### `vos verify fuzz`

```bash
vos verify fuzz --target syscall --timeout 60s --seed 1234
```

---

## 10. Trace 与 Debug 命令

### `vos trace syscall`

```bash
vos trace syscall \
  --program usertests \
  --out reports/evidence/traces/syscall.json
```

### `vos debug explain-log`

分析日志并输出结构化失败原因。

```bash
vos debug explain-log \
  --log build/qemu/serial.log \
  --kind qemu-panic \
  --json
```

输出示例中的相关 spec 路径应使用本地 `spec/`：

```json
{
  "ok": true,
  "diagnosis": {
    "kind": "page_fault",
    "phase": "copy_from_user",
    "related_specs": [
      "spec/modules/syscall/syscall.yaml",
      "spec/modules/memory/address_space.yaml"
    ],
    "suggested_next_commands": [
      "vos spec lint spec/modules/syscall/syscall.yaml",
      "vos test --suite syscall --filter invalid_user_pointer"
    ]
  }
}
```

---

## 11. Agent 命令

### `vos agent serve`

启动本地 Agent Gateway。

```bash
vos agent serve \
  --host 127.0.0.1 \
  --port 8080 \
  --project . \
  --course verispec-oslab-2026
```

### `vos agent context`

显示当前任务的上下文构造摘要。

```bash
vos agent context \
  --context spec/modules/memory/page_allocator.yaml \
  --json
```

### `vos agent plan`

只生成执行计划，不修改文件。

```bash
vos agent plan \
  --task "fix invalid_user_pointer failure" \
  --from-log reports/evidence/tests/syscall/invalid_user_pointer.log
```

### `vos agent apply-patch`

应用 Agent 生成的 patch。

```bash
vos agent apply-patch \
  --patch reports/agent/patches/patch-018.diff \
  --require-spec \
  --run-validation
```

执行顺序：

```text
1. 检查 patch 是否绑定本地 spec
2. 检查修改范围
3. 应用 patch
4. 运行 spec lint
5. 运行 build
6. 运行相关公开验证
7. 请求平台执行必要的私有验证
8. 记录 AICollaborationLog
9. 输出 evidence
```

### `vos agent log`

记录或查询 AI 协作日志。

```bash
vos agent log append \
  --session agent-2026-001 \
  --kind implementation_patch \
  --spec spec/modules/memory/page_allocator.yaml \
  --evidence reports/evidence/agent-2026-001.json
```

---

## 12. 报告与提交命令

### `vos report generate`

```bash
vos report generate \
  --kind verification \
  --out reports/student-verification-report.md
```

### `vos submit pack`

```bash
vos submit pack \
  --stage final \
  --out build/submission/verispecoslab-final.tar.zst
```

必须包含：

```text
- spec/
- source-code
- tests/public + tests/generated
- reports/
- AICollaborationLog
- Spec Patch History
- final image
- evidence manifest
```

---

## 13. 权限模型

### 13.1 角色

```text
student:
  可运行 build/test/verify public/report
  可查看公开与生成测试结果
  不可查看隐藏测试源码

agent:
  可通过 vos 执行受控命令
  可读取本地 spec/
  可读取云端 agent-only 约束摘要
  不可删除测试和 invariant checker
  不可读取未授权云端内容

teacher:
  可配置课程规则、rubric、hidden tests、judge policy

ci:
  可执行完整验证
  可写入 evidence 和 judge result
```

### 13.2 Policy 示例

```yaml
VosPolicy:
  agent:
    allowed_commands:
      - stage show
      - spec lint
      - spec normalize
      - spec check-consistency
      - arch lint
      - arch derive-tests
      - build
      - run qemu
      - test
      - verify public
      - verify patch
      - trace
      - debug explain-log
      - report generate
      - agent context
      - agent plan
      - agent apply-patch
      - agent log

    denied_commands:
      - shell
      - rm
      - hidden-test show-source
      - cloud-spec raw-dump
      - invariant-checker disable
```

---

## 14. 目录与元数据

建议新增：

```text
.vos/
  project.yaml
  toolchain.yaml
  policy.yaml
  sessions/
  cache/
  evidence-index.json

reports/
  evidence/
    build/
    tests/
    verify/
    traces/
    agent/
  agent/
    plans/
    patches/
    logs/
```

`project.yaml` 示例：

```yaml
project:
  id: verispec-oslab-2026
  domain: os
  profile: riscv64-qemu
  spec_root: spec/
  source: src/
  tests: tests/
  cloud_course: verispec-oslab-2026
```

---

## 15. 与 CI/CD 的关系

平台 CI/CD 直接调用 `vos`，而不是维护另一套脚本。

```yaml
stages:
  - static-check
  - build
  - unit-test
  - boot-test
  - verification
  - report

static-check:
  script:
    - vos spec lint spec/modules --recursive
    - vos arch lint spec/architecture/seed.yaml
    - vos arch lint spec/architecture/slices/01-boot.yaml

verification:
  script:
    - vos verify public
    - vos verify full
```

---

## 16. 最小可落地版本

第一阶段只实现：

```bash
vos init
vos doctor
vos stage show

vos spec lint
vos spec normalize
vos spec check-consistency
vos spec patch lint

vos arch lint
vos arch derive-tests

vos build
vos run qemu
vos test
vos verify public
vos verify patch

vos debug explain-log
vos trace syscall

vos agent serve
vos agent context
vos agent plan
vos agent apply-patch
vos agent log

vos report generate
vos submit pack
```

---

## 17. 典型 Agent 工作流

### 17.1 从 Spec 到实现 Patch

```bash
vos spec lint spec/modules/memory/page_allocator.yaml --json
vos arch lint spec/architecture/seed.yaml --json
vos arch lint spec/architecture/slices/02-memory.yaml --json
vos agent plan --task "implement page allocator free_page"
vos agent apply-patch --patch reports/agent/patches/free_page.diff --require-spec --run-validation
vos verify patch spec/evolution/patch-001.yaml
vos agent log append --kind implementation_patch
```

### 17.2 从测试失败到修复

```bash
vos test --suite syscall --filter invalid_user_pointer --json
vos debug explain-log --log reports/evidence/tests/syscall/invalid_user_pointer.log --json
vos spec lint spec/modules/syscall/syscall.yaml --json
vos agent plan --task "fix invalid user pointer behavior"
vos agent apply-patch --patch reports/agent/patches/fix-user-pointer.diff --require-spec --run-validation
vos verify public
```

### 17.3 从架构变更到验证计划更新

```bash
vos spec patch lint spec/evolution/patch-004.yaml
vos spec patch apply spec/evolution/patch-004.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos verify public
```

---

## 18. 总结

`vos` 的边界可以概括为：

```text
Agent 可以通过 vos 开发和验证；
Agent 不可以绕过 vos 自由执行系统命令。

vos 可以读取本地 spec/ 并请求云端约束投影；
vos 不可以把隐藏测试源码和平台私有规则暴露给学生。

vos 可以驱动 Spec → Patch → Build → Test → Verify；
vos 不可以成为一键代写完整 OS 的工具。
```
