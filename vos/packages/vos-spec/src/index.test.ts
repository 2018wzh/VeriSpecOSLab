import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  buildNormalizedSpecBundle,
  composeArchitecture,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  parseProjectManifest,
  resolveSpecPatch,
} from "./index.ts";

describe("vos-spec semantic bundle", () => {
  test("normalizes the student v2 contract and manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vos-spec-v2-"));
    await mkdir(path.join(root, "spec", "modules"), { recursive: true });
    await mkdir(path.join(root, "spec", "interfaces"), { recursive: true });
    await writeFile(path.join(root, "spec", "design.yaml"), [
      "system: { name: demo-os, language: rust, isa: riscv64 }",
      "machine: { qemu: { machine: virt }, hardware: {} }",
      "kernel: { organization: monolithic, execution: preemptive, protection: paging, communication: ipc, resource_model: ownership }",
      "required_mechanisms: [syscall]",
      "composition_invariants: [all syscalls validate pointers]",
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
      "runners: { qemu: { program: bun, args: [--version], cwd: ., env: [], timeout: 1000, artifacts: [] } }",
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
      build: { program: "bun", args: [], cwd: "../outside" },
      runners: {},
      checks: {},
    })).toThrow(/cwd/);
  });

  test("normalizes modules, operations, architecture, and derived tests", async () => {
    const root = await fixtureProject();
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(false);
    expect(bundle.modules.map((item) => item.id)).toEqual(["kernel/memory"]);
    expect(bundle.operations.map((item) => item.id)).toEqual(["kernel/memory.kalloc"]);

    const composition = composeArchitecture(bundle, "memory");
    expect(composition.enabled_modules).toEqual(["kernel/memory"]);
    expect(composition.enabled_operations).toEqual(["kernel/memory.kalloc"]);

    const matrix = deriveTestMatrix(bundle, "memory");
    expect(matrix.public_tests.map((item) => item.id)).toContain("kalloc_alignment");
    expect(matrix.generated_tests.map((item) => item.id)).toContain("kalloc_zeroed");
  });

  test("reports semantic errors for missing operation dependencies", async () => {
    const root = await fixtureProject({ missingDependency: true });
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((item) => item.code === "operation.requires_op_missing")).toBe(true);
    expect(hasBlockingDiagnostics(bundle.diagnostics)).toBe(true);
  });

  test("rejects bare diff as a SpecPatch ref", async () => {
    const root = await fixtureProject();
    await expect(resolveSpecPatch({ projectRoot: root, ref: "-" })).rejects.toThrow("SpecPatch YAML path or commit-ish");
  });

  test("validates affected_specs exactly against git spec YAML diff", async () => {
    const root = await gitFixtureProject([
      "spec/architecture/timeline.yaml",
      "spec/architecture/slices/02-memory.yaml",
      "spec/modules/kernel/memory/module.yaml",
      "spec/modules/kernel/memory/ops/kalloc.yaml",
      "spec/verification/public-matrix.yaml",
      "spec/evolution/patch-001.yaml",
    ]);
    const git = simpleGit(root);
    await git.add(".");
    const rootCommit = await commitAndHead(git, "root\n\nSpec-Patch-ID: patch-001");
    let bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    let report = await resolveSpecPatch({ projectRoot: root, ref: rootCommit, bundle });
    expect(report.impact.diagnostics.filter((item) => item.code.startsWith("patch.diff_"))).toEqual([]);

    await writePatch(root, "patch-001", ["spec/evolution/patch-001.yaml"]);
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), operationYaml({ publicTests: ["kalloc_alignment", "kalloc_smoke"] }));
    await git.add(".");
    const missingCommit = await commitAndHead(git, "missing\n\nSpec-Patch-ID: patch-001");
    bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    report = await resolveSpecPatch({ projectRoot: root, ref: missingCommit, bundle });
    expect(report.impact.diagnostics.some((item) => item.code === "patch.diff_unlisted_spec")).toBe(true);

    await writePatch(root, "patch-001", [
      "spec/evolution/patch-001.yaml",
      "spec/modules/kernel/memory/ops/kalloc.yaml",
      "spec/architecture/timeline.yaml",
    ]);
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), operationYaml({ publicTests: ["kalloc_alignment"] }));
    await git.add(".");
    const staleCommit = await commitAndHead(git, "stale\n\nSpec-Patch-ID: patch-001");
    bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    report = await resolveSpecPatch({ projectRoot: root, ref: staleCommit, bundle });
    expect(report.impact.diagnostics.some((item) => item.code === "patch.diff_stale_spec")).toBe(true);
  }, 60_000);

  test("validates SpecPatch DAG from commit metadata", async () => {
    const root = await fixtureProject();
    await mkdir(path.join(root, "spec", "evolution"), { recursive: true });

    await writePatch(root, "patch-001", [], { commitSha: "aaa111", parentSha: null });
    await writePatch(root, "patch-002", [], { commitSha: "bbb222", parentSha: "aaa111" });
    let bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.filter((item) => item.code.startsWith("patch."))).toEqual([]);

    await writePatch(root, "patch-002", [], { commitSha: "bbb222", parentSha: "missing" });
    bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((item) => item.code === "patch.parent_missing")).toBe(true);

    await writePatch(root, "patch-002", [], { commitSha: "aaa111", parentSha: "aaa111" });
    bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    expect(bundle.diagnostics.some((item) => item.code === "patch.commit_duplicate")).toBe(true);
  });

  test("derives patch impact from changed module and operation specs", async () => {
    const root = await gitFixtureProject([]);
    const git = simpleGit(root);
    await git.add(".");
    await git.commit("base");

    await writePatch(root, "patch-001", [
      "spec/evolution/patch-001.yaml",
      "spec/modules/kernel/memory/module.yaml",
      "spec/modules/kernel/memory/ops/kalloc.yaml",
    ], { affectedModules: [], affectedOperations: [] });
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "stage: memory",
      "purpose: allocator v2",
      "related_slices: [slice-02-memory]",
      "related_adrs: []",
      "owned_state: [freelist]",
      "exported_interfaces: [kalloc]",
      "imported_interfaces: []",
      "module_invariants: [aligned]",
      "error_model: [returns null]",
      "resource_lifetime_rules: [free after alloc]",
      "security_boundary: [kernel only]",
      "test_surfaces: [allocator]",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), operationYaml({ publicTests: ["kalloc_alignment", "kalloc_smoke"] }));
    await git.add(".");
    const commit = await commitAndHead(git, "derive impact\n\nSpec-Patch-ID: patch-001");

    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });
    const report = await resolveSpecPatch({ projectRoot: root, ref: commit, bundle });
    expect(report.impact.affected_modules).toEqual(["kernel/memory"]);
    expect(report.impact.affected_operations).toEqual(["kernel/memory.kalloc"]);
    expect(report.impact.selected_tests).toEqual(["kalloc_alignment", "kalloc_smoke"]);
    expect(report.impact.required_checks).toContain("test kalloc_alignment");
    expect(report.impact.required_checks).toContain("test kalloc_smoke");
    expect(report.impact.diagnostics.some((item) => item.code === "patch.impact_unlisted_module")).toBe(true);
    expect(report.impact.diagnostics.some((item) => item.code === "patch.impact_unlisted_operation")).toBe(true);
  }, 20_000);

  test("strict SpecPatch resolution requires commit metadata", async () => {
    const root = await fixtureProject();
    await mkdir(path.join(root, "spec", "evolution"), { recursive: true });
    await writePatch(root, "patch-001", ["spec/modules/kernel/memory/ops/kalloc.yaml"]);
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });

    const report = await resolveSpecPatch({
      projectRoot: root,
      ref: "spec/evolution/patch-001.yaml",
      bundle,
      strict: true,
    });

    expect(report.impact.diagnostics.some((item) => item.code === "patch.commit_missing")).toBe(true);
    expect(report.impact.diagnostics.some((item) => item.code === "patch.parent_missing")).toBe(true);
  }, 20_000);

  test("strict SpecPatch resolution rejects commit trailer mismatches", async () => {
    const root = await gitFixtureProject(["spec/modules/kernel/memory/ops/kalloc.yaml"]);
    await writePatch(root, "patch-001", ["spec/modules/kernel/memory/ops/kalloc.yaml"], { parentSha: null });
    const git = simpleGit(root);
    await git.add(".");
    const commit = await commitAndHead(git, [
      "patch",
      "",
      "Spec-Patch-ID: patch-001",
      "Spec-Commit-SHA: trailer-spec",
    ].join("\n"));
    await writePatch(root, "patch-001", ["spec/modules/kernel/memory/ops/kalloc.yaml"], {
      commitSha: commit,
      parentSha: null,
    });
    const patchPath = path.join(root, "spec", "evolution", "patch-001.yaml");
    await writeFile(patchPath, (await readFile(patchPath, "utf8")).replace("parent_sha: null", "parent_sha: null\nspec_commit_sha: yaml-spec"));
    const bundle = await buildNormalizedSpecBundle({ projectRoot: root });

    const report = await resolveSpecPatch({
      projectRoot: root,
      ref: commit,
      bundle,
      strict: true,
    });

    expect(report.impact.diagnostics.some((item) => item.code === "patch.trailer_spec_commit_mismatch")).toBe(true);
  }, 20_000);
});

async function fixtureProject(opts: { missingDependency?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vos-spec-test-"));
  await mkdir(path.join(root, "spec", "architecture", "slices"), { recursive: true });
  await mkdir(path.join(root, "spec", "modules", "kernel", "memory", "ops"), { recursive: true });
  await mkdir(path.join(root, "spec", "verification"), { recursive: true });
  await writeFile(path.join(root, "spec", "architecture", "timeline.yaml"), [
    "timeline:",
    "  - stage: memory",
    "    slice: slice-02-memory",
    "    enabled_modules: [kernel/memory]",
    "    validation_gate: [memory-public]",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "spec", "architecture", "slices", "02-memory.yaml"), [
    "id: slice-02-memory",
    "stage: memory",
    "enabled_modules: [kernel/memory]",
    "validation_gate: [memory-public]",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
    "id: kernel/memory",
    "module: kernel/memory",
    "stage: memory",
    "purpose: allocator",
    "related_slices: [slice-02-memory]",
    "related_adrs: []",
    "owned_state: [freelist]",
    "exported_interfaces: [kalloc]",
    "imported_interfaces: []",
    "module_invariants: [aligned]",
    "error_model: [returns null]",
    "resource_lifetime_rules: [free after alloc]",
    "security_boundary: [kernel only]",
    "test_surfaces: [allocator]",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), [
    "id: kernel/memory.kalloc",
    "stage: memory",
    "module: kernel/memory",
    "operation: kalloc",
    "purpose: allocate page",
    "depends_on:",
    "  requires_modules: [kernel/memory]",
    `  requires_ops: [${opts.missingDependency ? "kernel/memory.kinit" : ""}]`,
    "guarantee:",
    "  returns: [page]",
    "preconditions: [initialized]",
    "postconditions: [aligned]",
    "invariants_preserved: [freelist]",
    "failure_semantics: [null on exhaustion]",
    "test_obligations:",
    "  public: [kalloc_alignment]",
    "  generated: [kalloc_zeroed]",
    "  hidden_tags: [kalloc_race]",
    "codegen:",
    "  targets:",
    "    - kind: symbol",
    "      path: kernel/kalloc.c",
    "      symbols: [kalloc]",
    "      owner: kernel/memory",
    "      mode: modify",
    "  required_followup_checks: [build]",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "spec", "verification", "public-matrix.yaml"), [
    "public_requirements:",
    "  - id: memory-public",
    "    related_specs: [spec/modules/kernel/memory/ops/kalloc.yaml]",
    "    required_tests: [kalloc_alignment]",
    "    required_artifacts: [build/kernel.elf]",
    "",
  ].join("\n"));
  return root;
}

async function gitFixtureProject(affectedSpecs: string[]): Promise<string> {
  const root = await fixtureProject();
  await mkdir(path.join(root, "spec", "evolution"), { recursive: true });
  await writePatch(root, "patch-001", affectedSpecs);
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test User");
  return root;
}

async function commitAndHead(git: SimpleGit, message: string): Promise<string> {
  await git.commit(message);
  return (await git.revparse(["HEAD"])).trim();
}

async function writePatch(root: string, id: string, affectedSpecs: string[], opts: {
  commitSha?: string | null;
  parentSha?: string | null;
  affectedModules?: string[];
  affectedOperations?: string[];
} = {}): Promise<void> {
  await writeFile(path.join(root, "spec", "evolution", `${id}.yaml`), [
    `id: ${id}`,
    "stage: memory",
    "title: Patch 001",
    "reason: test",
    "kind: operation_change",
    ...(opts.commitSha !== undefined ? [`commit_sha: ${opts.commitSha ?? "null"}`] : []),
    ...(opts.parentSha !== undefined ? [`parent_sha: ${opts.parentSha ?? "null"}`] : []),
    "affected_specs:",
    ...affectedSpecs.map((spec) => `  - ${spec}`),
    `affected_modules: [${(opts.affectedModules ?? ["kernel/memory"]).join(", ")}]`,
    `affected_operations: [${(opts.affectedOperations ?? ["kernel/memory.kalloc"]).join(", ")}]`,
    "before: {}",
    "after: {}",
    "risks: []",
    "required_regressions: []",
    "",
  ].join("\n"));
}

function operationYaml(opts: { publicTests: string[] }): string {
  return [
    "id: kernel/memory.kalloc",
    "stage: memory",
    "module: kernel/memory",
    "operation: kalloc",
    "purpose: allocate page",
    "depends_on:",
    "  requires_modules: [kernel/memory]",
    "  requires_ops: []",
    "guarantee:",
    "  returns: [page]",
    "preconditions: [initialized]",
    "postconditions: [aligned]",
    "invariants_preserved: [freelist]",
    "failure_semantics: [null on exhaustion]",
    "test_obligations:",
    `  public: [${opts.publicTests.join(", ")}]`,
    "  generated: [kalloc_zeroed]",
    "  hidden_tags: [kalloc_race]",
    "codegen:",
    "  targets:",
    "    - kind: symbol",
    "      path: kernel/kalloc.c",
    "      symbols: [kalloc]",
    "      owner: kernel/memory",
    "      mode: modify",
    "  required_followup_checks: [build]",
    "",
  ].join("\n");
}
