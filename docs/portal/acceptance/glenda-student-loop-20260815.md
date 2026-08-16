# Glenda Lab 1–10 connected 验收记录

这份记录说明 Glenda 课程历史重放在 Portal 中如何留痕，以及目前真正完成到哪一步。旧课程历史的 connected 结果不再作为 Lab 1–10 的验收依据；新历史必须从 `course/lab1-complete` 沿同一条学生 `main` 分支逐阶段推进。

## 展示材料记录

connected 脚本会为每个 Lab 保存一份 `glenda-replay-bundle.v1`。其中包含当前提交与 tree 标识、从课程根提交到当前阶段的父子关系和提交标题，以及以下命令的结构化结果：

- `vos spec lint all`
- `vos agent ask`
- `vos agent review all`
- `vos build`
- `vos run qemu`
- `vos verify`
- `vos report`

命令对应的 manifest、报告、串口日志和模型复核材料一并收进重放包。Lab 10 还会嵌入 `glenda-history-replay-journal.v1`：它逐条索引源历史中的 VOS run、状态、提交、manifest 和有界 JSON artifact，并单列失败 run，因而能展示本次历史重放的完整收敛过程。脚本会删除凭据和模型原始文本字段，将本机路径替换为占位符，不上传 token 或原始私密配置。重放失败时也会先上传失败包，再停止阶段推进。

每个阶段闭环后，脚本还会上传 `glenda-showcase-index.v1`。该索引按时间记录 Portal 登录、项目绑定、Gitea `main` 推送、公开 run、evidence 获取、重放包上传、正式 submit、权威 run、人工复核和阶段关闭，并保存相关 project、commit、run 和 submission 标识。这样，展示页面既能还原学生在本地做了什么，也能追到 Portal 中哪条权威记录接收了这些材料。

Portal 的 stage contract 使用 `required_showcase_artifacts` 强制提交 run 绑定 `${stage}-replay-bundle`。Lab 9 和 Lab 10 另有 `required_review_artifacts`，教师批准前必须存在已验证的仿真报告、实体串口日志、硬件报告或可复现交付包。普通 Runner evidence 不能代替这些人工复核材料。

## 当前状态

- Lab 1–7 已在同一条学生 Gitea `main` 历史中完成 connected 闭环。Lab 8 也已闭环，Portal 当前停在 Lab 9。
- Lab 8 的学生提交是 `911641dfaff1cfda57a016908348ca7b87b2c0af`。公开 run `run-3a6d9914-7cee-477d-b104-aa4796c08718` 通过 2/2；权威 run `run-02d4a945-b436-454c-84c2-9e6f441569f3` 通过；submission `submission-45836c8e-a488-4806-840e-428511e1ec32` 状态为 `complete`。
- Lab 8 的公开 run 和权威 run 均绑定了 `lab8-replay-bundle`，权威 run 还绑定了 `lab8-showcase-index`。重放包记录了全部成功步骤、获批跳过和此前失败尝试；失败记录没有被最后一次成功覆盖。
- Lab 8 的 `agent ask` 和 `agent review` 因已配置的 Anthropic 凭据环境变量缺失而失败。本次在显式开启 `VOS_GLENDA_ALLOW_AGENT_FAILURE_SKIP=1` 后，将这两步记为 `passed_with_approved_skips`。这不是模型复核通过，也不影响 build、QEMU、verify、report、Runner evidence 和 submit 的硬性门槛。
- 本地重写历史中的 `course/lab9-candidate` 指向 `1d88f7d334af415bb8fc780791b723654260e42f`，`course/lab10-candidate` 指向 `163118aca6374f597fe797088a9c7ebb50cfc5b4`。两者只是交给后续 harness 的候选输入，不是 connected 或正式发布证据。
- 十阶段历史审计已经通过：历史只有一个 orphan root，标签祖先链连续，未来路径和术语泄漏为 0。Lab 9、Lab 10 仍是 candidate，不是 complete。
- 旧 M1–M5 标签已经保存到不入库的离线 Git bundle，`git bundle verify` 确认其中五个引用及其完整历史可恢复。
- Orange Pi Prime 实体板的 BROM/SPL、冷启动、重复复位、四核、UART、timer/IRQ/IPI、SD 和完整工作负载证据尚未采集。
- Lab 9、Lab 10 仍缺实体板证据、connected replay 和教师审批，因此不能发布 complete 标签，也不能替换课程远端。

当前 connected 记录只确认到 Lab 8。Demo、本地 `vos verify`、外部 Linux 启动和 QEMU 仿真都不能填入 Lab 9/10 的 connected 结果。

### Lab 1–8 connected 通过表

下表直接对应当前 Portal 数据库中的权威记录。每个 final run 均为 2/2 `passed`，submission 均为 `complete`，并绑定已验证的 `${stage}-replay-bundle`、`${stage}-showcase-index`、course evidence 和 runner manifest。

| 阶段 | 学生提交 | public run | final run | submission |
| --- | --- | --- | --- | --- |
| Lab 1 | `7bf49577ed8330b02b7cad86a29fffe255560acb` | `run-de996ef2-aff8-4dab-81e3-d80a306765ef` | `run-9ca79a6a-1853-484c-981f-a6faca1b9027` | `submission-420d3ec2-7256-4a88-9647-4cc22030382c` |
| Lab 2 | `f1c34a4f62eebcf29062fb72e56bd51a8a476124` | `run-1a7f8b39-3917-4a9b-92e8-34ae0d42d173` | `run-e2be2b40-ab58-4c61-8230-db462e166fc2` | `submission-ce2633dd-35d7-4e9f-9a22-91c58119d6c4` |
| Lab 3 | `c7e4f8cb4c7f8d0ad1986ffcde27bc941329fc67` | `run-f2f4a546-ca75-4721-90b1-dd64001fa9c4` | `run-7311d901-be60-48d0-a1e9-39d72fef1f77` | `submission-6ea4893c-e6da-4af6-9ec1-a2948c3e16fd` |
| Lab 4 | `29d56a580f12c16fcf0d562e1a5e2b74f753fa21` | `run-34868710-5c56-46b2-a4a6-4d02a456ad5e` | `run-ce0a2e1b-a1b7-43d5-a32f-ce94f1573830` | `submission-44ec1af2-696d-4e77-bd9d-1b07a2c7edac` |
| Lab 5 | `d6e63112610358122ac1ab248065f62bf0b6112d` | `run-9d098659-253d-45db-9ef5-0a701f2318f4` | `run-d8049363-7991-4daf-809e-6a3e4f345487` | `submission-7ad7d4c4-03e1-450d-84b4-2ad1a251a5fa` |
| Lab 6 | `ee1223884786181359b81c38fa2de52cd3a380ef` | `run-1c5116f7-b6cc-406b-aba4-32c07b825769` | `run-dc369d81-1ece-4dfc-bf1d-d9776ed4904a` | `submission-b0cb510f-7351-4b9f-a137-ff594fbfbbcd` |
| Lab 7 | `52500273f1972705f4e072b1d7b1373c292e3aa8` | `run-27522b1c-d2fa-4ee3-8944-51e011bf8ab6` | `run-5c3971e3-8482-489c-ad94-441bf13de77d` | `submission-0d5ff294-b113-43d7-b0e9-659568cb7bec` |
| Lab 8 | `911641dfaff1cfda57a016908348ca7b87b2c0af` | `run-3a6d9914-7cee-477d-b104-aa4796c08718` | `run-02d4a945-b436-454c-84c2-9e6f441569f3` | `submission-45836c8e-a488-4806-840e-428511e1ec32` |

## 获批跳过边界

`VOS_GLENDA_ALLOW_AGENT_FAILURE_SKIP=1` 只允许 connected replay 在可审计的模型调用故障下跳过 `agent ask` 或 `agent review`。脚本必须保留原始失败分类、命令状态和显式批准配置；只有已配置 provider 的凭据缺失，或同时满足 provider 故障与瞬态故障分类时，才能进入 `passed_with_approved_skips`。其他模型错误、Spec 错误、实现错误和验证失败仍应立即终止。

这项批准只用于尽快完成历史 replay，不把跳过操作伪装成模型成功，也不降低下列门槛：Spec lint、build、QEMU、`vos verify`、报告、Runner evidence、artifact 上传、Lab 9/10 实体板测试和教师人工复核。

## Lab 9/10 外部 harness 交接

本任务不再执行移植或开发板测试。后续 harness 以本地候选引用为输入，并继续使用 Glenda 专用的 Orange Pi Prime 课程契约：

- 先验收 H5 QEMU，再验收实体 Orange Pi Prime；两类证据分开记录，QEMU 不代替实板。
- Lab 9 必须上传 `lab9-replay-bundle`、`h5-simulation-report`、`orangepi-prime-serial-log` 和 `orangepi-prime-hardware-report`。
- Lab 10 必须上传 `lab10-replay-bundle`、`lab10-verification-report`、`lab10-reproducibility-package` 和 `orangepi-prime-hardware-report`。
- 候选重放需要显式设置 `VOS_GLENDA_ALLOW_CANDIDATE_REFS=1`，并将 `VOS_GLENDA_STUDENT_THROUGH` 设为 `lab9` 或 `lab10`。该开关只允许读取 candidate 引用，不绕过硬件与人工门槛。
- review artifact 文件分别通过 `VOS_GLENDA_ARTIFACT_H5_SIMULATION_REPORT`、`VOS_GLENDA_ARTIFACT_ORANGEPI_PRIME_SERIAL_LOG`、`VOS_GLENDA_ARTIFACT_ORANGEPI_PRIME_HARDWARE_REPORT`、`VOS_GLENDA_ARTIFACT_LAB10_VERIFICATION_REPORT` 和 `VOS_GLENDA_ARTIFACT_LAB10_REPRODUCIBILITY_PACKAGE` 传入；值由执行者设置为待上传文件，不写进仓库。
- 实板必须覆盖 BROM/SPL → TF-A → U-Boot → Glenda、冷启动、重复复位、四核身份、UART、timer/IRQ/IPI、SD 数据路径、文件系统和完整工作负载，并单列 QEMU 绕过 SPL 的边界。
- 材料上传后停在 candidate，等待教师在 Portal 中核对 artifact 并批准。其他 harness 不得自称教师，也不得把 candidate 改为 complete。

交接材料不得包含本机绝对路径、凭据或未经脱敏的原始私密日志。

## 运行入口

环境值来自未跟踪的本地配置，不写入文档或仓库：

```sh
export VOS_PORTAL_URL=https://<portal-host>
export VOS_PORTAL_PROJECT_ID=<project-id>
export VOS_GITEA_PUBLIC_ORIGIN=https://<gitea-host>
export VOS_GITEA_USERNAME=<student-user>
export VOS_GITEA_PASSWORD=<local-secret>

bun run --cwd apps/vos-portal test:glenda:connected
```

实体材料尚未具备时，只连续闭环 Lab 1–8，避免提前创建 Lab 9 的权威提交：

```sh
export VOS_GLENDA_STUDENT_THROUGH=lab8
export VOS_GLENDA_HISTORY_REPORT_REQUIRED=1
bun run --cwd apps/vos-portal test:glenda:connected
```

`VOS_GLENDA_ALLOW_CANDIDATE_REFS=1` 只用于 Lab 9/10 候选边界验收；它允许 connected replay 读取 candidate 标签，但不修改课程 manifest，也不能绕过实体 artifact 和教师审批。

发布前还要从仓库根目录审计课程历史。路径由调用者显式传入：

```sh
python scripts/audit-glenda-history.py <glenda-checkout> --through 10
```

实体板审批前，可以对本地候选边界执行同一套审计：

```sh
python scripts/audit-glenda-history.py <glenda-checkout> --through 10 --allow-candidate
```

Lab 9 和 Lab 10 上传完必需材料后，脚本会停在 candidate 状态等待教师在 Portal 中审批。脚本只轮询审批结果，不代替教师操作。任何硬件、connected、artifact 或审批失败都会保留原状态，并停止正式发布。

## 发布边界

课程远端仍保持不变。正式替换 `spec` 和十个 annotated tags 之前，必须同时满足以下条件：

- 十个阶段的历史审计、Spec lint、构建、公开/contract/trace 检查和报告全部通过；
- Lab 9 的实体板验收闭环；
- Lab 10 的验证矩阵、可复现提交包和实体板证据通过；
- connected 重放为每个阶段留下 replay bundle、showcase index、run、submission 与最终状态；
- 教师完成 Lab 9、Lab 10 的人工复核。

在这些条件满足前，只保留本地分支、离线旧历史 bundle 和真实失败记录，不推送正式标签，也不更新主仓库中的课程引用。
