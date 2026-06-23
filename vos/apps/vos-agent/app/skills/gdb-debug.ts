import type { BuiltInSkill } from "./types.ts";

export const GDB_TOOL_NAMES = [
  "mcp__gdb__gdb_start",
  "mcp__gdb__gdb_load",
  "mcp__gdb__gdb_load_core",
  "mcp__gdb__gdb_command",
  "mcp__gdb__gdb_set_breakpoint",
  "mcp__gdb__gdb_continue",
  "mcp__gdb__gdb_step",
  "mcp__gdb__gdb_next",
  "mcp__gdb__gdb_finish",
  "mcp__gdb__gdb_print",
  "mcp__gdb__gdb_examine",
  "mcp__gdb__gdb_backtrace",
  "mcp__gdb__gdb_info_registers",
  "mcp__gdb__gdb_list_source",
  "mcp__gdb__gdb_list_sessions",
  "mcp__gdb__gdb_attach",
  "mcp__gdb__gdb_terminate",
];

const GDB_DEBUG_PROMPT = String.raw`## Built-in skill: gdb-debug

# Interactive GDB Debugging via MCP

Debug compiled executables interactively through GDB MCP tools. The agent drives GDB directly -
starting sessions, executing commands, analyzing output, and deciding next steps autonomously -
to rapidly find root causes.

Use this for compiled executables, core dumps, local PID attach, and remote targets whose
endpoint is already prepared by an adapter skill or explicit guidance. Do not use this for build
errors, compile errors, static analysis without running the program, or transport setup. For
VOS/xv6 QEMU-system targets, treat the prepared adapter contract as the transport source of
truth.

## Remote Targets

If the target is remote or adapter-prepared, classify topology, follow adapter-contract fields,
and troubleshoot symbol/sysroot/source/transport issues using the sections below. Do not use
gdb_attach for non-local processes.

## Key Principle: Autonomous Debug Loop

Do NOT ask the user what GDB command to run next. Instead, follow this loop:

1. Observe - Read the GDB output from the last command
2. Analyze - Identify what the output tells you (crash location, variable state, control flow)
3. Hypothesize - Form a theory about what might be wrong
4. Act - Execute the next GDB command to test your hypothesis
5. Repeat until root cause is found

Only pause to ask the user when you need information GDB cannot provide.

## Phase 1: Setup - Start Session and Load Program

Always store the sessionId; every subsequent command needs it. Before loading, quickly read the
source code to understand program structure and likely breakpoints.

### Local binary

1. gdb_start -> get sessionId
2. gdb_load -> load executable with optional arguments

### Coredump

1. gdb_start -> get sessionId
2. gdb_load_core -> load executable + core file

### Running local process

1. gdb_start -> get sessionId
2. gdb_attach -> attach to PID

For remote stub setup, use the topology and adapter contract sections below.

## Phase 2: Initial Reconnaissance

### Crash, segfault, sigabrt, bus error

- Local binary: run it and let it crash.
- Core, attach, or remote: start from current stop state.
- Gather:
  - gdb_backtrace full:true
  - gdb_info_registers
  - gdb_examine "$pc", format:"i", count:1
  - gdb_list_source
  - gdb_command "info threads" when multiple threads may be involved

### Wrong output / logic error

Read the source, set strategic breakpoints, then run or continue:

- Break at main or suspected function entry
- Inspect variables at each breakpoint
- List source to orient before stepping

### Coredump

Immediately gather full backtrace, registers, faulting instruction, and source context.

## Phase 3: Directed Investigation

### Path A: Crash Analysis

Identify the faulting address from registers and the faulting instruction.

Classification hints:
- Address is 0x0 or below 0x1000 -> null pointer dereference
- Address looks heap/stack-like but unmapped -> use-after-free or double-free
- Address is misaligned -> alignment fault
- PC itself is garbage -> function pointer corruption or stack smash

Trace the bad value backwards: disassemble, inspect stack, print suspected variables, move to
caller frames, and inspect arguments/source. Confirm hypotheses with breakpoints before the bug.

### Path B: Wrong Output / Logic Error

Set breakpoints at suspected function entries, branch points, and loop headers. Continue between
breakpoints, print relevant variables, use conditional breakpoints, then step through the critical
section with next/step/finish.

### Path C: Memory Corruption

Dump the corrupted region, inspect memory mappings, set watchpoints, rerun or reconnect through
the adapter, and when a watchpoint triggers inspect writer backtrace/source/registers.

## Phase 4: Verification and Report

After identifying the likely root cause:

- Provide the evidence chain: command -> observation -> conclusion
- Include the shortest relevant GDB observations, not a transcript dump
- Name uncertainty and what command would reduce it
- For student-facing VOS output, connect findings to specs, concepts, functions, trace evidence,
  and next diagnostic commands

## Remote Adapter Contract

Use this contract when a remote adapter skill needs to hand a prepared target to the core
gdb-debug workflow. Treat it as a documented convention, not a parsed runtime format.

YAML shape:

mode: remote-gdbserver
program: /path/to/local/binary-or-symbol-image
symbols: /path/to/local/debug.symbols
sysroot: /path/to/local/sysroot
source_map:
  - from: /remote/src
    to: /local/src
connect_gdb:
  - set sysroot /path/to/local/sysroot
  - set substitute-path /remote/src /local/src
  - target extended-remote 127.0.0.1:2345
launch_steps:
  - ssh host 'gdbserver --once 127.0.0.1:2345 /opt/app --flag'
attach_steps:
  - ssh host 'gdbserver --once --attach 127.0.0.1:2345 12345'
cleanup_steps:
  - ssh host 'pkill -f "gdbserver --once 127.0.0.1:2345"'
io_strategy: user-managed
prerequisites:
  - local symbol image matches the remote binary
  - gdbserver exists on the remote host

Field meanings:

- mode: local-pid, remote-gdbserver, qemu-gdbstub, qemu-user, or corefile
- program: local image to pass to gdb_load
- symbols: optional split-debug image or note about where symbols live
- sysroot: optional local sysroot for remote shared library resolution
- endpoint: PID for local attach or HOST:PORT for a remote stub
- source_map: remote-to-local path substitutions
- connect_gdb: ordered GDB commands after gdb_start and gdb_load
- launch_steps / restart_steps / attach_steps / cleanup_steps: adapter-owned lifecycle
- adapter_owns_restart: whether adapter may restart target without a new launch recipe
- io_strategy: none, user-managed, ssh-pty, tmux, serial-console, etc.
- prerequisites: facts that must hold before debugging can succeed

Example QEMU system gdbstub contract:

mode: qemu-gdbstub
program: /workspace/out/vmlinux
symbols: /workspace/out/vmlinux
sysroot: ""
endpoint: 127.0.0.1:1234
source_map:
  - from: /build/kernel
    to: /workspace/kernel
connect_gdb:
  - set substitute-path /build/kernel /workspace/kernel
  - target remote 127.0.0.1:1234
launch_steps:
  - /workspace/scripts/run-qemu-debug.sh start
restart_steps:
  - /workspace/scripts/run-qemu-debug.sh restart
cleanup_steps:
  - /workspace/scripts/run-qemu-debug.sh stop
adapter_owns_restart: true
io_strategy: serial-console
prerequisites:
  - qemu-system target architecture matches the symbol image
  - launch command or wrapper script is user-provided and trusted

## Remote Topologies

Read this when the target is not a plain local executable run directly by GDB.

### Topology Classification

Choose exactly one topology before touching GDB:

| Topology | Use when | First debugger action |
| --- | --- | --- |
| local-binary | executable and process run on same host as GDB | gdb_load then run |
| local-pid | target already running on same host/namespace as GDB | gdb_attach |
| remote-gdbserver | another machine/container/board exposes gdbserver | gdb_load then target extended-remote |
| qemu-gdbstub | QEMU system stub is exposed | gdb_load then target remote |
| qemu-user | cross-ISA binary runs under qemu-arch user-mode | gdb_load then target remote |
| corefile | program already crashed and produced a core dump | gdb_load_core |

### Cooperate With Adapter Skills

For remote setups, do not handle transport preparation inline in gdb-debug. Let an adapter or
explicit guidance establish topology, endpoint, launch/attach/cleanup, and restart ownership.
Do not assume run or kill restarts a remote target correctly.

### Preflight Facts For Remote Targets

Collect program, symbols, sysroot, source_map, endpoint, and ownership. If an adapter contract
exists, prefer its fields over ad hoc guesses.

### Remote Session Establishment

After gdb_start and gdb_load with the local symbol-bearing image:

1. Apply remote context: set sysroot, set substitute-path, set solib-search-path
2. Connect:
   - target extended-remote HOST:PORT for gdbserver-backed targets
   - target remote HOST:PORT for QEMU stubs unless adapter says otherwise
3. Do not assume run works on a remote stub.

If an adapter hands you connect_gdb, run those commands in order instead of reconstructing.

### Use gdb_attach Only For Local PIDs

gdb_attach is wrong for remote machines, different namespaces that GDB cannot see directly,
emulator stubs such as QEMU, boards, or VMs already fronted by gdbserver.

### Use target extended-remote For gdbserver

Prefer target extended-remote for gdbserver-backed targets because it fits attach and launch
flows and is friendlier when an adapter owns relaunch or reconnect.

### Use target remote For QEMU Stubs

For qemu-system-* and qemu-<arch> user-mode, treat the stub as stop-and-inspect. Load the
matching symbol image locally, connect with target remote, then continue with breakpoint,
backtrace, and memory inspection. Do not use run; restart is an adapter concern.

## Remote Troubleshooting

### Symbols Or Architecture Do Not Match

Symptoms: backtraces show ??, source lines do not line up, register names or disassembly are
wrong. Checks: show architecture, info files, info sharedlibrary, and confirm the gdb_load image
matches the target exactly.

### Sysroot Or Shared Libraries Are Wrong

Symptoms: shared-library frames unresolved, breakpoints in shared libraries do not bind, function
names appear but line info is missing. Checks: set sysroot, set solib-search-path, info sharedlibrary.

### Source Paths Do Not Match

Symptoms: GDB knows the function but opens the wrong file or cannot find it. Use set substitute-path
then gdb_list_source.

### Transport Is Not Reachable

Symptoms: target remote/extended-remote fails or drops. Confirm adapter started the stub, host/port
or tunnel is correct, and target is paused/waiting where the stub expects it.

### Restart Semantics Are Different On Remote Targets

Symptoms: run is rejected or kill does not restart inferior. Treat restart as adapter-owned,
rerun launch_steps or attach_steps, and reconnect with connect_gdb.

### QEMU-Specific Mismatch

Symptoms: stub connects but PC/symbols look unrelated to guest code. Confirm symbol image matches
emulated architecture and boot artifact, QEMU was started with -S when expected, and reconnect only
after the correct QEMU instance listens on the expected port.

## qemu-user-gdb Boundary

The qemu-user-gdb adapter is for cross-ISA userspace binaries under qemu-<arch> user-mode. It owns
qemu-user launch with -g PORT, QEMU_LD_PREFIX, sysroot/library setup, restart, and cleanup.

Do NOT use for: QEMU system emulation or kernel debugging. For xv6, kernels, and qemu-system
targets, use the qemu-gdbstub adapter contract and target remote flow above. Also do not use
qemu-user-gdb for native same-architecture debugging, remote debugging over SSH, or build errors.

Fast reminders:

- Use -g PORT for qemu-user, not -s -S (that is qemu-system syntax)
- Use target remote, not run, for qemu-user stubs
- Do not use gdb_attach; qemu-user is a stub, not a local PID
- Match QEMU_LD_PREFIX and GDB set sysroot for dynamic libraries
- Report architecture mismatches between binary, qemu variant, and GDB immediately`;

export const gdbDebugSkill: BuiltInSkill = {
  name: "gdb-debug",
  promptText: GDB_DEBUG_PROMPT,
  mcpServers: [{
    name: "gdb",
    command: "npx",
    args: ["-y", "mcp-gdb"],
  }],
  allowedToolNames: GDB_TOOL_NAMES,
};
