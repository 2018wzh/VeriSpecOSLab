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
knowledge:
  sources: []
```

`program`、`args`、`cwd`、环境变量 allowlist 和 timeout 组成唯一命令契约。`cwd`、artifact 和 KB 本地路径必须在仓库内；Git KB URL 必须固定 revision 与 content hash。若 program 是 QEMU，target 必须包含 `-nographic`。

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

`design`、`spec` 和 `implement` 的写操作在 detached linked worktree 中完成。设计变更只有确认后原子应用并单独提交；实现成功且原工作树 HEAD 未漂移、owns 未越界、所有门禁通过时才应用 patch 并提交。worktree 只是 Git 回滚机制，不是进程、网络、凭据或宿主文件安全边界；宿主命令继承当前用户权限。

Portal/Demo 保留现有 HTTP/API 构建和单测作为冻结平台边界。学生 CLI 不公开 HTTP 服务、旧 pipeline、旧 Spec kind 或旧 Agent 入口。
