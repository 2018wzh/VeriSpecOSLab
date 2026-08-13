# Runtime boundaries

学生项目的执行真相是 `vos.yaml`，语义真相是五类 Spec。执行器只消费经过 schema 校验的结构化 target，不把字符串拼成 shell 命令。

## Manifest projection

```yaml
version: vos.project.v1
build:
  program: bun
  args: [run, build]
  cwd: .
  env: [PATH, RUSTFLAGS]
  timeout: 120000
  artifacts: [build/kernel.elf]
runners:
  qemu:
    program: qemu-system-riscv64
    args: [-machine, virt, -nographic, -kernel, build/kernel.elf]
    cwd: .
    env: [PATH]
    timeout: 30000
    artifacts: [.vos/qemu/serial.log]
    success_pattern: 'BOOT_OK(?:\r?\n|$)'
    failure_pattern: 'panic|PANIC|fatal|FATAL'
  hardware:
    program: ./tools/flash
    args: [--board, virt-board]
    cwd: .
    env: [PATH, BOARD_PORT]
    timeout: 60000
    board: virt-board
    serial: .vos/hardware/serial.log
    workload: tests/boot
    artifacts: [.vos/hardware/serial.log]
checks:
  public-boot:
    program: bun
    args: [tests/public/boot.ts]
    cwd: .
    env: [PATH]
    timeout: 30000
    verifies: [kernel/boot]
```

`program`、`args`、`cwd`、环境变量 allowlist 和 timeout 组成唯一命令契约。`cwd` 和 artifact 路径必须在仓库内。知识库不属于执行投影，由 `vos kb add/list/search/remove/clear` 管理；远程来源的实际 revision 和内容对象记录在 `.vos/kb/`。若 program 是 QEMU，target 必须包含 `-nographic`。

## Runner 契约

```ts
interface Runner {
  build(target: string): Promise<BuildEvidence>;
  run(target: string): Promise<RunEvidence>;
  collectEvidence(): Promise<EvidenceBundle>;
}
```

Host、QEMU、Hardware Runner 共用同一 manifest projection。QEMU 采集非图形串口 stdout/stderr；Hardware evidence 额外记录 board、build commit、serial、workload，并固定为 `pending_human_review`。

脏树允许开发态 build 和 run，但 evidence 的 `submittable` 为 false。`verify`、Agent 自动提交、权威硬件 evidence 和 `submit` 绑定 clean HEAD 与 commit ledger。

## Agent worktree boundary

学生手写 DesignSpec 和 ModuleSpec，`spec lint` 与 `agent review` 都不写文件。只有 `implement` 在 detached linked worktree 中修改代码和测试。模型通过结构化工具提交实现结果与 test target 提案；校验失败时，错误返回同一模型线程继续修正。实现成功且原工作树 HEAD 未漂移、owns 未越界、所有门禁通过时，VOS 才应用 patch、原子投影 `vos.yaml` 并提交。worktree 只是 Git 回滚机制，不是进程、网络、凭据或宿主文件安全边界；宿主命令继承当前用户权限。

Portal 保留版本化 HTTP/API、Worker 和隔离 Runner 作为生产教学边界；学生 CLI 只在 `vos portal` 命名空间公开在线登录、绑定、运行、状态、证据和提交。学生 CLI 不公开 HTTP 服务、旧顶级 pipeline、旧 Spec kind 或旧 Agent 入口。
