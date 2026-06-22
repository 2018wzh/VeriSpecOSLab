import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceWriter } from "../app/evidence/index.ts";
import { executeCommand } from "../app/main.ts";
import { runBuildCommand } from "../app/runtime/build.ts";
import { runQemuCommand } from "../app/runtime/run.ts";
import { runVerifyCommand } from "../app/runtime/verify.ts";
import type { HeadlessAgentOptions } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("xv6-spec offline runtime flow", () => {
  test("supports dry-run build, run, and public verify without LLM/toolchain/QEMU", async () => {
    const projectRoot = makeXv6Fixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["offline-xv6-flow"],
      args: [],
    });

    const build = await runBuildCommand({
      projectRoot,
      evidence,
      dryRun: true,
    });
    expect(build.status).toBe("ok");
    expect(build.output).toContain("make all");

    const run = await runQemuCommand({
      projectRoot,
      evidence,
      dryRun: true,
    });
    expect(run.status).toBe("ok");
    expect(run.output).toContain("-kernel build/kernel.bin");

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "public",
      dryRun: true,
    });
    expect(verify.status).toBe("ok");
    expect(verify.steps.map((step) => step.name)).toEqual([
      "normalize",
      "consistency",
      "build",
      "run",
    ]);
    expect(verify.requiredChecks?.map((check) => check.id)).toEqual([
      "verify-boot-banner",
      "verify-sys-write",
    ]);
  });

  test("treats ready signal as success even when QEMU is later timed out", async () => {
    const projectRoot = makeXv6Fixture();
    const fakeQemu = join(projectRoot, "fake-qemu.sh");
    mkdirSync(join(projectRoot, "build"), { recursive: true });
    writeFileSync(join(projectRoot, "build", "kernel.bin"), "fake kernel\n");
    writeFileSync(fakeQemu, [
      "#!/usr/bin/env sh",
      "printf 'booting\\nXV6_BOOT_OK\\n'",
      "sleep 2",
      "",
    ].join("\n"));
    chmodSync(fakeQemu, 0o755);
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify({
      files: ["Makefile"],
      build: {
        commands: ["make all"],
        artifacts: ["build/kernel.bin"],
      },
      run: {
        command: fakeQemu,
        args: ["-kernel"],
        successSignal: "XV6_BOOT_OK",
        artifact: "build/kernel.bin",
        timeout_ms: 50,
      },
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["ready-signal-timeout"],
      args: [],
    });

    const run = await runQemuCommand({
      projectRoot,
      evidence,
      dryRun: false,
    });

    expect(run.status).toBe("ok");
    expect(run.readyDetected).toBe(true);
    expect(run.output).toContain("XV6_BOOT_OK");
  });

  test("honors object build command cwd and timeout metadata", async () => {
    const projectRoot = makeXv6Fixture();
    mkdirSync(join(projectRoot, "subdir"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify({
      files: ["Makefile"],
      build: {
        commands: [{
          name: "record-cwd",
          command: ["sh", "-c", "pwd > cwd.txt"],
          cwd: "subdir",
          timeout_ms: 1000,
        }],
        artifacts: [],
      },
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["object-build-command"],
      args: [],
    });

    const build = await runBuildCommand({
      projectRoot,
      evidence,
      dryRun: false,
    });

    expect(build.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "subdir", "cwd.txt"), "utf8").trim().endsWith("/subdir"))
      .toBe(true);
  });

  test("verify patch requires a SpecPatch instead of falling back to public matrix", async () => {
    const projectRoot = makeXv6Fixture({ publicMatrix: false });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch-no-public-matrix"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "patch",
      dryRun: true,
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.steps).toEqual([{ name: "resolve SpecPatch", status: "validation_failed" }]);
    expect(verify.requiredChecks).toEqual([{ id: "spec-patch-required", status: "validation_failed" }]);
  });

  test("verify patch runs build and exact test suites from SpecPatch impact", async () => {
    const { projectRoot, patchRef } = await makePatchVerifyFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "patch",
      target: patchRef,
      dryRun: false,
    });

    expect(verify.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "build.log"), "utf8").trim()).toBe("build");
    expect(readFileSync(join(projectRoot, "test.log"), "utf8").trim().split("\n").sort()).toEqual([
      "build_kernel",
      "kalloc_alignment",
    ]);
  });

  test("verify patch fails unknown checks and treats test build_kernel as a test", async () => {
    const freeform = await makePatchVerifyFixture({ freeformCheck: true });
    let evidence = await EvidenceWriter.create({
      projectRoot: freeform.projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch-freeform"],
      args: [],
    });

    let verify = await runVerifyCommand({
      projectRoot: freeform.projectRoot,
      evidence,
      scope: "patch",
      target: freeform.patchRef,
      dryRun: false,
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.steps).toEqual([{ name: "manual inspect", status: "validation_failed" }]);

    const buildKernel = await makePatchVerifyFixture({ onlyBuildKernelTest: true });
    evidence = await EvidenceWriter.create({
      projectRoot: buildKernel.projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch-build-kernel"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot: buildKernel.projectRoot,
      evidence,
      scope: "patch",
      target: buildKernel.patchRef,
      dryRun: false,
    });

    expect(verify.status).toBe("ok");
    expect(existsSync(join(buildKernel.projectRoot, "build.log"))).toBe(false);
    expect(readFileSync(join(buildKernel.projectRoot, "test.log"), "utf8").trim()).toBe("build_kernel");
  });

  test("verify patch uses derived module and operation impact when metadata is incomplete", async () => {
    const { projectRoot, patchRef } = await makePatchVerifyFixture({ omitImpactMetadata: true });
    let evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch-derived-dry-run"],
      args: [],
    });

    let verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "patch",
      target: patchRef,
      dryRun: true,
    });

    expect(verify.status).toBe("ok");
    expect(verify.requiredChecks?.map((check) => check.id)).toContain("test kalloc_alignment");

    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-patch-derived-run"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "patch",
      target: patchRef,
      dryRun: false,
    });

    expect(verify.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "build.log"), "utf8").trim()).toBe("build");
    expect(readFileSync(join(projectRoot, "test.log"), "utf8").trim().split("\n").sort()).toEqual([
      "build_kernel",
      "kalloc_alignment",
    ]);
  });

  test("verify invariant runs suites mapped from preserved invariants", async () => {
    const projectRoot = makeVerifyMappingFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-invariant"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "invariant",
      dryRun: false,
    });

    expect(verify.status).toBe("ok");
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "freelist", status: "ok" }));
    expect("trace" in (verify.steps[0] as Record<string, unknown>)).toBe(false);
    expect(readFileSync(join(projectRoot, "test.log"), "utf8").trim()).toBe("kalloc_alignment");
  });

  test("verify fuzz runs generated and hidden tag suites", async () => {
    const projectRoot = makeVerifyMappingFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: false,
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("ok");
    expect(verify.requiredChecks?.map((check) => check.id).sort()).toEqual(["kalloc_race", "kalloc_zeroed"]);
    expect("trace" in (verify.steps[0] as Record<string, unknown>)).toBe(false);
    expect(readFileSync(join(projectRoot, "test.log"), "utf8").trim().split("\n")).toEqual([
      "kalloc_zeroed",
      "grind",
    ]);
  });

  test("verify fuzz dry-run writes behavior TestPlan evidence only", async () => {
    const projectRoot = makeVerifyMappingFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz-dry-run-behavior"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: true,
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("ok");
    expect(existsSync(join(evidence.run_root, "artifacts", "verify-behavior", "fuzz-plan.json"))).toBe(true);
    expect(existsSync(join(evidence.run_root, "artifacts", "verify-behavior", "fuzz-patch.json"))).toBe(false);
  });

  test("verify fuzz runs generated behavior tests in a temporary worktree", async () => {
    const projectRoot = makeVerifyMappingFixture();
    writeFileSync(join(projectRoot, "kernel.c"), "int main(void) { return 0; }\n");
    const before = readFileSync(join(projectRoot, "kernel.c"), "utf8");
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz-behavior"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: false,
      behaviorTestRunner: fakeBehaviorTestRunner({
        patch: [
          "diff --git a/kernel.c b/kernel.c",
          "--- a/kernel.c",
          "+++ b/kernel.c",
          "@@ -1 +1,2 @@",
          " int main(void) { return 0; }",
          "+/* temporary behavior test harness */",
          "",
        ].join("\n"),
      }),
    });

    expect(verify.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "kernel.c"), "utf8")).toBe(before);
    expect(existsSync(join(evidence.run_root, "artifacts", "verify-behavior", "fuzz-patch.json"))).toBe(true);
    expect(readFileSync(join(evidence.run_root, "artifacts", "verify-behavior", "fuzz-cases", "kalloc-zeroed-behavior", "stdout.log"), "utf8"))
      .toContain("BEHAVIOR_OK");
  });

  test("verify behavior generation failures are validation failures", async () => {
    let projectRoot = makeVerifyMappingFixture();
    let evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz-bad-plan"],
      args: [],
    });

    let verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: false,
      behaviorTestRunner: async () => JSON.stringify({ cases: [] }),
    });
    expect(verify.status).toBe("validation_failed");

    projectRoot = makeVerifyMappingFixture();
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz-bad-patch"],
      args: [],
    });
    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: false,
      behaviorTestRunner: fakeBehaviorTestRunner({
        patch: [
          "diff --git a/spec/bad.yaml b/spec/bad.yaml",
          "--- a/spec/bad.yaml",
          "+++ b/spec/bad.yaml",
          "@@ -0,0 +1 @@",
          "+bad: true",
          "",
        ].join("\n"),
      }),
    });
    expect(verify.status).toBe("validation_failed");

    projectRoot = makeVerifyMappingFixture();
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-fuzz-oracle-mismatch"],
      args: [],
    });
    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "fuzz",
      dryRun: false,
      behaviorTestRunner: fakeBehaviorTestRunner({ successRegex: "NEVER_MATCHES" }),
    });
    expect(verify.status).toBe("validation_failed");
  });

  test("verify full runs public generated invariant fuzz and staff suites in order", async () => {
    const projectRoot = makeVerifyMappingFixture({ visibility: "staff-only" });
    const staffPolicy = join("/tmp", `vos-staff-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    tmpRoots.push(staffPolicy);
    writeFileSync(staffPolicy, JSON.stringify({
      verify: {
        full: ["staff_full"],
      },
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full"],
      args: [],
    });

    const verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      staffPolicy,
      visibilityScope: "staff-only",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("ok");
    expect(verify.steps.map((step) => step.name)).toEqual([
      "public",
      "generated",
      "invariant",
      "fuzz",
      "staff",
    ]);
    expect(verify.steps.some((step) => "trace" in (step as Record<string, unknown>))).toBe(false);
    expect(readFileSync(join(projectRoot, "test.log"), "utf8").trim().split("\n")).toEqual([
      "bootstrap_banner_not_null",
      "kalloc_zeroed",
      "kalloc_alignment",
      "grind",
      "staff_full",
    ]);
  });

  test("verify mapping failures and staff policy gates are explicit", async () => {
    let projectRoot = makeVerifyMappingFixture({ invariantMapping: false });
    let evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-invariant-missing"],
      args: [],
    });

    let verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "invariant",
      dryRun: false,
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "freelist", status: "validation_failed" }));

    projectRoot = makeVerifyMappingFixture({ visibility: "staff-only" });
    const internalPolicy = join(projectRoot, ".vos", "staff-policy.json");
    writeFileSync(internalPolicy, JSON.stringify({ verify: { full: ["staff_full"] } }));
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full-internal-policy"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      staffPolicy: internalPolicy,
      visibilityScope: "staff-only",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("policy_blocked");

    const externalPolicy = join("/tmp", `vos-staff-denied-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    tmpRoots.push(externalPolicy);
    writeFileSync(externalPolicy, JSON.stringify({ verify: { full: ["staff_full"] } }));
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full-denied"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      staffPolicy: externalPolicy,
      visibilityScope: "public",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("policy_blocked");
  });

  test("build fails when toolchain manifest is missing instead of legacy auto-materializing", async () => {
    const projectRoot = makeXv6Fixture({ toolchainManifest: false });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["missing-toolchain"],
      args: [],
    });

    await expect(runBuildCommand({
      projectRoot,
      evidence,
      dryRun: true,
    })).rejects.toThrow(/toolchain manifest/);
    expect(existsSync(join(projectRoot, ".vos", "toolchain.json"))).toBe(false);
  });

  test("toolchain lint reports missing manifest without generating one", async () => {
    const projectRoot = makeXv6Fixture({ toolchainManifest: false });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["toolchain", "lint"],
      args: [],
    });

    const lint = await executeCommand({
      kind: "toolchain_lint",
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(lint.status).toBe("passed");
    expect(lint.details.manifestExists).toBe(false);
    expect(lint.details.manifestPath).toBeUndefined();
  });

  test("rejects manifest files that were not generated in the project root", async () => {
    const projectRoot = makeXv6Fixture();
    rmSync(join(projectRoot, "Makefile"), { force: true });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["missing-generated-build-file"],
      args: [],
    });

    await expect(runBuildCommand({
      projectRoot,
      evidence,
      dryRun: true,
    })).rejects.toThrow(/missing generated files: Makefile/);
  });

  test("agent generate fake package runner applies, builds, and runs offline", async () => {
    const projectRoot = makeXv6Fixture({
      buildEntrypoint: false,
      toolchainManifest: false,
    });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "generate", "--apply", "--build", "--run"],
      args: [],
    });
    let captured: HeadlessAgentOptions | undefined;
    const runner = async (options: HeadlessAgentOptions) => {
      captured = options;
      return {
        content: JSON.stringify({
          task: "generate syscall build entrypoint",
          patch: makeAgentGeneratePatch(),
          bound_clauses: ["spec/stages/syscall.yaml"],
          changed_paths: ["Makefile", ".vos/toolchain.json"],
          changed_code_files: ["Makefile"],
          output_kind: "unified_diff",
          self_reported_risks: [],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "agent_generate",
      target: undefined,
      task: undefined,
      apply: true,
      build: true,
      run: true,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.prompt.includes('"task": "syscall"')).toBe(true);
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("spec: syscall");
    expect(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8")).toContain("offline-build");
    expect(result.details.applyStatus).toBe("ok");
    expect(result.details.buildRequested).toBe(true);
    expect(result.details.runStatus).toBe("ok");
  });
});

function makeXv6Fixture(options: {
  publicMatrix?: boolean;
  toolchainManifest?: boolean;
  buildEntrypoint?: boolean;
} = {}): string {
  const root = join("/tmp", `vos-cli-xv6-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);

  mkdirSync(join(root, ".vos", "cache", "normalized"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  mkdirSync(join(root, "spec", "stages"), { recursive: true });
  mkdirSync(join(root, "spec", "verification"), { recursive: true });

  writeFileSync(join(root, ".vos", "cache", "normalized", "bundle.json"), "{}\n");
  writeFileSync(join(root, ".vos", "project.yaml"), [
    "project_id: xv6-offline",
    "spec_root: spec",
    "current_stage: syscall",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_paths:",
    "  - spec",
    "  - .vos",
    "  - Makefile",
    "allowed_commands:",
    "  - build",
    "  - run qemu",
    "  - verify public",
    "visibility_scope: public",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "stages", "syscall.yaml"), "stage: syscall\n");
  if (options.buildEntrypoint !== false) {
    writeFileSync(join(root, "Makefile"), "all:\n\ttrue\n");
  }

  writeFileSync(join(root, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n  - run.yaml\n");
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "build:",
    "  allowed_output_path:",
    "    - Makefile",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "run.yaml"), [
    "run:",
    "  emulator: qemu-system-riscv64",
    "  machine: virt",
    "  kernel_arg: -kernel",
    "  success_signal: XV6_BOOT_OK",
    "  timeout_secs: 1",
    "",
  ].join("\n"));
  if (options.publicMatrix !== false) {
    writeFileSync(join(root, "spec", "verification", "public-matrix.yaml"), [
      "public_requirements:",
      "  - id: verify-boot-banner",
      "    required_artifacts:",
      "      - qemu_boot.log",
      "  - id: verify-sys-write",
      "    required_artifacts:",
      "      - kernel.elf",
      "",
    ].join("\n"));
  }
  if (options.toolchainManifest !== false) {
    writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
      files: ["Makefile"],
      build: {
        commands: ["make all"],
        artifacts: ["build/kernel.bin"],
      },
      run: {
        command: "qemu-system-riscv64",
        args: ["-machine", "virt", "-kernel"],
        successSignal: "XV6_BOOT_OK",
        artifact: "build/kernel.bin",
        timeout_ms: 1000,
      },
    }, null, 2));
  }

  return root;
}

function makeVerifyMappingFixture(options: {
  invariantMapping?: boolean;
  visibility?: "public" | "agent-only" | "staff-only";
} = {}): string {
  const root = join("/tmp", `vos-cli-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos", "cache", "normalized"), { recursive: true });
  mkdirSync(join(root, "spec", "architecture"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "memory", "ops"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  mkdirSync(join(root, "spec", "verification"), { recursive: true });

  writeFileSync(join(root, ".vos", "cache", "normalized", "bundle.json"), "{}\n");
  writeFileSync(join(root, ".vos", "project.yaml"), "project_id: verify-test\nspec_root: spec\ncurrent_stage: memory\n");
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_commands:",
    "  - verify public",
    "  - verify invariant",
    "  - verify fuzz",
    "  - verify full",
    `visibility_scope: ${options.visibility ?? "public"}`,
    "",
  ].join("\n"));
  writeFileSync(join(root, "Makefile"), "all:\n\ttrue\n");
  writeFileSync(join(root, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n  - run.yaml\n");
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "build:",
    "  allowed_output_path:",
    "    - Makefile",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "run.yaml"), [
    "run:",
    "  emulator: qemu-system-riscv64",
    "  machine: virt",
    "  kernel_arg: -kernel",
    "  success_signal: XV6_BOOT_OK",
    "  timeout_secs: 1",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "architecture", "timeline.yaml"), [
    "timeline:",
    "  - stage: memory",
    "    enabled_modules: [kernel/memory]",
    "    validation_gate: []",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
    "id: kernel/memory",
    "module: kernel/memory",
    "stage: memory",
    "purpose: allocator",
    "related_slices: []",
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
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "tests.yaml"), [
    "module: kernel/memory",
    "test_surfaces:",
    "  - bootstrap_banner_not_null",
    "  - kalloc_alignment",
    "  - kalloc_zeroed",
    "required_tests:",
    "  - test: kalloc_alignment",
    "    description: allocator alignment",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), [
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
    "  public: [bootstrap_banner_not_null]",
    "  generated: [kalloc_zeroed]",
    "  hidden_tags: [kalloc_race]",
    "codegen:",
    "  targets: []",
    "  required_followup_checks: []",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "verification", "public-matrix.yaml"), [
    "public_requirements:",
    "  - id: verify-boot-banner",
    "    required_tests:",
    "      - bootstrap_banner_not_null",
    "    required_artifacts:",
    "      - qemu_boot.log",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
    files: ["Makefile"],
    build: {
      commands: ["true"],
      artifacts: [],
    },
    test: {
      suites: [
        { name: "bootstrap_banner_not_null", command: ["sh", "-c", "echo bootstrap_banner_not_null >> test.log"] },
        { name: "kalloc_alignment", command: ["sh", "-c", "echo kalloc_alignment >> test.log"] },
        { name: "kalloc_zeroed", command: ["sh", "-c", "echo kalloc_zeroed >> test.log"] },
        { name: "grind", command: ["sh", "-c", "echo grind >> test.log"] },
        { name: "staff_full", command: ["sh", "-c", "echo staff_full >> test.log"] },
      ],
    },
    verify: {
      full: [],
      generated: {
        kalloc_zeroed: ["kalloc_zeroed"],
      },
      invariant: options.invariantMapping === false ? {} : {
        freelist: ["kalloc_alignment"],
      },
      fuzz: {
        kalloc_race: ["grind"],
      },
    },
  }, null, 2));

  return root;
}

function fakeBehaviorTestRunner(options: { patch?: string; successRegex?: string } = {}) {
  return async (request: { kind: "plan" | "patch" }) => {
    if (request.kind === "plan") {
      return JSON.stringify({
        cases: [{
          id: "kalloc-zeroed-behavior",
          obligation_id: "kalloc_zeroed",
          purpose: "exercise generated allocator behavior",
          carrier: "user_program",
          stimulus: { stdin: "kalloc_zeroed\n" },
          oracle: {
            success_regex: options.successRegex ?? "BEHAVIOR_OK",
            failure_regex: "FAIL|panic",
            timeout_ms: 1000,
          },
        }],
      });
    }
    return JSON.stringify({
      patch: options.patch ?? "",
      suites: [{
        name: "kalloc-zeroed-behavior-suite",
        command: ["sh", "-c", "printf BEHAVIOR_OK"],
      }],
      cases: [{
        id: "kalloc-zeroed-behavior",
        obligation_id: "kalloc_zeroed",
        suite: "kalloc-zeroed-behavior-suite",
        stdin: "kalloc_zeroed\n",
        success_regex: options.successRegex ?? "BEHAVIOR_OK",
        failure_regex: "FAIL|panic",
        timeout_ms: 1000,
      }],
    });
  };
}

async function makePatchVerifyFixture(options: {
  freeformCheck?: boolean;
  onlyBuildKernelTest?: boolean;
  omitImpactMetadata?: boolean;
} = {}): Promise<{ projectRoot: string; patchRef: string }> {
  const root = join("/tmp", `vos-cli-patch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "architecture"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "memory", "ops"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  mkdirSync(join(root, "spec", "evolution"), { recursive: true });

  writeFileSync(join(root, ".vos", "project.yaml"), "project_id: patch-test\nspec_root: spec\ncurrent_stage: memory\n");
  writeFileSync(join(root, "Makefile"), "all:\n\ttrue\n");
  writeFileSync(join(root, "spec", "architecture", "timeline.yaml"), [
    "timeline:",
    "  - stage: memory",
    "    enabled_modules: [kernel/memory]",
    "    validation_gate: []",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
    "id: kernel/memory",
    "module: kernel/memory",
    "stage: memory",
    "purpose: allocator",
    "related_slices: []",
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
  writePatchVerifyOperation(root, { publicTests: ["kalloc_alignment"], followupChecks: [] });
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "build:",
    "  allowed_output_path:",
    "    - Makefile",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
    files: ["Makefile"],
    build: {
      commands: [{ name: "build", command: ["sh", "-c", "mkdir -p build; echo kernel > build/kernel.bin; echo build >> build.log"] }],
      artifacts: ["build/kernel.bin"],
    },
    test: {
      suites: [
        { name: "build_kernel", command: ["sh", "-c", "echo build_kernel >> test.log"] },
        { name: "kalloc_alignment", command: ["sh", "-c", "echo kalloc_alignment >> test.log"] },
      ],
    },
  }, null, 2));

  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);

  writePatchVerifyOperation(root, {
    publicTests: options.onlyBuildKernelTest ? ["build_kernel"] : ["kalloc_alignment"],
    followupChecks: options.freeformCheck ? ["manual inspect"] : options.onlyBuildKernelTest ? [] : ["build"],
  });
  if (options.omitImpactMetadata) {
    writeFileSync(join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "stage: memory",
      "purpose: allocator v2",
      "related_slices: []",
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
  }
  writeFileSync(join(root, "spec", "evolution", "patch-001.yaml"), [
    "id: patch-001",
    "stage: memory",
    "title: Patch 001",
    "reason: test",
    "kind: operation_change",
    "affected_specs:",
    "  - spec/evolution/patch-001.yaml",
    ...(options.omitImpactMetadata ? ["  - spec/modules/kernel/memory/module.yaml"] : []),
    "  - spec/modules/kernel/memory/ops/kalloc.yaml",
    `affected_modules: [${options.omitImpactMetadata ? "" : "kernel/memory"}]`,
    `affected_operations: [${options.omitImpactMetadata ? "" : "kernel/memory.kalloc"}]`,
    "before: {}",
    "after: {}",
    "risks: []",
    "required_regressions: [build_kernel]",
    "",
  ].join("\n"));
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "patch\n\nSpec-Patch-ID: patch-001"]);
  return { projectRoot: root, patchRef: git(root, ["rev-parse", "HEAD"]).trim() };
}

function writePatchVerifyOperation(root: string, options: { publicTests: string[]; followupChecks: string[] }): void {
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), [
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
    `  public: [${options.publicTests.join(", ")}]`,
    "  generated: []",
    "  hidden_tags: []",
    "codegen:",
    "  targets:",
    "    - kind: symbol",
    "      path: kernel/kalloc.c",
    "      symbols: [kalloc]",
    "      owner: kernel/memory",
    "      mode: modify",
    `  required_followup_checks: [${options.followupChecks.join(", ")}]`,
    "",
  ].join("\n"));
}

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString());
  }
  return proc.stdout.toString();
}

function makeAgentGeneratePatch(): string {
  return [
    "diff --git a/Makefile b/Makefile",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/Makefile",
    "@@ -0,0 +1,3 @@",
    "+# spec: syscall",
    "+all:",
    "+\ttrue",
    "diff --git a/.vos/toolchain.json b/.vos/toolchain.json",
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    "+++ b/.vos/toolchain.json",
    "@@ -0,0 +1,17 @@",
    "+{",
    "+  \"files\": [\"Makefile\"],",
    "+  \"build\": {",
    "+    \"commands\": [{",
    "+      \"name\": \"offline-build\",",
    "+      \"command\": [\"sh\", \"-c\", \"true\"]",
    "+    }],",
    "+    \"artifacts\": [\"build/kernel.bin\"]",
    "+  },",
    "+  \"run\": {",
    "+    \"command\": \"sh\",",
    "+    \"args\": [\"-c\", \"echo XV6_BOOT_OK\", \"-kernel\"],",
    "+    \"successSignal\": \"XV6_BOOT_OK\",",
    "+    \"artifact\": \"Makefile\",",
    "+    \"timeout_ms\": 1000",
    "+  }",
    "+}",
    "",
  ].join("\n");
}
