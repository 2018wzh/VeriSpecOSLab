# vos 学生命令参考

`vos` 的学生公开入口只覆盖初始化、规格、Agent、构建运行、验证和提交。命令在项目根目录执行；可用 `--project-root` 指定项目，`--json` 获取结构化结果，并通过 verbose/progress 通用参数控制展示。

## 初始化与诊断

### `vos init`

在空目录中创建空 DesignSpec、工具链 ModuleSpec、`vos.yaml`、`.gitignore`，并建立初始 Git 提交。它不提问，也不生成内核 skeleton。

```sh
vos init
```

### `vos doctor`

未初始化目录只检查 Bun/Git 并提示 `vos init`。已初始化项目先做确定性检查，再调用只读 Debug Agent 阅读 Spec、`vos.yaml` 与现有诊断，推导 required/optional 工具并用 Bash 运行版本、target、编译或运行能力探针。每条工具结论都绑定实际探针证据；Agent 只能给出安装建议。

```sh
vos doctor
```

## Spec

### `vos spec lint [<Spec ID|path|design|all>]`

确定性检查五类 Spec 的结构、未知字段、引用、稳定 ID、路径、等级、`owns` 和 `vos.yaml` 映射。省略目标等同 `all`；指定目标时仍加载完整项目解析引用，只报告目标及其相关诊断。`design` 是 DesignSpec 的保留目标名。它不调用模型，也不判断架构选择是否合理。

```sh
vos spec lint
vos spec lint design
vos spec lint kernel/memory
vos spec lint spec/interfaces/syscall.yaml
```

## Agent

### `vos agent config`

配置 Agent provider、模型、base URL 和凭据环境变量名。无参数时启动交互向导；真实凭据始终放在项目根目录的 `.env`，向导不会要求或回显 key。

```sh
vos agent config
vos agent config --show
vos agent config --check
vos agent config --reset
```

非交互环境使用结构化参数：

```sh
vos agent config \
  --provider openai \
  --model gpt-5 \
  --auth-env OPENAI_API_KEY
```

可用 provider 为 `anthropic`、`openai`、`openai-compatible`、`deepseek` 和 `ollama`。OpenAI-compatible 还需要 `--base-url`。需要使用 `vos kb add/search` 时，使用 `--with-embedding`，并按需传入 `--embedding-provider`、`--embedding-model`、`--embedding-base-url` 和 `--embedding-auth-env`；embedding provider 只支持 `openai` 与 `openai-compatible`。

`--show` 只显示非秘密字段与凭据是否存在；`--check` 严格验证配置和 `.env` 引用；`--reset` 只移除 `[agent]` 与 `[kb.embedding]`，不会删除 `.env`。格式错误和未知字段会直接失败，不会被静默忽略。

## 知识库

知识库来源不写入 `vos.yaml`，统一使用命令管理：

```sh
vos kb add docs/reference --recursive
vos kb list
vos kb search "Sv39 page table"
vos kb remove <source-id>
vos kb export-manifest
```

`clear` 删除当前项目的全部索引；`import-manifest <path>` 导入并校验内容寻址对象。索引与 manifest 保存在 gitignored 的 `.vos/kb/`。

## Agent 角色

### `vos agent ask [question]`

写 Spec 前用它讨论概念、设计空间和取舍。省略问题或使用 `-i` 会进入连续问答。它不生成、修改或提交 Spec。

```sh
vos agent ask "Sv39 页表应由哪个模块拥有？"
vos agent ask -i
```

### `vos agent review [<Spec ID|path|design|all>] [-i]`

这是唯一公开的 Spec Agent。它先运行确定性 lint，再读取目标、相关 Spec 和 `vos.yaml` 的 `verifies` 映射。非交互模式输出结构化 findings，只有 `blocker` 导致 `validation_failed`；`-i` 首轮先给完整评审，随后进入连续问答，结果只作为建议。两种模式都不写文件。

```sh
vos agent review design
vos agent review kernel/memory
vos agent review spec/modules/memory.yaml -i
```

### `vos agent implement <module>`

要求 clean HEAD 和已提交 ModuleSpec。`owns` 必须同时覆盖实现和测试路径。Agent 在 detached linked worktree 中生成实现以及 public、contract、固定种子 fuzz、有界 trace/oracle 和本地 hidden tests；它返回 test target 提案，由 VOS 校验并原子更新 `vos.yaml`。只有 build 与全部已有/新增非隐藏门禁通过、HEAD 未漂移且改动未越过 `owns` 时才写回并提交。

```sh
vos agent implement kernel/memory
```

linked worktree 只是 Git 变更回滚机制，不是进程、网络、凭据或宿主文件安全边界。

### 只读角色

```sh
vos agent debug
vos agent verify
```

- `debug`：报告根因、证据和修复方向；
- `verify`：报告公开测试、契约和 Spec ID 覆盖缺口；
- `ask` 与 `review` 的 Spec 教学用途见上文；

这些角色不得修改项目文件。

## 构建与运行

### `vos build`

执行 `vos.yaml` 的 build target。命令必须使用结构化 `program + args + cwd + env + timeout`，不得拼接 shell 字符串。脏树允许构建，但 evidence 标记为不可提交。

```sh
vos build
```

### `vos run qemu`

执行 QEMU runner，采集非图形串口输出。脏树允许开发态运行，但 evidence 不可提交。

```sh
vos run qemu
```

### `vos run hardware`

执行 hardware runner，记录板卡、构建身份、串口日志和 workload。结果保持 `pending_human_review`，本地启动不能代替人工验收。

```sh
vos run hardware
```

## 验证、报告与提交

### `vos verify`

要求 clean HEAD，确定性运行 spec lint、build、全部 public、contract、固定种子 fuzz 和有界 trace targets，不调用模型。加 `--hidden` 后，还会运行绑定当前 Spec、配置、content hash、模型、seed 和生成 run 的本地 hidden tests，并把验证结果绑定当前 commit。

```sh
vos verify
vos verify --hidden
```

### `vos report`

从提交、Spec ID、测试、日志和 evidence 生成 `.vos/report.json`。不调用模型，不写入 Git。

```sh
vos report
```

### `vos submit`

要求 clean HEAD，并要求当前 HEAD 对应的 `vos verify --hidden` 已通过。命令刷新报告，生成绑定 commit、Spec、config、hidden test 与验证哈希的可复现私有归档。导出时遮蔽凭据并把本机绝对路径替换为稳定别名。

```sh
vos submit
```

## 常见门禁

- `verify`、`agent implement`、权威硬件 evidence 和 `submit` 都要求 clean HEAD。
- Spec 由学生修改，并用普通 `git add/commit` 手动提交；`agent review` 不代替提交。
- 跨模块实现先手写并提交 SpecPatch，允许范围是目标模块与受影响模块 `owns` 的并集。
- 达到 Agent `maxIterations`、验证失败、HEAD 漂移或越界时，原工作树保持不变，只保留诊断、diff 和 evidence。
