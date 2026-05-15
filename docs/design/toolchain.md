# VeriSpecOSLab VOS 工具链 CLI 设计文档

> **定位**：`vos` 是 VeriSpecOSLab 课程实验中的统一工具链入口，只面向 **Agent 驱动的开发、验证、调试、审计与报告生成**。  
> 它不是给学生绕过设计过程的一键生成器，也不是通用 OS 构建脚手架。

---

## 1. 设计依据

VeriSpecOSLab 的整体闭环是：

```text
Spec → Agent → Patch → Build → Test → Validate → Feedback → Spec / Code 修正
```

现有架构设计要求 Agent 不直接猜测项目命令，而是通过统一的 `vos` 命令调用标准工具链。原设计中已给出如下统一入口：

```bash
vos init
vos spec lint specs/memory/page_allocator.yaml
vos arch lint specs/architecture/design_goal.yaml
vos arch derive-tests specs/architecture/design_goal.yaml
vos build
vos run qemu
vos test
vos verify base
vos verify architecture
vos verify composition
vos verify goal
vos trace
vos debug
vos agent serve
vos submit pack
```

SYSSPEC 的核心经验是：不能依赖模糊自然语言直接生成复杂系统，而应使用结构化规格描述功能、模块性和并发，再通过 SpecCompiler、SpecValidator、SpecAssistant 等 Agent 形成生成—验证—反馈循环。LLM 生成具有不确定性，因此必须通过验证器和 retry-with-feedback 机制约束生成结果。

因此，`vos` 的核心职责是：

```text
把 Agent 的“意图”变成可审计、可复现、可验证的工具调用。
```

---

## 2. 设计目标

### 2.1 主要目标

`vos` 应支持以下能力：

```text
1. 为 Agent 提供稳定、结构化、可审计的命令接口。
2. 统一调用 spec lint、arch lint、build、QEMU、test、verify、trace、debug、report。
3. 将每次 Agent 行为绑定到 Spec、Patch、Test、Log 和 Evidence。
4. 支持失败后自动生成机器可读反馈，供 Agent 修复规格或代码。
5. 支持课程平台、CI/CD、Online Judge 和本地 DevBox 复用同一命令入口。
6. 防止 Agent 绕过规格、测试、权限和审计。
```

### 2.2 非目标

`vos` 明确不做：

```text
1. 不提供“一键生成完整 OS”。
2. 不允许无 Spec 直接生成核心模块实现。
3. 不暴露隐藏测试源码。
4. 不替代教师评分策略。
5. 不允许 Agent 删除测试、关闭 invariant checker 或绕过验证。
6. 不面向学生提供自由 shell 权限。
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
Agent Runtime
        |
        v
vos CLI
        |
        +----------------------------+
        |                            |
        v                            v
Spec Engine                  Toolchain Runtime
- spec parser                - build
- spec lint                  - qemu
- arch lint                  - gdb
- derive tests               - unit tests
- invariant binding          - fuzz
- validation plan            - trace
        |
        v
Evidence / Audit / Report
```

`vos` 处于 Agent Runtime 与底层 DevBox 工具链之间。它不做复杂智能决策，而是提供受控执行、结构化输出和证据采集。

---

## 4. 命令设计原则

### 4.1 Spec-first

核心模块开发必须先存在对应规格。

```text
vos impl apply
vos agent fix
vos patch apply
```

这些命令在执行前必须检查：

```text
- 是否存在 ModuleSpec
- 是否通过 spec lint
- 是否绑定测试义务
- 是否存在允许的修改范围
- 是否需要 spec patch
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

所有命令必须支持：

```bash
--json
--report <path>
--evidence-dir <dir>
--agent-session <id>
```

Agent 不应解析人类日志，而应读取结构化 JSON。

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
- Agent session id
```

---

# 5. 命令分组

## 5.1 项目与环境命令

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
- 拉取 course-specs
- 初始化 student-specs
- 初始化 reports
- 初始化 .vos metadata
- 检查 DevBox 工具链
```

输出：

```json
{
  "ok": true,
  "project": "verispec-oslab-2026",
  "profile": "riscv64-qemu",
  "created": [
    "student-specs/",
    "src/",
    "tests/",
    "reports/",
    ".vos/"
  ]
}
```

### `vos doctor`

检查开发环境。

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
- runner 权限
- workspace 可写性
```

---

## 5.2 Spec 命令

### `vos spec lint`

检查模块规格语法与语义完整性。

```bash
vos spec lint student-specs/modules/memory/page_allocator.yaml --json
```

检查：

```text
- schema 是否合法
- purpose/state/interface 是否完整
- preconditions/postconditions 是否匹配接口
- invariants 是否可绑定测试或断言
- rely/guarantee 是否引用有效模块
- concurrency spec 是否完整
- test_obligations 是否存在
```

输出：

```json
{
  "ok": false,
  "file": "student-specs/modules/memory/page_allocator.yaml",
  "errors": [
    {
      "code": "MISSING_POSTCONDITION",
      "path": "interface.free_page.postconditions",
      "message": "free_page lacks postcondition for double-free behavior"
    }
  ],
  "warnings": [
    {
      "code": "WEAK_INVARIANT",
      "path": "invariants[1]",
      "message": "Invariant is not bound to any test or runtime checker"
    }
  ]
}
```

### `vos spec normalize`

将学生规格规范化，生成 Agent 可消费的中间格式。

```bash
vos spec normalize \
  student-specs/modules/memory/page_allocator.yaml \
  --out agent-generated-specs/normalized/page_allocator.json
```

### `vos spec check-consistency`

检查多个规格之间的一致性。

```bash
vos spec check-consistency \
  --modules student-specs/modules \
  --architecture student-specs/architecture/composition.yaml
```

检查：

```text
- 模块依赖是否闭合
- rely/guarantee 是否冲突
- 接口引用是否存在
- syscall / IPC / VM / scheduler 是否存在跨模块不变量
- 架构组合是否违反课程边界
```

### `vos spec patch create`

创建规格补丁草案。

```bash
vos spec patch create \
  --change "add copy-on-write fork" \
  --touch memory,process,trap \
  --out student-specs/evolution/patch-003.yaml
```

### `vos spec patch lint`

检查规格补丁是否合法。

```bash
vos spec patch lint student-specs/evolution/patch-003.yaml
```

### `vos spec patch apply`

应用规格补丁，但不直接生成实现。

```bash
vos spec patch apply student-specs/evolution/patch-003.yaml
```

此命令必须：

```text
- 检查 patch DAG 依赖
- 检查影响模块
- 更新 normalized-design
- 派生新的验证计划
- 标记受影响测试
```

---

## 5.3 架构命令

### `vos arch lint`

检查架构设计规格。

```bash
vos arch lint student-specs/architecture/seed.yaml --json
vos arch lint student-specs/architecture/slices/01-boot.yaml --json
```

检查：

```text
- 是否只写 Linux-like / L4-like / NT-like 标签
- 是否说明 borrowed / modified / rejected concepts
- boot model 是否完整
- memory model 是否完整
- privilege model 是否完整
- syscall 或 IPC model 是否完整
- resource lifetime 是否清楚
- verification boundary 是否明确
```

### `vos arch compose`

检查架构组合规格。

```bash
vos arch compose \
  --design student-specs/architecture/seed.yaml \
  --composition student-specs/architecture/composition.yaml
```

输出：

```text
- module graph
- dependency graph
- invariant graph
- risk model
```

### `vos arch derive-tests`

从架构规格派生测试计划。

```bash
vos arch derive-tests \
  student-specs/architecture/seed.yaml \
  --out agent-generated-specs/derived-test-matrix.yaml
```

---

## 5.4 构建命令

### `vos build`

构建内核、用户态程序和镜像。

```bash
vos build --target kernel --json
vos build --target image --profile riscv64-qemu --json
vos build --all --evidence-dir reports/evidence/build
```

输出：

```json
{
  "ok": true,
  "target": "image",
  "artifacts": [
    "build/kernel.elf",
    "build/os.img",
    "build/symbols/kernel.sym"
  ],
  "warnings": [],
  "duration_ms": 18432
}
```

### `vos clean`

清理构建产物。

```bash
vos clean --build
vos clean --all
```

Agent 默认只能使用 `--build`，不能清理证据目录。

---

## 5.5 运行命令

### `vos run qemu`

运行 QEMU。

```bash
vos run qemu \
  --profile riscv64-virt \
  --timeout 30s \
  --serial-log build/qemu/serial.log \
  --json
```

输出：

```json
{
  "ok": true,
  "boot": {
    "reached": "USER_INIT_STARTED",
    "panic": false,
    "timeout": false
  },
  "logs": {
    "serial": "build/qemu/serial.log",
    "qemu": "build/qemu/qemu.log"
  }
}
```

### `vos run workload`

运行指定 workload。

```bash
vos run workload \
  --name user-hello \
  --timeout 10s \
  --trace syscall
```

---

## 5.6 测试命令

### `vos test`

统一测试入口。

```bash
vos test --suite unit --json
vos test --suite syscall --json
vos test --suite ipc --json
vos test --suite memory --json
vos test --suite regression --json
```

输出：

```json
{
  "ok": false,
  "suite": "syscall",
  "passed": 18,
  "failed": 2,
  "failures": [
    {
      "test": "invalid_user_pointer",
      "reason": "kernel panic instead of returning -EFAULT",
      "log": "reports/evidence/tests/syscall/invalid_user_pointer.log"
    }
  ]
}
```

### `vos test derive`

根据 Spec 自动生成公开测试草案。

```bash
vos test derive \
  --spec student-specs/modules/syscall/syscall.yaml \
  --out tests/generated/syscall/
```

### `vos test list`

列出 Agent 可见测试。

```bash
vos test list --visible public,generated
```

隐藏测试只能显示类别和失败摘要，不暴露源码。

---

## 5.7 验证命令

### `vos verify`

统一验证入口。

```bash
vos verify base
vos verify architecture
vos verify composition
vos verify goal
vos verify patch student-specs/evolution/patch-003.yaml
```

验证层级：

```text
base:
  所有学生必须通过的最低能力验证。

architecture:
  根据 ArchitectureSeed、ArchitectureSlice、ArchitectureCompositionSpec 和 FinalArchitectureSynthesis 派生的架构特性验证。

composition:
  跨模块不变量、rely/guarantee 和资源生命周期验证。

goal:
  个性化目标验证，如兼容、性能、安全、硬件移植。

patch:
  针对某个 spec patch 的影响范围验证。
```

### `vos verify invariant`

运行不变量检查。

```bash
vos verify invariant \
  --module memory \
  --runtime \
  --json
```

### `vos verify formal`

调用可选形式化工具。

```bash
vos verify formal \
  --target allocator \
  --engine cbmc \
  --bound 32
```

### `vos verify fuzz`

运行 fuzz。

```bash
vos verify fuzz \
  --target syscall \
  --timeout 60s \
  --seed 1234
```

---

## 5.8 Trace 命令

### `vos trace syscall`

采集 syscall trace。

```bash
vos trace syscall \
  --program usertests \
  --out reports/evidence/traces/syscall.json
```

### `vos trace ipc`

采集 IPC trace。

```bash
vos trace ipc \
  --workload pingpong \
  --out reports/evidence/traces/ipc.json
```

### `vos trace compare`

比较 trace 与 oracle。

```bash
vos trace compare \
  --expected tests/oracle/syscall-basic.json \
  --actual reports/evidence/traces/syscall.json
```

---

## 5.9 Debug 命令

### `vos debug explain-log`

分析日志，输出结构化失败原因。

```bash
vos debug explain-log \
  --log build/qemu/serial.log \
  --kind qemu-panic \
  --json
```

输出：

```json
{
  "ok": true,
  "diagnosis": {
    "kind": "page_fault",
    "phase": "copy_from_user",
    "likely_causes": [
      "missing user pointer validation",
      "incorrect page table permission",
      "kernel dereferenced user pointer directly"
    ],
    "related_specs": [
      "student-specs/modules/syscall/syscall.yaml",
      "student-specs/modules/memory/address_space.yaml"
    ],
    "suggested_next_commands": [
      "vos spec lint student-specs/modules/syscall/syscall.yaml",
      "vos test --suite syscall --filter invalid_user_pointer"
    ]
  }
}
```

### `vos debug gdb`

受控执行 GDB 脚本。

```bash
vos debug gdb \
  --script tools/gdb/backtrace.gdb \
  --core build/qemu/core
```

Agent 不允许传入任意危险脚本；脚本应来自白名单目录。

---

## 5.10 Agent 命令

### `vos agent serve`

启动本地 Agent Gateway。

```bash
vos agent serve \
  --host 127.0.0.1 \
  --port 8080 \
  --project . \
  --policy course-specs/ai-policy.yaml
```

### `vos agent ask`

向 Agent 发起一次受控请求。

```bash
vos agent ask \
  "根据 MemorySpec 检查当前 page allocator" \
  --context student-specs/modules/memory/page_allocator.yaml \
  --json
```

### `vos agent plan`

让 Agent 只生成执行计划，不修改文件。

```bash
vos agent plan \
  --task "fix invalid_user_pointer failure" \
  --from-log reports/evidence/tests/syscall/invalid_user_pointer.log
```

输出：

```json
{
  "ok": true,
  "plan": [
    {
      "step": 1,
      "command": "vos spec lint student-specs/modules/syscall/syscall.yaml"
    },
    {
      "step": 2,
      "command": "vos test --suite syscall --filter invalid_user_pointer"
    },
    {
      "step": 3,
      "action": "prepare_patch",
      "requires_student_confirmation": true
    }
  ]
}
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
1. 检查 patch 是否绑定 Spec
2. 检查修改范围
3. 应用 patch
4. 运行 spec lint
5. 运行 build
6. 运行相关测试
7. 记录 AICollaborationLog
8. 输出 evidence
```

### `vos agent log`

记录或查询 AI 协作日志。

```bash
vos agent log append \
  --session agent-2026-001 \
  --kind implementation_patch \
  --spec student-specs/modules/memory/page_allocator.yaml \
  --evidence reports/evidence/agent-2026-001.json
```

---

## 5.11 报告与提交命令

### `vos report generate`

生成阶段报告或最终报告。

```bash
vos report generate \
  --kind verification \
  --out reports/student-verification-report.md
```

报告内容：

```text
- 规格摘要
- 架构摘要
- 已运行验证
- 失败与修复历史
- 不变量覆盖
- Agent 参与记录
- 未覆盖风险
```

### `vos submit pack`

打包提交物。

```bash
vos submit pack \
  --stage final \
  --out build/submission/verispecoslab-final.tar.zst
```

必须包含：

```text
- student-specs/
- source-code
- tests/public + tests/generated
- reports/
- AICollaborationLog
- Spec Patch History
- final image
- evidence manifest
```

---

## 6. 标准退出码

```text
0   success
1   general failure
2   invalid arguments
3   spec lint failed
4   arch lint failed
5   build failed
6   test failed
7   verification failed
8   policy denied
9   sandbox error
10  timeout
11  hidden test failure summary only
12  audit log failure
```

Agent 必须根据退出码决定下一步，而不是只读取自然语言输出。

---

## 7. 标准 JSON 输出格式

所有命令的 `--json` 输出统一为：

```json
{
  "ok": false,
  "command": "vos test --suite syscall",
  "exit_code": 6,
  "project": {
    "id": "verispec-oslab-2026",
    "profile": "riscv64-qemu",
    "commit": "abc123"
  },
  "inputs": {
    "specs": [],
    "source": [],
    "tests": []
  },
  "outputs": {
    "artifacts": [],
    "logs": [],
    "reports": []
  },
  "diagnostics": [],
  "suggested_next_commands": [],
  "audit": {
    "agent_session": "agent-2026-001",
    "evidence_id": "ev-00042"
  }
}
```

---

## 8. Agent 调用协议

Agent 每次修改核心代码应遵循：

```text
1. vos spec lint <相关规格>
2. vos arch lint <相关架构规格>
3. vos agent plan <任务>
4. 生成 patch
5. vos agent apply-patch --require-spec --run-validation
6. vos verify patch <相关 spec patch>
7. vos agent log append
8. 返回摘要、diff、测试结果和未覆盖风险
```

典型流程：

```text
用户请求：
  “帮我修复 syscall invalid_user_pointer 测试失败”

Agent 不应直接改代码，而应执行：

  vos debug explain-log --log ...
  vos spec lint student-specs/modules/syscall/syscall.yaml
  vos test --suite syscall --filter invalid_user_pointer
  vos agent plan --task ...
  vos agent apply-patch --require-spec --run-validation
  vos verify patch ...
```

---

## 9. 权限模型

### 9.1 角色

```text
student:
  可运行 build/test/verify/report
  可查看公开与生成测试结果
  不可查看隐藏测试源码

agent:
  可通过 vos 执行受控命令
  不可执行任意 shell
  不可删除测试和 invariant checker
  不可修改 course-specs

teacher:
  可配置 course-specs、rubric、hidden tests、judge policy

ci:
  可执行完整验证
  可写入 evidence 和 judge result

judge:
  可执行隐藏测试
  只向学生和 Agent 返回摘要
```

### 9.2 Policy 示例

```yaml
VosPolicy:
  agent:
    allowed_commands:
      - spec lint
      - spec normalize
      - spec check-consistency
      - arch lint
      - arch derive-tests
      - build
      - run qemu
      - test
      - verify
      - trace
      - debug explain-log
      - report generate
      - agent plan
      - agent apply-patch
      - agent log

    denied_commands:
      - shell
      - rm
      - clean --all
      - hidden-test show-source
      - course-specs write
      - invariant-checker disable

    core_module_rules:
      require_spec: true
      require_validation: true
      require_audit_log: true
```

---

## 10. 目录与元数据

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
  student-verification-report.md
  ai-collaboration-log.md
```

`project.yaml` 示例：

```yaml
project:
  id: verispec-oslab-2026
  domain: os
  profile: riscv64-qemu
  student_id_hash: sha256:...
  course_specs: course-specs/
  student_specs: student-specs/
  generated_specs: agent-generated-specs/
  source: src/
  tests: tests/
```

---

## 11. 与 CI/CD 的关系

平台 CI/CD 可以直接调用 `vos`，而不是维护另一套脚本。

```yaml
stages:
  - static-check
  - build
  - unit-test
  - boot-test
  - integration-test
  - verification
  - report

static-check:
  script:
    - vos spec lint student-specs/modules --recursive
    - vos arch lint student-specs/architecture/seed.yaml
    - vos arch lint student-specs/architecture/slices/01-boot.yaml

build:
  script:
    - vos build --all --json

boot-test:
  script:
    - vos run qemu --timeout 30s --json

verification:
  script:
    - vos verify base
    - vos verify architecture
    - vos verify composition
    - vos verify goal

report:
  script:
    - vos report generate --kind ci
```

---

## 12. MVP 命令范围

第一阶段只实现 Agent 开发与验证闭环所需命令：

```bash
vos init
vos doctor

vos spec lint
vos spec normalize
vos spec check-consistency
vos spec patch lint

vos arch lint
vos arch derive-tests

vos build
vos run qemu
vos test
vos verify base
vos verify architecture
vos verify patch

vos debug explain-log
vos trace syscall

vos agent serve
vos agent plan
vos agent apply-patch
vos agent log

vos report generate
vos submit pack
```

暂缓：

```text
- vos verify formal 多引擎完整支持
- vos fuzz 高级调度
- vos benchmark ranking
- vos hardware bring-up 自动化
- vos mutation test
- 多语言 OS profile 自动推断
```

---

## 13. 典型 Agent 工作流

### 13.1 从 Spec 到实现 Patch

```bash
vos spec lint student-specs/modules/memory/page_allocator.yaml --json
vos arch lint student-specs/architecture/seed.yaml --json
vos arch lint student-specs/architecture/slices/02-memory.yaml --json
vos agent plan --task "implement page allocator free_page"
vos agent apply-patch --patch reports/agent/patches/free_page.diff --require-spec --run-validation
vos verify patch student-specs/evolution/patch-001.yaml
vos agent log append --kind implementation_patch
```

### 13.2 从测试失败到修复

```bash
vos test --suite syscall --filter invalid_user_pointer --json
vos debug explain-log --log reports/evidence/tests/syscall/invalid_user_pointer.log --json
vos spec lint student-specs/modules/syscall/syscall.yaml --json
vos agent plan --task "fix invalid user pointer behavior"
vos agent apply-patch --patch reports/agent/patches/fix-user-pointer.diff --require-spec --run-validation
vos verify base
```

### 13.3 从架构变更到验证计划更新

```bash
vos spec patch create --change "switch syscall ABI to message-based IPC"
vos spec patch lint student-specs/evolution/patch-004.yaml
vos spec patch apply student-specs/evolution/patch-004.yaml
vos arch derive-tests student-specs/architecture/seed.yaml
vos verify architecture
vos verify composition
```

---

## 14. 边界定义

`vos` 的边界可以概括为：

```text
Agent 可以通过 vos 开发和验证；
Agent 不可以绕过 vos 自由执行系统命令。

vos 可以生成 patch、测试、报告和证据；
vos 不可以替学生决定架构设计。

vos 可以暴露失败摘要和验证反馈；
vos 不可以暴露隐藏测试源码。

vos 可以驱动 Spec → Patch → Build → Test → Verify；
vos 不可以成为一键代写完整 OS 的工具。
```

这与课程方案的核心边界一致：学生负责设计真实性，教师负责课程公平性，平台 Agent 负责验证真实性与验证灵活度。
