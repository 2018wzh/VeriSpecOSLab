import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildNormalizedSpecBundle,
  composeArchitecture,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  resolveSpecPatch,
} from "./index.ts";

describe("vos-spec semantic bundle", () => {
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
