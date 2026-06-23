import { fileURLToPath } from "node:url";
import type { BuiltInSkill } from "./types.ts";

export const QEMU_MONITOR_TOOL_NAMES = [
  "mcp__qemu-monitor__qmp_query",
  "mcp__qemu-monitor__hmp_info",
];

export const qemuMonitorSkill: BuiltInSkill = {
  name: "qemu-monitor",
  promptText: String.raw`## Built-in skill: qemu-monitor

# QEMU Monitor Debugging via MCP

Use QEMU monitor as a supplemental, readonly evidence channel alongside verify, trace, and GDB.
It is most useful for guest machine state that GDB alone does not explain: VM run state, vCPU
list, device/block topology, interrupt controller hints, page-table/TLB views, physical memory,
and QEMU machine configuration.

Never use monitor observations to redefine verify pass/fail status. Treat every monitor finding
as supporting evidence that must be correlated with a spec clause, trace event, GDB frame, serial
log, or oracle observation.

## Monitor Preflight

Before calling a monitor tool:

1. Read the adapter contract and prefer its qmp_endpoint and hmp_endpoint fields.
2. Confirm the endpoint shape is unix:/absolute/path.sock or tcp:host:port.
3. Use qmp_query only with QMP query-* commands.
4. Use hmp_info only with HMP info..., x..., or xp... commands.
5. If the socket is missing or times out, record "monitor not observed" and continue with GDB/trace
   evidence unless the user's task specifically requires monitor evidence.

## QMP vs HMP Selection

Prefer QMP when the question has a structured query-* command:

- query-status: VM run state, pause reason, whether QEMU thinks the guest is running
- query-cpus-fast: vCPU ids, thread ids, architecture-specific PC when available
- query-block and query-named-block-nodes: disk/backend topology
- query-chardev: serial and monitor character devices
- query-memory-devices: guest memory device topology
- query-machines, query-target, query-version: machine, target, and QEMU version facts

Use HMP when QMP lacks a compact query or when the human-readable monitor view is the useful
teaching artifact:

- info registers: CPU register snapshot from the monitor side
- info cpus: vCPU list and current CPU marker
- info mem: guest virtual memory mappings when supported
- info tlb: TLB/page-translation hints when supported
- info mtree: QEMU memory region tree
- info qtree: QEMU device tree
- info pci: PCI topology when relevant
- info irq and info pic: interrupt controller hints
- x /FMT ADDR and xp /FMT ADDR: virtual or physical memory inspection

## Readonly Investigation Sequence

Use the smallest sequence that answers the diagnostic question:

1. Start with qmp_query query-status to establish whether the VM is running, paused, or stopped.
2. Use qmp_query query-cpus-fast to identify vCPUs and PC hints; compare PC with GDB's $pc.
3. If the bug smells like memory mapping or paging, use hmp_info "info mem", "info tlb", and
   "info mtree" where available.
4. If the bug smells like device, block, console, or interrupt state, use query-block,
   query-chardev, "info qtree", "info irq", or "info pic".
5. If inspecting memory, prefer a tight x/xp range around the address already justified by GDB,
   trace, or spec evidence. Do not dump large memory ranges.

## Correlate With GDB, Trace, And Specs

For every useful monitor observation, write the evidence chain explicitly:

- monitor command and endpoint
- observation from QMP/HMP
- matching GDB fact, trace event, serial line, or verify oracle output
- related spec or suspected concept
- why the observation changes or supports the hypothesis

Examples:

- query-status reports paused while GDB is stopped at kerneltrap; connect this to a trap/panic
  serial line and the relevant exception-handling spec.
- info tlb shows no mapping for a faulting VA; connect it to GDB badaddr/stval and the paging spec.
- info qtree shows the expected device exists; use it to rule out device absence before blaming
  driver initialization.

## Failure Handling

Monitor tools are advisory. Handle failures without inventing data:

- Socket missing, connection refused, or timeout: report the endpoint and mark monitor evidence as
  not observed.
- Unsupported HMP command: try a narrower related info command once, then stop.
- QMP error for a query-* command: quote the short error and fall back to GDB/trace.
- Output is architecture-specific or ambiguous: say what is observed and what remains unknown.

## Safety Rules

Do not run destructive or state-changing monitor commands:

- quit, stop, cont, system_reset, system_powerdown
- device_add, device_del, object_add, object_del
- migrate, savevm, loadvm, snapshot_blkdev
- screendump or dump commands that create large artifacts
- arbitrary QMP commands that do not start with query-

Do not use QEMU monitor as a replacement for GDB. It cannot explain source-level control flow,
stack frames, locals, or spec obligations by itself. Use it to add machine-level context.`,
  mcpServers: [{
    name: "qemu-monitor",
    command: process.execPath,
    args: [fileURLToPath(new URL("../main.ts", import.meta.url)), "internal", "qemu-monitor-mcp"],
  }],
  allowedToolNames: QEMU_MONITOR_TOOL_NAMES,
};
