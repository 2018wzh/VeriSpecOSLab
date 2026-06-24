# 09 Roadmap And Acceptance

回答的问题：

- `VOS Runtime` 应按什么顺序落地
- 每一阶段的完成定义是什么
- 文档和实现的验收标准是什么

上游依赖文档：

- [03-runtime-modules.md](./03-runtime-modules.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)

下游消费者：

- 项目排期
- 迭代验收
- 实现负责人分工

## 1. Phase 1: Local-first foundation

范围：

- `vos-cli`
- `vos-core`
- `vos-spec`
- `vos-runtime`
- `vos-core` evidence
- 最小 `vos-runtime`

覆盖命令：

- `vos init`
- `vos doctor`
- `vos login`
- `vos logout`
- `vos whoami`
- `vos stage show`
- `vos spec lint`
- `vos spec normalize`
- `vos spec check-consistency`
- `vos build`
- `vos run qemu`
- `vos test`
- `vos verify public`

完成定义：

- 命令返回稳定 JSON
- 每次 run 生成 `manifest.json` 与 `events.jsonl`
- 不依赖云端 projection 也能本地工作
- Portal-bound repo 的项目命令进入统一 auth / policy gate

非目标：

- 不做云端 Agent Gateway 执行层
- 不做私有验证联邦执行

## 2. Phase 2: Patch-aware verification

范围：

- `vos-patch`
- `vos-arch`
- 完整 verify DAG

覆盖命令：

- `vos spec patch lint`
- `vos spec patch apply`
- `vos arch lint`
- `vos arch compose`
- `vos arch derive-tests`
- `vos verify patch`
- `vos verify invariant`
- `vos verify fuzz`

完成定义：

- 支持 commit-backed `SpecPatch` DAG 检查
- 支持影响分析与选择性验证
- 公开 test matrix 可从 spec 派生

非目标：

- 不暴露 hidden tests 源码
- 不把 patch impact 实现为自由脚本

## 3. Phase 3: Local Agent Runtime And HTTP VOS

范围：

- `vos-agent`
- `vos-core` policy
- Portal policy snapshot 集成
- `vos serve`

覆盖命令：

- `vos serve`
- `vos agent serve`
- `vos agent context`
- `vos agent plan`
- `vos agent apply-patch`
- `vos agent log`
- `vos report generate`
- `vos submit pack`

完成定义：

- Agent 只经由本地 `vos-agent` 和 authenticated `vos` 工作
- `vos serve` 提供单项目命令 RPC、SSE events 和 cancel
- patch 应用绑定 spec 与最小验证 DAG
- 平台可通过统一 evidence、policy snapshot ref 与协作日志回溯 Agent 行为
- 云端平台不承载 workspace Agent 工具执行

## 4. 测试矩阵

### Unit

- YAML parse / normalize
- cross-spec consistency
- commit-backed `SpecPatch` DAG 校验
- adapter resolution
- policy / path validation
- Portal token / policy snapshot validation

### Integration

- `vos build` 成功与失败日志采集
- `vos run qemu` 的 success / panic / timeout
- `vos test` 多 suite 执行与汇总
- `vos verify patch` 只运行受影响验证
- `vos serve` 创建 run、SSE 事件流与 cancel

### End-to-end

- 从 `spec lint` 到 `verify public` 产生完整 evidence bundle
- `agent apply-patch` 在路径越权、spec 缺失、验证失败时正确拒绝
- Portal-bound repo 未登录或在线校验失败时拒绝本地项目命令

### Resilience

- 子进程卡死时取消与清理
- 并发测试时日志不串流
- 重复执行同一命令时缓存与 manifest 可追溯

## 5. 文档验收

拆分后的文档必须满足：

- `README.md` 能串起全部子文档
- 仅阅读 `README + 01` 即可区分 `VOS Runtime` 与 `ToolchainSpec`
- 仅阅读 `03 + 04 + 05 + 06` 即可开始搭建 TypeScript package 与命令骨架
- `07 + 08 + 09` 足以支持 Agent 路径和验收设计
- 不依赖旧 `toolchain.md` 正文才能理解实现边界

## 相关文档

- [README.md](./README.md)
- [07-agent-gateway.md](./07-agent-gateway.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
