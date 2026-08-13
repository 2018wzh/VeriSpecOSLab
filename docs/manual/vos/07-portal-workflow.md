# Portal 在线教学与测评

VOS 默认离线运行。只有以下 `vos portal` 命令会访问学校 Portal；原有 `init/spec/agent/build/run/verify/report/submit` 行为不变。

```sh
vos portal login https://portal.example.edu
vos portal whoami https://portal.example.edu
vos portal bind https://portal.example.edu <project-id>
git add .vos/project.yaml && git commit -m "[vos][portal] Bind course project"
vos portal run --stage memory --watch
vos portal evidence <run-id> --out .vos/downloads/<run-id>
vos portal submit --stage memory --watch
vos portal logout https://portal.example.edu
```

`bind` 校验项目成员身份并更新已有 `.vos/project.yaml`，同时把 `.vos/*` 的忽略规则收窄
为保留该绑定文件；该绑定必须提交到 Git。绑定不会改变 student-v2 的离线命令路径，
`build/spec lint/agent/verify` 不会因为存在 Portal 元数据而联网。`run` 只对当前 clean
`HEAD` 创建非正式 public 远程验证。`evidence` 下载当前角色可见对象，并逐一校验服务器
声明的大小和 SHA-256。

`portal submit` 是权威课程提交：工作树必须 clean，提交必须是当前 `HEAD`，且该 commit 必须已经出现在绑定 Gitea 仓库的 commit ledger。请求绑定 stage、Spec/config/manifest hash 和课程 policy snapshot。若课程仓库只提交 `vos.yaml`，它就是显式的 manifest projection；生成的 `.vos/toolchain.json` 存在时优先使用它。失败时不会改用本地验证、上传工作树快照或生成归档。

Lab 9 与 Lab 10 的容器或 QEMU 通过结果仍只能形成 candidate。VisionFive 2 四核 `usertests` 证据与教师人工复核完成前，Portal 不得将其升级为 complete。
