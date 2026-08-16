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

命令对应的 manifest、报告、串口日志和模型复核材料一并收进重放包。脚本会删除凭据字段，将学生检出目录替换为 `<project>`，不上传本机路径、token 或原始私密配置。重放失败时也会先上传失败包，再停止阶段推进。

每个阶段闭环后，脚本还会上传 `glenda-showcase-index.v1`。该索引按时间记录 Portal 登录、项目绑定、Gitea `main` 推送、公开 run、evidence 获取、重放包上传、正式 submit、权威 run、人工复核和阶段关闭，并保存相关 project、commit、run 和 submission 标识。这样，展示页面既能还原学生在本地做了什么，也能追到 Portal 中哪条权威记录接收了这些材料。

Portal 的 stage contract 使用 `required_showcase_artifacts` 强制提交 run 绑定 `${stage}-replay-bundle`。Lab 9 和 Lab 10 另有 `required_review_artifacts`，教师批准前必须存在已验证的仿真报告、实体串口日志、硬件报告或可复现交付包。普通 Runner evidence 不能代替这些人工复核材料。

## 当前状态

- Lab 1–8 的本地历史、Spec、真实模型复核和阶段验收已经完成。
- Lab 9 已形成本地 `course/lab9-candidate`。Orange Pi Prime QEMU 完成了 BL31 → U-Boot → Glenda 启动，以及四核、MMU、GICv2、generic timer、IPI、MMC 和磁盘文件系统验证。
- AArch64 侧已经进入真实 EL0，沿 SVC 和 lower-EL timer 路径运行 Lab 5、Lab 7、Lab 8 的累计工作负载，包括地址空间、坏指针、fork/wait/exit、descriptor、pipe、从 MMC 文件系统加载的 shell、8 个 worker 和抢占调度。七项 H5 trace、`h5-platform` 聚合 GoalSpec 与完整 `vos verify` 均通过；完整验证共运行 68 个检查。
- 模型复核链保留了最初发现的问题、两轮 SpecPatch 修正、一次严格 schema 失败和最终无 blocker/error 的通过结果。这些结果会随 Lab 9 replay bundle 和 showcase index 进入 Portal，不以最后一次成功覆盖之前的失败过程。
- Orange Pi Prime 实体板的 BROM/SPL、冷启动、重复复位、四核、UART、timer/IRQ/IPI、SD 和完整工作负载证据尚未采集。
- Lab 9 仍缺实体板证据和教师审批，因此只能保留 candidate。Lab 10、全新 Compose connected 重放和教师审批尚未执行。

当前没有 Lab 1–10 的 connected 通过表。只有在全新 Compose 环境中完成 Portal、Gitea、PostgreSQL、MinIO、worker 和隔离 Runner 的连续重放后，才能在本节加入新的 run、submission、artifact 与最终状态。Demo、本地 `vos verify`、外部 Linux 启动和 QEMU 仿真都不能填入 connected 结果。

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

发布前还要从仓库根目录审计课程历史。路径由调用者显式传入：

```sh
python scripts/audit-glenda-history.py <glenda-checkout> --through 10
```

实体板审批前，可以对本地候选边界执行同一套审计：

```sh
python scripts/audit-glenda-history.py <glenda-checkout> --through 9 --allow-candidate
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
