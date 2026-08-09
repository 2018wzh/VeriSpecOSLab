# vos 学生命令参考

`vos` 的学生公开入口只覆盖初始化、规格、Agent、构建运行、验证和提交。命令在项目根目录执行；可用 `--project-root` 指定项目，`--json` 获取结构化结果，并通过 verbose/progress 通用参数控制展示。

## 初始化与诊断

### `vos init`

在空目录中创建空 DesignSpec、工具链 ModuleSpec、`vos.yaml`、`.gitignore`，并建立初始 Git 提交。它不提问，也不生成内核 skeleton。

```sh
vos init
```

### `vos doctor`

检查 Git、项目文件、工具链和 Agent 配置。失败项应说明缺少的命令、文件或字段以及修复方向。

```sh
vos doctor
```

## Spec

### `vos spec check`

确定性检查五类 Spec 的结构、未知字段、引用、稳定 ID、路径和等级。它不调用模型，也不判断架构选择是否合理。

```sh
vos spec check
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

可用 provider 为 `anthropic`、`openai`、`openai-compatible`、`deepseek` 和 `ollama`。OpenAI-compatible 还需要 `--base-url`。KB 有锁定来源时，使用 `--with-embedding`，并按需传入 `--embedding-provider`、`--embedding-model`、`--embedding-base-url` 和 `--embedding-auth-env`；embedding provider 只支持 `openai` 与 `openai-compatible`。

`--show` 只显示非秘密字段与凭据是否存在；`--check` 严格验证配置和 `.env` 引用；`--reset` 只移除 `[agent]` 与 `[kb.embedding]`，不会删除 `.env`。格式错误和未知字段会直接失败，不会被静默忽略。

### `vos agent design [--confirm]`

生成 DesignSpec 的结构化差异。默认不写项目；`--confirm` 才原子应用并单独提交。

```sh
vos agent design
vos agent design --confirm
```

### `vos agent spec <module> [--confirm]`

生成指定 ModuleSpec 的结构化差异。确认后原子应用并单独提交。

```sh
vos agent spec memory
vos agent spec memory --confirm
```

### `vos agent implement <module>`

要求 clean HEAD 和已提交 ModuleSpec。在 detached linked worktree 中实现、构建和验证；只有全部门禁通过、HEAD 未漂移且改动未越过允许的 `owns` 时才写回并提交。

```sh
vos agent implement memory
```

linked worktree 只是 Git 变更回滚机制，不是进程、网络、凭据或宿主文件安全边界。

### 只读角色

```sh
vos agent debug
vos agent verify
vos agent kb "Sv39 的三级页表如何索引？"
vos agent review memory
```

- `debug`：报告根因、证据和修复方向；
- `verify`：报告公开测试、契约和 Spec ID 覆盖缺口；
- `kb`：基于锁定知识来源回答问题；
- `review`：审查 Spec、代码、测试和 diff。

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

要求 clean HEAD，确定性运行 spec check、build、全部 public tests 和 contract checks。不调用模型，不运行 fuzz、trace 或 hidden tests。

```sh
vos verify
```

### `vos report`

从提交、Spec ID、测试、日志和 evidence 生成 `.vos/report.json`。不调用模型，不写入 Git。

```sh
vos report
```

### `vos submit`

要求 clean HEAD，刷新报告并生成绑定 commit、spec 与 config hashes 的可复现归档。导出时遮蔽凭据并把本机绝对路径替换为稳定别名。

```sh
vos submit
```

## 常见门禁

- `verify`、`agent implement`、权威硬件 evidence 和 `submit` 都要求 clean HEAD。
- `design`、`spec` 只有在确认后才写回，并各自形成提交。
- 跨模块实现先手写并提交 SpecPatch，允许范围是目标模块与受影响模块 `owns` 的并集。
- 达到 Agent `maxIterations`、验证失败、HEAD 漂移或越界时，原工作树保持不变，只保留诊断、diff 和 evidence。
