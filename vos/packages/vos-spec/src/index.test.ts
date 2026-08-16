import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildNormalizedSpecBundle,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  parseQemuPortSpec,
  parseProjectManifest,
  resolveSpecPatch,
} from "./index.ts";

describe("vos-spec semantic bundle", () => {
  test("keeps request QemuSpecs free of generated preflight fields", () => {
    expect(() => parseQemuPortSpec({
      version: "vos.qemu-port.v1",
      id: "qemu.board",
      revision: 0,
      status: "request",
      target: { board: "Demo Board" },
      qemu: { version: "11.1.0", source_path: "qemu", commit: "abcdef1" },
    })).toThrow("generated only after preflight");
  });

  test("normalizes request and approved QemuSpecs and rejects unresolved approved blockers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-qemu-spec-"));
    await mkdir(path.join(root, "spec", "qemu"), { recursive: true });
    await writeFile(path.join(root, "spec", "qemu", "board.yaml"), [
      "version: vos.qemu-port.v1",
      "id: qemu.board",
      "revision: 0",
      "status: request",
      "target: { board: Demo Board }",
      "qemu: { version: 11.1.0, source_path: qemu }",
      "",
    ].join("\n"));
    let bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.qemu_ports[0]?.status).toBe("request");
    expect(bundle.sources[0]?.kind).toBe("qemu_port");

    await writeFile(path.join(root, "spec", "qemu", "board.r1.yaml"), [
      "version: vos.qemu-port.v1",
      "id: qemu.board.r1",
      "request_id: qemu.board",
      "revision: 1",
      "status: approved",
      "target: { board: Demo Board }",
      "qemu: { version: 11.1.0, source_path: qemu, commit: abcdef1 }",
      "materials_dir: references/qemu/qemu.board",
      `materials: [{ id: manual, role: hardware-manual, path: references/qemu/qemu.board/manual.pdf, sha256: '${"0".repeat(64)}', size: 1, caveats: [] }]`,
      "preflight:",
      "  run_id: run-1",
      "  boot_path: { entry: bl31 }",
      "  reuse_matrix: [{ device: uart, decision: integrate }]",
      "  findings: [{ id: missing-registers, severity: blocker, message: missing, evidence: [] }]",
      "  notes: []",
      "implementation: { owns: [qemu/hw/arm], phases: [{ id: boot }], dependencies: [] }",
      "acceptance: { goal: shell, agent_defined: true }",
      "",
    ].join("\n"));
    bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((item) => item.message.includes("unresolved blocker"))).toBe(true);
  });
  test("normalizes the student v2 contract and manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-"));
    await mkdir(path.join(root, "spec", "modules"), { recursive: true });
    await mkdir(path.join(root, "spec", "interfaces"), { recursive: true });
    await writeFile(path.join(root, "spec", "design.yaml"), [
      "system: { name: demo-os, language: rust, isa: riscv64 }",
      "machine: { qemu: { machine: virt }, hardware: { board: demo } }",
      "kernel: { organization: monolithic, execution: preemptive, protection: paging, communication: ipc, resource_model: ownership }",
      "required_mechanisms: [syscall]",
      "composition_invariants: [all syscalls validate pointers]",
      "non_goals: []",
      "hardware_port: { board: demo, boot: serial, console: uart, interrupt: plic }",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "spec", "modules", "memory.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "level: 3",
      "purpose: allocate pages",
      "owns: [kernel/memory.c, tests/memory]",
      "interface:",
      "  - name: kalloc",
      "    pre: [initialized]",
      "    post: [page returned]",
      "    errors: [out_of_memory]",
      "    properties: [{ id: aligned, text: page is aligned, check: memory_alignment }]",
      "properties: [{ id: safe, text: no aliasing }]",
      "errors: [out_of_memory]",
      "state: { free_pages: counter }",
      "preconditions: [initialized]",
      "postconditions: [ownership transferred]",
      "invariants: [safe]",
      "dependencies: []",
      "concurrency: { lock: spinlock }",
      "rely: [scheduler does not mutate free list]",
      "guarantee: [allocation is atomic]",
      "algorithm_intent: bitmap",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "spec", "interfaces", "console.yaml"), [
      "id: abi/console",
      "name: console ABI",
      "boundary: abi",
      "module: kernel/memory",
      "operations:",
      "  - name: putc",
      "    pre: []",
      "    post: [byte visible]",
      "    errors: []",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "vos.yaml"), [
      "version: vos.project.v1",
      "build: { program: bun, args: [--version], cwd: ., env: [], timeout: 1000, artifacts: [build/kernel.elf] }",
      "runners: { qemu: { program: bun, args: [--version], cwd: ., env: [], timeout: 1000, artifacts: [], success_pattern: '[0-9]+[.][0-9]+[.][0-9]+', failure_pattern: 'error|failed|panic' } }",
      "checks: { public-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 1000, verifies: [kernel/memory] } }",
      "",
    ].join("\n"));
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(false);
    expect(bundle.version).toBe("vos-spec.bundle.v2");
    expect(bundle.design?.path).toBe("spec/design.yaml");
    expect(bundle.normalized_modules[0]?.level).toBe(3);
    expect(bundle.normalized_modules[0]?.operations.map((operation) => operation.id)).toEqual(["kernel/memory.kalloc"]);
    expect(bundle.interfaces[0]?.boundary).toBe("abi");
    expect(bundle.manifest?.checks[0]?.verifies).toEqual(["kernel/memory"]);
    expect(deriveTestMatrix(bundle).public_tests.map((test) => test.id)).toContain("public-memory");
  });

  test("rejects an incomplete DesignSpec machine projection and empty composition invariants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-design-incomplete-"));
    await mkdir(path.join(root, "spec"), { recursive: true });
    await writeFile(path.join(root, "spec", "design.yaml"), [
      "system: { name: demo-os, language: c, isa: riscv64 }",
      "machine: { qemu: {}, hardware: {} }",
      "kernel: { organization: monolithic, execution: serial, protection: none, communication: uart, resource_model: static }",
      "required_mechanisms: []",
      "composition_invariants: []",
      "non_goals: []",
      "hardware_port: { board: none, boot: none, console: none, interrupt: none }",
      "",
    ].join("\n"));

    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(true);
    expect(bundle.diagnostics.some((diagnostic) =>
      diagnostic.code === "schema.validation_failed" && diagnostic.path === "spec/design.yaml")).toBe(true);
  });

  test("reports v2 owns traversal and strict unknown fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-invalid-"));
    await mkdir(path.join(root, "spec", "modules"), { recursive: true });
    await writeFile(path.join(root, "spec", "modules", "broken.yaml"), [
      "id: broken",
      "module: broken",
      "level: 1",
      "purpose: broken",
      "owns: [../outside]",
      "unexpected: true",
      "",
    ].join("\n"));
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((diagnostic) => diagnostic.code === "schema.validation_failed")).toBe(true);
    expect(bundle.normalized_modules).toEqual([]);
  });

  test("requires the declared L2 and L3 ModuleSpec fields without blocking an explicit L1", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-level-fields-"));
    await mkdir(path.join(root, "spec", "modules"), { recursive: true });
    await writeFile(path.join(root, "spec", "modules", "incomplete.yaml"), [
      "id: incomplete",
      "module: incomplete",
      "level: 3",
      "purpose: incomplete L3",
      "owns: [src/incomplete.c, tests/incomplete]",
      "interface: []",
      "properties: []",
      "errors: []",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "spec", "modules", "intro.yaml"), [
      "id: intro",
      "module: intro",
      "level: 1",
      "purpose: intentionally introductory",
      "owns: [src/intro.c, tests/intro]",
      "interface: []",
      "properties: []",
      "errors: []",
      "",
    ].join("\n"));

    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    const incomplete = bundle.diagnostics.find((diagnostic) => diagnostic.code === "module.level_fields_missing");
    expect(incomplete?.message).toContain("state");
    expect(incomplete?.message).toContain("algorithm_intent");
    expect(bundle.normalized_modules.map((module) => module.id)).toEqual(["intro"]);
    expect(bundle.diagnostics.some((diagnostic) =>
      diagnostic.code === "module.level_incomplete" && diagnostic.ref === "intro" && diagnostic.severity === "warning")).toBe(true);
  });

  test("rejects legacy Spec kinds before a manifest exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-no-legacy-"));
    await mkdir(path.join(root, "spec", "modules", "kernel", "memory", "ops"), { recursive: true });
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "stage: memory",
      "purpose: retired module shape",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), [
      "id: kernel/memory.kalloc",
      "stage: memory",
      "module: kernel/memory",
      "operation: kalloc",
      "purpose: retired OperationSpec shape",
      "depends_on: { requires_modules: [], requires_ops: [] }",
      "guarantee: {}",
      "test_obligations: { public: [memory], generated: [], hidden_tags: [] }",
      "codegen: { targets: [], forbidden_changes: [], required_followup_checks: [] }",
      "",
    ].join("\n"));
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.filter((diagnostic) => diagnostic.code === "spec.legacy_kind_rejected")).toHaveLength(2);
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(true);
  });

  test("rejects legacy manifest, declarative KB sources, and unsafe target paths", () => {
    expect(() => parseProjectManifest({
      version: "legacy",
      build: { program: "bun", args: [] },
      runners: {},
      checks: {},
    })).toThrow();
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [] },
      runners: {},
      checks: {},
      knowledge: { sources: [{ id: "bad", path: "../outside", sha256: "0".repeat(64) }] },
    })).toThrow(/unrecognized|knowledge/i);
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [] },
      runners: { qemu: { program: "qemu-system-riscv64", args: [] } },
      checks: {},
    })).toThrow(/-nographic|knowledge/i);
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [] },
      runners: { qemu: { program: "make", args: ["qemu"] } },
      checks: {},
    })).toThrow(/success_pattern|failure_pattern/i);
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [] },
      runners: { qemu: { program: "bun", args: [], success_pattern: "[" } },
      checks: {},
    })).toThrow(/valid regular expression/i);
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [], success_pattern: "ok" },
      runners: {},
      checks: {},
    })).toThrow(/only valid for the QEMU runner/i);
    expect(() => parseProjectManifest({
      version: "vos.project.v1",
      build: { program: "bun", args: [], cwd: "../outside" },
      runners: {},
      checks: {},
    })).toThrow(/cwd/);
  });

  test("requires reproducible fuzz metadata and bounded trace/oracle metadata", () => {
    const base = {
      version: "vos.project.v1" as const,
      build: { program: "bun", args: [] },
      runners: {},
    };
    expect(() => parseProjectManifest({
      ...base,
      checks: { fuzz_memory: { kind: "fuzz", program: "bun", args: [], verifies: ["kernel/memory"] } },
    })).toThrow(/fixed seed|bounded case count|timeout|reproduction artifact/i);
    expect(() => parseProjectManifest({
      ...base,
      checks: { trace_memory: { kind: "trace", program: "bun", args: [], verifies: ["kernel/memory"], timeout: 1000 } },
    })).toThrow(/workload|oracle|artifacts/i);
    const parsed = parseProjectManifest({
      ...base,
      checks: {
        fuzz_memory: {
          kind: "fuzz",
          program: "bun",
          args: ["test", "tests/memory.fuzz.ts"],
          timeout: 1000,
          verifies: ["kernel/memory"],
          seed: 7,
          cases: 32,
          reproduction_artifact: ".vos/fuzz/memory-min.json",
        },
        trace_memory: {
          kind: "trace",
          program: "bun",
          args: ["test", "tests/memory.trace.ts"],
          timeout: 1000,
          verifies: ["kernel/memory"],
          workload: "allocator-smoke",
          oracle: "allocated pages remain uniquely owned",
          artifacts: [".vos/trace/memory.json"],
        },
      },
    });
    expect(parsed.checks.fuzz_memory.seed).toBe(7);
    expect(parsed.checks.trace_memory.oracle).toContain("uniquely owned");
  });

  test("reports semantic errors for missing v2 module dependencies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-dependency-"));
    await mkdir(path.join(root, "spec", "modules"), { recursive: true });
    await writeFile(path.join(root, "spec", "modules", "memory.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "level: 2",
      "purpose: allocate pages",
      "owns: [kernel/memory.c, tests/generated/kernel/memory]",
      "interface: []",
      "properties: []",
      "errors: [out_of_memory]",
      "state: { free_pages: counter }",
      "preconditions: [initialized]",
      "postconditions: [ownership transferred]",
      "invariants: [free pages are uniquely owned]",
      "dependencies: [kernel/missing]",
      "",
    ].join("\n"));
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((item) => item.code === "module.dependency_missing")).toBe(true);
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(true);
  });

  test("rejects bare diff as a SpecPatch ref", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-patch-ref-"));
    await expect(resolveSpecPatch({ projectRoot: root, ref: "-" })).rejects.toThrow("SpecPatch YAML path or commit-ish");
  });
});
