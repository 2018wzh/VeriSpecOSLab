import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceWriter } from "../app/evidence/index.ts";
import { executeCommand } from "../app/main.ts";
import {
  buildTraceCoverageHints,
  buildTraceValidationInput,
  collectModuleTestSurfaces,
  collectPublicRequirements,
  filterModuleTestsForTarget,
  filterPublicRequirementsForTarget,
  parseTraceValidationPlan,
  parseVosTraceLines,
  validateInstrumentationPatch,
} from "../app/runtime/trace-validation.ts";
import type { HeadlessAgentOptions } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("trace validation runtime", () => {
  test("collects public requirements and module test surfaces without modifying spec", async () => {
    const projectRoot = makeTraceProject();

    const requirements = await collectPublicRequirements(projectRoot);
    const surfaces = await collectModuleTestSurfaces(projectRoot);

    expect(requirements).toEqual([{
      id: "verify-boot-banner",
      description: "boot reaches shell",
      related_specs: ["kernel/boot.boot_banner"],
      required_tests: ["boot_banner_printable", "shell_boots"],
      required_artifacts: ["qemu_boot.log"],
    }, {
      id: "verify-page-allocator",
      description: "physical page allocator cycles pages",
      related_specs: ["kernel/memory.kalloc", "kernel/memory.kfree"],
      required_tests: ["kalloc_alignment", "kalloc_kfree_cycle"],
      required_artifacts: ["kernel.elf"],
    }, {
      id: "verify-syscall-dispatch",
      description: "syscalls dispatch through the kernel table",
      related_specs: ["kernel/syscall.dispatch"],
      required_tests: ["echo_uses_write", "forktest_uses_wait"],
      required_artifacts: ["qemu_syscall.log"],
    }, {
      id: "verify-file-io",
      description: "file operations preserve visible user data",
      related_specs: ["kernel/fs.file_io"],
      required_tests: ["cat_reads_file"],
      required_artifacts: ["qemu_fs.log"],
    }]);
    expect(surfaces).toEqual([{
      module: "kernel/boot",
      tests: [
        { id: "boot_banner_printable", description: "banner appears" },
        { id: "shell_boots" },
      ],
      source: "spec/modules/kernel/boot/tests.yaml",
    }, {
      module: "kernel/fs",
      tests: [
        { id: "cat_reads_file", description: "cat prints file contents" },
      ],
      source: "spec/modules/kernel/fs/tests.yaml",
    }, {
      module: "kernel/memory",
      tests: [
        { id: "kalloc_alignment", description: "allocated pages are aligned" },
        { id: "kalloc_kfree_cycle" },
      ],
      source: "spec/modules/kernel/memory/tests.yaml",
    }, {
      module: "kernel/syscall",
      tests: [
        { id: "echo_uses_write", description: "echo reaches write syscall" },
        { id: "forktest_uses_wait" },
      ],
      source: "spec/modules/kernel/syscall/tests.yaml",
    }]);
  });

  test("builds target coverage hints from public requirements and module tests", async () => {
    const projectRoot = makeTraceProject();
    const input = await buildTraceValidationInput({
      projectRoot,
      target: "full-syscall",
      recentEvidence: [],
    });

    expect(input.coverageHints).toEqual(buildTraceCoverageHints(input.publicRequirements, input.moduleTests));
    expect(input.coverageHints.map((item) => item.module)).toEqual([
      "kernel/boot",
      "kernel/fs",
      "kernel/memory",
      "kernel/syscall",
    ]);
    expect(input.coverageHints.find((item) => item.module === "kernel/syscall")).toEqual({
      module: "kernel/syscall",
      requirement_ids: ["verify-syscall-dispatch"],
      required_tests: ["echo_uses_write", "forktest_uses_wait"],
      related_specs: ["kernel/syscall.dispatch"],
      source: "spec/modules/kernel/syscall/tests.yaml",
    });
  });

  test("filters trace validation input to a requested module target", async () => {
    const projectRoot = makeTraceProject();
    const input = await buildTraceValidationInput({
      projectRoot,
      target: "kernel/memory",
      recentEvidence: [],
    });

    expect(input.publicRequirements.map((item) => item.id)).toEqual(["verify-page-allocator"]);
    expect(input.moduleTests.map((item) => item.module)).toEqual(["kernel/memory"]);
    expect(input.coverageHints).toEqual([{
      module: "kernel/memory",
      requirement_ids: ["verify-page-allocator"],
      required_tests: ["kalloc_alignment", "kalloc_kfree_cycle"],
      related_specs: ["kernel/memory.kalloc", "kernel/memory.kfree"],
      source: "spec/modules/kernel/memory/tests.yaml",
    }]);

    expect(filterPublicRequirementsForTarget("full-syscall", input.publicRequirements)).toEqual(input.publicRequirements);
    expect(filterModuleTestsForTarget("kernel/memory", input.moduleTests, input.publicRequirements)).toEqual(input.moduleTests);
  });

  test("validates agent plans, instrumentation paths, and trace lines", () => {
    const plan = parseTraceValidationPlan(JSON.stringify({
      instrumentation_patch: makeInstrumentationPatch(),
      trace_format: { prefix: "VOS_TRACE " },
      cases: [{
        id: "boot",
        requirement_id: "verify-boot-banner",
        related_specs: ["kernel/boot.boot_banner"],
        stimulus: ["echo ok"],
        success_regex: "TRACE_OK",
        expected_trace_events: ["boot"],
      }],
    }));

    expect(plan.cases[0]?.stdin).toBe("echo ok\n");
    expect(validateInstrumentationPatch(plan.instrumentation_patch)).toEqual({ ok: true });
    expect(validateInstrumentationPatch([
      "diff --git a/spec/verification/public-matrix.yaml b/spec/verification/public-matrix.yaml",
      "--- a/spec/verification/public-matrix.yaml",
      "+++ b/spec/verification/public-matrix.yaml",
      "@@ -1 +1 @@",
      "-stage: old",
      "+stage: new",
      "",
    ].join("\n"))).toEqual({
      ok: false,
      reason: "instrumentation patch touches rejected path: spec/verification/public-matrix.yaml",
    });
    expect(parseVosTraceLines([
      "noise",
      "VOS_TRACE {\"event\":\"boot\",\"pid\":1}",
      "VOS_TRACE not-json",
      "",
    ].join("\n"))).toEqual([
      { event: "boot", pid: 1 },
      { raw: "not-json", parse_error: expect.any(String) },
    ]);
  });

  test("rejects invalid agent trace validation output", () => {
    expect(() => parseTraceValidationPlan("not json")).toThrow(/not JSON/);
    expect(() => parseTraceValidationPlan(JSON.stringify({
      instrumentation_patch: "",
      trace_format: { prefix: "VOS_TRACE " },
      cases: [],
    }))).toThrow(/at least one case/);
    expect(() => parseTraceValidationPlan(JSON.stringify({
      instrumentation_patch: "",
      trace_format: { prefix: "VOS_TRACE " },
      cases: [{
        id: "trace-only-success",
        success_regex: "VOS_TRACE.*boot",
        related_specs: [],
        expected_trace_events: ["boot"],
      }],
    }))).toThrow(/success_regex must validate non-trace serial output/);
  });

  test("runs verify trace in a temporary worktree with per-case evidence", async () => {
    const projectRoot = makeTraceProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "validate-generated"],
      args: [],
    });
    let captured: HeadlessAgentOptions | undefined;
    const runner = async (options: HeadlessAgentOptions) => {
      captured = options;
      return {
        content: JSON.stringify({
          instrumentation_patch: makeInstrumentationPatch(),
          trace_format: { prefix: "VOS_TRACE " },
          cases: [{
            id: "boot-case",
            requirement_id: "verify-boot-banner",
            related_specs: ["kernel/boot.boot_banner"],
            stdin: "echo trace\n",
            success_regex: "TRACE_OK",
            failure_regex: "panic",
            expected_trace_events: ["boot"],
          }, {
            id: "shell-case",
            requirement_id: "verify-boot-banner",
            related_specs: ["user/programs.generate_sh_c"],
            stdin: "echo shell\n",
            success_regex: "SHELL_OK",
            expected_trace_events: ["shell"],
          }],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "verify",
      scope: "trace",
      target: "full-syscall",
      dryRun: false,
      patchFile: undefined,
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.prompt).toContain("verify-boot-banner");
    expect(captured?.prompt).toContain("coverageHints");
    expect(captured?.prompt).toContain("If target names a specific module or requirement");
    expect(captured?.prompt).toContain("do not select unrelated public requirements");
    expect(captured?.prompt).toContain("kernel/syscall");
    expect(captured?.prompt).toContain("kernel/fs");
    expect(captured?.prompt).toContain("include at least min(N, 6) validation cases");
    expect(captured?.prompt).toContain("Prefer one high-signal QEMU case per coverageHints module");
    expect(captured?.prompt).toContain("Coverage is measured by validation cases and mapped requirements");
    expect(captured?.prompt).toContain("aim for at most 3 touched files and at most 4 hunks");
    expect(captured?.prompt).toContain("projectTree");
    expect(captured?.prompt).toContain("toolchain");
    expect(captured?.prompt).toContain("kernel/probe.c");
    expect(captured?.prompt).not.toContain("For this MVP trace validation pass, choose exactly 1 high-signal boot smoke case.");
    expect(captured?.prompt).not.toContain("Prefer 1 to 2 high-signal cases");
    expect(captured?.prompt).not.toContain("Modify only kernel/main.c unless the target cannot boot without another file.");
    expect(readFileSync(join(projectRoot, "kernel", "probe.c"), "utf8")).toBe("int probe = 0;\n");
    expect(existsSync(join(projectRoot, ".vos", "worktrees", evidence.run_id))).toBe(false);
    expect(result.details.caseCount).toBe(2);
    expect(result.details.passedCount).toBe(2);
    const summaryPath = join(projectRoot, result.details.summary as string);
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.cases.map((item: { id: string }) => item.id)).toEqual(["boot-case", "shell-case"]);
    const traceLog = join(projectRoot, ".vos", "runs", evidence.run_id, "artifacts", "trace-validation", "boot-case", "trace.jsonl");
    expect(readFileSync(traceLog, "utf8")).toContain("\"event\":\"boot\"");
  });

  test("re-prompts the agent when generated instrumentation patch fails validation", async () => {
    const projectRoot = makeTraceProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify", "trace"],
      args: [],
    });
    const prompts: string[] = [];
    const runner = async (options: HeadlessAgentOptions) => {
      prompts.push(options.prompt);
      if (prompts.length === 1) {
        return {
          content: JSON.stringify({
            instrumentation_patch: [
              "diff --git a/kernel/probe.c b/kernel/probe.c",
              "--- a/kernel/probe.c",
              "+++ b/kernel/probe.c",
              "@@ -1 +1 @@",
              "-int missing = 0;",
              "+int probe = 1;",
              "",
            ].join("\n"),
            trace_format: { prefix: "VOS_TRACE " },
            cases: [{
              id: "boot-case",
              requirement_id: "verify-boot-banner",
              related_specs: ["kernel/boot.boot_banner"],
              stdin: "",
              success_regex: "TRACE_OK",
              expected_trace_events: ["boot"],
            }],
          }),
          events: [],
        };
      }
      return {
        content: JSON.stringify({
          instrumentation_patch: makeInstrumentationPatch(),
          trace_format: { prefix: "VOS_TRACE " },
          cases: [{
            id: "boot-case",
            requirement_id: "verify-boot-banner",
            related_specs: ["kernel/boot.boot_banner"],
            stdin: "",
            success_regex: "TRACE_OK",
            expected_trace_events: ["boot"],
          }],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "verify",
      scope: "trace",
      target: "full-syscall",
      dryRun: false,
      patchFile: undefined,
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("PREVIOUS OUTPUT FAILED MACHINE VALIDATION");
    expect(prompts[1]).toContain("patch does not apply");
    expect(result.details.agentAttempts).toBe(2);
  });

  test("repair prompt preserves a built patch and asks for case-only fixes", async () => {
    const projectRoot = makeTraceProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify", "trace"],
      args: [],
    });
    const prompts: string[] = [];
    const runner = async (options: HeadlessAgentOptions) => {
      prompts.push(options.prompt);
      return {
        content: JSON.stringify({
          instrumentation_patch: makeInstrumentationPatch(),
          trace_format: { prefix: "VOS_TRACE " },
          cases: [{
            id: "boot-case",
            requirement_id: "verify-boot-banner",
            related_specs: ["kernel/boot.boot_banner"],
            stdin: "",
            success_regex: "TRACE_OK",
            expected_trace_events: prompts.length === 1 ? ["missing_event"] : ["boot"],
          }],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "verify",
      scope: "trace",
      target: "full-syscall",
      dryRun: false,
      patchFile: undefined,
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Reuse the previous instrumentation_patch byte-for-byte");
    expect(prompts[1]).toContain("prefer editing cases only");
    expect(prompts[1]).toContain("expected_trace_events is usually too broad");
    expect(result.details.agentAttempts).toBe(2);
  });

  test("blocks dirty source worktrees before creating an instrumentation worktree", async () => {
    const projectRoot = makeTraceProject();
    writeFileSync(join(projectRoot, "dirty.txt"), "dirty\n");
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "validate-generated"],
      args: [],
    });
    const runner = async () => ({
      content: JSON.stringify({
        instrumentation_patch: "",
        trace_format: { prefix: "VOS_TRACE " },
        cases: [{ id: "boot", success_regex: "ok", related_specs: [], expected_trace_events: [] }],
      }),
      events: [],
    });

    await expect(executeCommand({
      kind: "verify",
      scope: "trace",
      target: "full-syscall",
      dryRun: false,
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    })).rejects.toThrow(/requires a clean git worktree/);
  });
});

function makeTraceProject(): string {
  const root = join(tmpdir(), `vos-trace-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "kernel"), { recursive: true });
  mkdirSync(join(root, "spec", "verification"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "boot"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "fs"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "memory"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "syscall"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), [
    ".vos/runs/",
    ".vos/worktrees/",
    "build/",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "project.yaml"), "project_id: trace-test\nspec_root: spec\ncurrent_stage: full-syscall\n");
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_paths:",
    "  - kernel",
    "  - user",
    "  - mkfs",
    "  - Makefile",
    "  - .vos/toolchain.json",
    "allowed_commands:",
    "  - build",
    "  - run qemu",
    "",
  ].join("\n"));
  writeFileSync(join(root, "kernel", "probe.c"), "int probe = 0;\n");
  writeFileSync(join(root, "Makefile"), "all:\n\tmkdir -p build\n\tprintf kernel > build/kernel.bin\n");
  writeFileSync(join(root, "fake-qemu.sh"), [
    "#!/usr/bin/env sh",
    "cat >/dev/null",
    "printf 'booting\\n'",
    "printf 'VOS_TRACE {\"event\":\"boot\",\"case\":\"boot-case\"}\\n'",
    "printf 'TRACE_OK\\n'",
    "printf 'VOS_TRACE {\"event\":\"shell\",\"case\":\"shell-case\"}\\n'",
    "printf 'SHELL_OK\\n'",
    "",
  ].join("\n"));
  chmodSync(join(root, "fake-qemu.sh"), 0o755);
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
    files: ["Makefile"],
    build: {
      commands: ["make all"],
      artifacts: ["build/kernel.bin"],
    },
    run: {
      command: "./fake-qemu.sh",
      args: [],
      artifact: "build/kernel.bin",
      timeout_ms: 1000,
    },
  }, null, 2));
  writeFileSync(join(root, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n");
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "build:",
    "  allowed_output_path:",
    "    - Makefile",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "verification", "public-matrix.yaml"), [
    "public_requirements:",
    "  - id: verify-boot-banner",
    "    description: boot reaches shell",
    "    related_specs:",
    "      - module: kernel/boot",
    "        operation: boot_banner",
    "    required_tests:",
    "      - boot_banner_printable",
    "      - shell_boots",
    "    required_artifacts:",
    "      - qemu_boot.log",
    "  - id: verify-page-allocator",
    "    description: physical page allocator cycles pages",
    "    related_specs:",
    "      - module: kernel/memory",
    "        operation: kalloc",
    "      - module: kernel/memory",
    "        operation: kfree",
    "    required_tests:",
    "      - kalloc_alignment",
    "      - kalloc_kfree_cycle",
    "    required_artifacts:",
    "      - kernel.elf",
    "  - id: verify-syscall-dispatch",
    "    description: syscalls dispatch through the kernel table",
    "    related_specs:",
    "      - module: kernel/syscall",
    "        operation: dispatch",
    "    required_tests:",
    "      - echo_uses_write",
    "      - forktest_uses_wait",
    "    required_artifacts:",
    "      - qemu_syscall.log",
    "  - id: verify-file-io",
    "    description: file operations preserve visible user data",
    "    related_specs:",
    "      - module: kernel/fs",
    "        operation: file_io",
    "    required_tests:",
    "      - cat_reads_file",
    "    required_artifacts:",
    "      - qemu_fs.log",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "boot", "tests.yaml"), [
    "module: kernel/boot",
    "test_surfaces:",
    "  - boot_banner_printable",
    "  - shell_boots",
    "required_tests:",
    "  - test: boot_banner_printable",
    "    description: banner appears",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "fs", "tests.yaml"), [
    "module: kernel/fs",
    "test_surfaces:",
    "  - cat_reads_file",
    "required_tests:",
    "  - test: cat_reads_file",
    "    description: cat prints file contents",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "tests.yaml"), [
    "module: kernel/memory",
    "test_surfaces:",
    "  - kalloc_alignment",
    "  - kalloc_kfree_cycle",
    "required_tests:",
    "  - test: kalloc_alignment",
    "    description: allocated pages are aligned",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "syscall", "tests.yaml"), [
    "module: kernel/syscall",
    "test_surfaces:",
    "  - echo_uses_write",
    "  - forktest_uses_wait",
    "required_tests:",
    "  - test: echo_uses_write",
    "    description: echo reaches write syscall",
    "",
  ].join("\n"));

  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "trace@example.com"]);
  runGit(root, ["config", "user.name", "Trace Test"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "initial trace fixture"]);
  return root;
}

function makeInstrumentationPatch(): string {
  return [
    "diff --git a/kernel/probe.c b/kernel/probe.c",
    "--- a/kernel/probe.c",
    "+++ b/kernel/probe.c",
    "@@ -1 +1 @@",
    "-int probe = 0;",
    "+int probe = 1;",
    "",
  ].join("\n");
}

function runGit(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}
