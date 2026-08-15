# glenda-spec 学生闭环 connected 验收记录

本记录保存一次真实 Compose 环境中的 Glenda 课程学生闭环验收结果。测试使用课程清单 `courses/glenda-spec/course.yaml` 声明的真实 `course/glenda-m1-complete` 至 `course/glenda-m4-complete` 与候选标签 `course/glenda-m5-candidate`；Portal、Gitea、PostgreSQL、MinIO、worker 与隔离 Runner 均为运行中的服务。没有使用 Demo、本地验证或工作树快照替代远程测评。

## 前置变更

- Portal/CLI schema 通用化：course manifest 的 `source_ref`、`hardware_gate` 不再绑定 xv6 词汇（阶段 1）。
- Runner 镜像补充 Rust nightly + riscv64gc target + xPack riscv GCC，Glenda 内核可在隔离 Runner 中构建（阶段 2）。
- Worker 证据报告新增阶段键控记录：`suite=<stage_key>`、`case_name=public`，使课程清单 `required_evidence` 在教师人工批准门禁可被满足（`worker/runner-evidence.ts`、`worker/worker.ts`）。
- Runner 镜像烤入 Glenda 离线 crate 注册表（`runner-cache/glenda-cargo-registry.tar.gz`，78 crate，含 spin 0.9.8/0.10.0）并设 `CARGO_NET_OFFLINE=true`；隔离 Runner 无外网，依赖必须在镜像内预置。该 tarball 体积约 56MB，已在 `vos/.gitignore` 中排除；重建 Runner 镜像前需先重新生成：取一个干净 `CARGO_HOME`，在 m1–m4 四个 tag 的检出树上分别 `cargo fetch --locked`（取并集，覆盖 m1–m3 的 spin 0.9.8 与 m4 的 0.10.0），再将该 `CARGO_HOME/registry` 打包为 `apps/vos-portal/runner-cache/glenda-cargo-registry.tar.gz`。
- 课程 tag 的 `tests/public/verify.sh` 在每处串口日志捕获后追加 `sed -i 's/\r$//'`：内核 UART 输出 CRLF，Linux Runner 保留 `\r` 会让锚定匹配 `grep '^GLENDA_BOOT_OK$'` 计数为 0；本地 Windows/MSYS 重定向会把 CRLF 归一为 LF，故离线通过而在线失败。五个 tag 与 master 已重打。

## 离线学生仿真（D:\Workspace\glenda-spec）

- 五文件族 Spec 手写并通过 `vos spec lint all`；`vos agent review`（ecnu-max）发现的冲突逐条修正。
- toolchain 里程碑：`agent implement` 结构化提交循环（schema 修复 6 轮以上）因 boot-console-binding 跨所有权不可收敛，按预案手动落盘并记录偏差 `spec/patches/toolchain-manual-landing.yaml`（commit 758c4b5，补丁记录 commit 9a4498b）。
- M1-M5 里程碑自参考分支移植（每次含 GLENDA_BOOT_OK 适配与 spec patch 记录），标签 `course/glenda-m1-complete` … `course/glenda-m4-complete`、`course/glenda-m5-candidate`。

## 复现命令

Windows 宿主复现需先解决本地 SNI 与 CA 信任：

- `hosts`（需管理员/UAC 提权）追加 `127.0.0.1 git.localhost` 与 `127.0.0.1 objects.localhost`，否则 `git.localhost:8443` 无法解析。
- `NODE_EXTRA_CA_CERTS` 指向 Caddy 内部 CA 证书，使 Node/Bun 的 `fetch` 信任 `https://localhost:8443`。
- git 侧用 `GIT_CONFIG_COUNT=1 / GIT_CONFIG_KEY_0=http.sslBackend / GIT_CONFIG_VALUE_0=schannel`（或 `GIT_SSL_NO_VERIFY=1`）信任自签证书。
- MSYS/Git-Bash 下给 `NODE_EXTRA_CA_CERTS` 传路径要用正斜杠（`D:/...`）或原始单反斜杠；双反斜杠会被环境转换吞掉，导致证书加载失败。

```sh
export VOS_PORTAL_URL=https://localhost:8443
export VOS_PORTAL_PROJECT_ID=<PROJECT_ID>
export VOS_GITEA_PUBLIC_ORIGIN=<GITEA_ORIGIN>
export VOS_GITEA_USERNAME=student
export VOS_GITEA_PASSWORD=<from local env>
export VOS_GITEA_TOKEN=<from local env>

bun run --cwd apps/vos-portal test:glenda:student-cli:course  # M1-M4
bun run --cwd apps/vos-portal test:glenda:student-cli         # M5 candidate
bun run --cwd apps/vos-portal test:glenda:connected           # 课程清单逐阶段 run/submit
```

## 实际结果

| stage | public run | authoritative run | evidence | submission |
| --- | --- | --- | --- | --- |
| m1 | `run-c545f7a7` | `run-9511606d` | passed | complete |
| m2 | `run-e2434306` | `run-9897864e` | passed | complete |
| m3 | `run-7e4df385` | `run-cddeefb7` | passed | complete |
| m4 | `run-4eb85f70` | `run-ab8948aa` | passed | complete |
| m5 | `run-424b93c0` | `run-fdde1024` | passed | candidate（预期） |

项目：`project-ddeb695a-0d48-4dbc-9dfe-4c4fa9206491`。五个阶段的学生 CLI 全链路（login→whoami→bind→run→evidence→submit→status）均在同一次真实 Compose 环境中按顺序推进，未使用快照或旁路。

M5 的 candidate 结果来自容器/QEMU 自动测评；Orange Pi Prime（Allwinner H5）实机证据与教师人工复核是候选阶段的必要门禁，不能升级为 complete。

## 回归与已知问题

- `bun run typecheck`：通过（vos 全工作区，2026-08-15，含 worker 证据接线修改）。
- `bun run test`：177/178 通过（2026-08-15）。唯一失败为 `student-flow.test.ts` 的「initializes an empty student project」在 Windows 上 30s 超时；`git stash` 还原到干净基线后单独复跑仍同样超时，确认为既有环境问题，与本次改动无关（本次改动不触及 `init` 空项目路径）。其余含 contracts 课程门槛新断言全部通过。
