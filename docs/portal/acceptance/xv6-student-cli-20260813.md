# xv6-spec 学生 CLI connected 验收记录

本记录保存一次真实 Compose 环境中的学生 CLI 验收结果，避免把 connected 证据留在会话外。测试使用课程清单声明的真实 `course/lab1-complete` 至 `course/lab9-candidate`，Portal、Gitea、PostgreSQL、MinIO 和隔离 Runner 均为运行中的服务；没有使用 Demo、本地验证或工作树快照替代远程测评。

## 复现命令

测试凭据只通过环境变量注入，不写入仓库：

```sh
export VOS_PORTAL_URL=https://portal.example.edu
export VOS_PORTAL_PROJECT_ID=PROJECT_ID
export VOS_GITEA_PUBLIC_ORIGIN=https://git.example.edu
export VOS_GITEA_USERNAME=student
export VOS_GITEA_PASSWORD="$VOS_GITEA_TEST_PASSWORD"
export VOS_GITEA_TOKEN="$VOS_GITEA_TEST_TOKEN"

# Lab 1–8：逐标签执行 login/whoami/bind/push/run/evidence/submit/status
bun run --cwd apps/vos-portal test:xv6:student-cli:course

# Lab 9 candidate：相同 CLI 闭环，预期状态只能是 candidate
bun run --cwd apps/vos-portal test:xv6:student-cli
```

省略 `VOS_PORTAL_TOKEN` 时，脚本先用 Portal Web 会话批准真实设备码，再由 CLI 轮询换取凭据。脚本为每个阶段创建一次性 Gitea 分支，等待 signed webhook 写入 commit ledger，完成后删除该分支。

## 实际结果

项目 `project-5b771dec-79ae-474b-8b6a-85233ac2a60a` 的阶段按顺序推进到 `lab9`：

| stage | public run | authoritative run | evidence | submission |
| --- | --- | --- | --- | --- |
| lab1 | `run-5214b322-1dfb-407e-b6b0-ad9dbf8ddd43` | `run-cb3c61e8-3d50-4f69-af19-f197320222ef` | passed | complete |
| lab2 | `run-905f680d-55ab-4829-a560-06da69582cc0` | `run-fb2d755b-e4bf-48ec-a048-30fb9bbfeb42` | passed | complete |
| lab3 | `run-5786320c-79f0-4967-b26e-106960b333f9` | `run-fe6262d7-cdd0-4344-bc3a-92f10a6e01bd` | passed | complete |
| lab4 | `run-bc932175-465c-41fa-9574-ba4c82b1f99f` | `run-232294ab-0e54-4687-a105-60fdd51caf51` | passed | complete |
| lab5 | `run-239909be-8943-420e-b192-fd4c23184e5e` | `run-2ebff536-e0f0-4c5b-9538-4b9b26e0400d` | passed | complete |
| lab6 | `run-442f15a9-781b-413a-903b-e2cd9075effb` | `run-fc4ba9b6-ea90-456c-a956-467fb789a59c` | passed | complete |
| lab7 | `run-a7d82ade-b24e-4e4a-8a79-18cece18b228` | `run-f92cfce2-e8cc-4196-8d5a-e9027853a404` | passed | complete |
| lab8 | `run-33cd3cf8-541a-40e5-83b7-1a27fa1d1ed2` | `run-8f08a286-9468-4715-b613-9a8fd402ef18` | passed | complete |
| lab9 | `run-43fa887b-5f72-44b8-8e68-afe669cbb66b` | `run-0c5c3a57-ffa2-42e6-815b-1cf16aaa2f1c` | passed | candidate |

Lab 9 的 candidate 结果来自容器/QEMU 自动测评，不能升级为 complete。Lab 10 未触发；VisionFive 2 四核 `usertests` 和教师人工复核仍是两个候选阶段的必要门禁。

验收完成后，学生临时分支已清理，Runner 容器无残留；Portal `/healthz` 与 `/readyz` 返回 200，内部 `/metrics` 可抓取。
