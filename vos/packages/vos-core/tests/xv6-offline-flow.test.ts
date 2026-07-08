import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceWriter } from "../src/evidence/index.ts";
import { executeCommand } from "../src/main.ts";
import { runBuildCommand } from "../src/runtime/build.ts";
import { parseQmpMessages, runQemuCommand } from "../src/runtime/qemu.ts";
import { runVerifyCommand } from "../src/runtime/verify.ts";
import type { AgentTaskRequest } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function manifestV2(options: {
  buildCommands?: unknown[];
  buildArtifacts?: string[];
  suites?: unknown[];
  runProfiles?: unknown[];
  runCases?: unknown[];
  verify?: unknown;
} = {}) {
  return {
    manifest_version: 2,
    files: ["Makefile"],
    environment: { required_tools: [{ name: "bun", command: process.execPath, version_args: ["--version"], version_constraint: ">=0", kind: "runtime" }] },
    build: {
      variants: [{
        id: "baseline",
        commands: options.buildCommands ?? [{ name: "noop", command: okCommand() }],
        artifacts: options.buildArtifacts ?? [],
      }],
    },
    run: {
      profiles: options.runProfiles ?? [{
        id: "default",
        command: process.execPath,
        args: ["-e", "process.stdout.write('XV6_BOOT_OK')", "-kernel", "build/kernel.bin"],
        artifacts: [],
        timeout_ms: 1000,
      }],
      cases: options.runCases ?? [{
        id: "smoke",
        profile: "default",
        success_regex: "XV6_BOOT_OK",
        timeout_ms: 1000,
      }],
    },
    test: {
      suites: options.suites ?? [],
    },
    verify: options.verify,
  };
}

function jsCommand(code: string): string[] {
  return [process.execPath, "-e", code];
}

function okCommand(): string[] {
  return jsCommand("");
}

function failCommand(): string[] {
  return jsCommand("process.exit(1)");
}

function appendLogCommand(line: string): string[] {
  return jsCommand(`const { appendFileSync } = await import("node:fs"); appendFileSync("test.log", ${JSON.stringify(`${line}\n`)});`);
}

function writeBuildCommand(): string[] {
  return jsCommand([
    "const { appendFileSync, mkdirSync, writeFileSync } = await import('node:fs');",
    "mkdirSync('build', { recursive: true });",
    "writeFileSync('build/kernel.bin', 'kernel');",
    "appendFileSync('build.log', 'build\\n');",
  ].join(""));
}

function writeCwdCommand(): string[] {
  return jsCommand("const { writeFileSync } = await import('node:fs'); writeFileSync('cwd.txt', process.cwd());");
}

describe("xv6-spec offline runtime flow", () => {
  test("repository fixture tracks VOS agent and KB configuration", () => {
    const repoRoot = join(import.meta.dir, "../../../..");
    const xv6Root = join(repoRoot, "examples", "xv6-spec");
    const policy = readFileSync(join(xv6Root, ".vos", "policy.yaml"), "utf8");
    const config = readFileSync(join(xv6Root, ".vos", "config.toml"), "utf8");
    const gitignore = readFileSync(join(xv6Root, ".gitignore"), "utf8");

    for (const command of [
      "agent ask",
      "agent debug",
      "agent review-spec",
      "agent validate-generated",
      "kb add",
      "kb search",
      "kb export-manifest",
      "kb import-manifest",
    ]) {
      expect(policy).toContain(`  - ${command}`);
    }
    for (const allowedPath of ["spec", "kernel", "user", "mkfs", "tests", ".vos", "Makefile", "AGENTS.md"]) {
      expect(policy).toContain(`  - ${allowedPath}`);
    }

    expect(config).toContain("provider = \"openai-compatible\"");
    expect(config).toContain("model = \"compat:ecnu-max\"");
    expect(config).toContain("model = \"ecnu-embedding-small\"");
    expect(config).toContain("env = \"ECNU_API_KEY\"");

    for (const trackedConfig of [
      "!.vos/project.yaml",
      "!.vos/policy.yaml",
      "!.vos/config.toml",
      "!.vos/toolchain.json",
    ]) {
      expect(gitignore).toContain(trackedConfig);
    }
  });

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
    expect(build.output).toContain("build/kernel.bin");

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
      "spec bundle",
      "build",
      "public tests",
      "required artifacts",
      "public summary",
    ]);
    expect(verify.requiredChecks?.map((check) => check.id)).toEqual([
      "verify-boot-banner",
      "verify-sys-write",
    ]);
    expect(verify.requiredChecks?.[0]?.tests?.map((test) => test.id)).toEqual(["bootstrap_banner_not_null"]);
    expect(verify.publicSummaryPath).toBe("artifacts/verify/public-summary.json");
  });

  test("public verify rejects missing matrix, missing suites, failed suites, and missing artifacts", async () => {
    let projectRoot = makeXv6Fixture({ publicMatrix: false });
    let evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-public-no-matrix"],
      args: [],
    });
    let verify = await runVerifyCommand({ projectRoot, evidence, scope: "public", dryRun: true });
    expect(verify.status).toBe("validation_failed");
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "public-matrix", status: "validation_failed" }));

    projectRoot = makeXv6Fixture({ publicTestSuites: false });
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-public-missing-suite"],
      args: [],
    });
    verify = await runVerifyCommand({ projectRoot, evidence, scope: "public", dryRun: true });
    expect(verify.status).toBe("validation_failed");
    expect(verify.requiredChecks?.[0]?.tests).toContainEqual(expect.objectContaining({
      id: "bootstrap_banner_not_null",
      status: "validation_failed",
    }));

    projectRoot = makeXv6Fixture({ failingPublicSuite: "sys_write_basic" });
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-public-failed-suite"],
      args: [],
    });
    verify = await runVerifyCommand({ projectRoot, evidence, scope: "public", dryRun: false });
    expect(verify.status).toBe("failed");
    expect(verify.requiredChecks?.find((check) => check.id === "verify-sys-write")?.tests)
      .toContainEqual(expect.objectContaining({ id: "sys_write_basic", status: "failed" }));

    projectRoot = makeXv6Fixture({ publicArtifacts: false });
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-public-missing-artifact"],
      args: [],
    });
    verify = await runVerifyCommand({ projectRoot, evidence, scope: "public", dryRun: false });
    expect(verify.status).toBe("failed");
    expect(verify.requiredChecks?.[0]?.artifacts).toContainEqual(expect.objectContaining({
      path: "build/qemu_boot.log",
      status: "failed",
    }));
  });

  test("execute verify exposes public requirement details", async () => {
    const projectRoot = makeXv6Fixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify", "public"],
      args: [],
    });

    const result = await executeCommand({
      kind: "verify",
      scope: "public",
      dryRun: true,
    }, {
      projectRoot,
      global: { projectRoot, json: true },
      evidence,
    });

    expect(result.status).toBe("ok");
    expect(Array.isArray(result.details.requiredChecks)).toBe(true);
    expect(result.details.publicSummaryPath).toBe("artifacts/verify/public-summary.json");
  });

  test("stage show does not report fallback source", async () => {
    const projectRoot = makeVerifyMappingFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["stage", "show"],
      args: [],
    });

    const result = await executeCommand({
      kind: "stage_show",
    }, {
      projectRoot,
      global: { projectRoot, json: true },
      evidence,
    });

    expect(result.status).toBe("passed");
    expect(result.details.current_stage).toBe("memory");
    expect(result.details).not.toHaveProperty("fallback");
  });

  test("treats ready signal as success even when QEMU is later timed out", async () => {
    const projectRoot = makeXv6Fixture();
    const fakeQemu = join(projectRoot, "fake-qemu.mjs");
    mkdirSync(join(projectRoot, "build"), { recursive: true });
    writeFileSync(join(projectRoot, "build", "kernel.bin"), "fake kernel\n");
    writeFileSync(fakeQemu, [
      "process.stdout.write('booting\\nXV6_BOOT_OK\\n');",
      "setTimeout(() => {}, 2000);",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      buildCommands: [{ name: "build", command: writeBuildCommand() }],
      buildArtifacts: ["build/kernel.bin"],
      runProfiles: [{ id: "default", command: process.execPath, args: [fakeQemu, "-kernel", "build/kernel.bin"], artifacts: ["build/kernel.bin"], timeout_ms: 50 }],
      runCases: [{ id: "smoke", profile: "default", success_regex: "XV6_BOOT_OK", timeout_ms: 50 }],
    }), null, 2));
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

  test("runs selected qemu profile case with stdin oracle and required artifacts", async () => {
    const projectRoot = makeXv6Fixture();
    const fakeQemu = join(projectRoot, "fake-case-qemu.mjs");
    mkdirSync(join(projectRoot, "build"), { recursive: true });
    writeFileSync(join(projectRoot, "build", "kernel.bin"), "fake kernel\n");
    writeFileSync(fakeQemu, [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "process.stdout.write('READY\\n');",
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk.toString(); });",
      "process.stdin.on('end', () => {",
      "  const line = input.split(/\\r?\\n/)[0] ?? '';",
      "  process.stdout.write(`got:${line}\\n`);",
      "  mkdirSync('build', { recursive: true });",
      "  writeFileSync('build/case.ok', 'done');",
      "});",
      "process.stdin.resume();",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      buildCommands: [{ name: "build", command: writeBuildCommand() }],
      buildArtifacts: ["build/kernel.bin"],
      runProfiles: [{
          id: "syscall",
          command: process.execPath,
          args: [fakeQemu],
          artifacts: ["build/kernel.bin"],
          timeout_ms: 1000,
          serial: true,
        }],
      runCases: [{
          id: "write-smoke",
          profile: "syscall",
          stdin_after: { pattern: "READY", text: "hello\n" },
          success_regex: "got:hello",
          failure_regex: "panic",
          exit_code: 0,
          required_artifacts: ["build/case.ok"],
        }],
    }), null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["profile-case"],
      args: [],
    });

    const run = await runQemuCommand({
      projectRoot,
      evidence,
      profileId: "syscall",
      caseId: "write-smoke",
      dryRun: false,
    });

    expect(run.status).toBe("ok");
    expect(run.profileId).toBe("syscall");
    expect(run.caseId).toBe("write-smoke");
    expect(run.readyDetected).toBe(true);
    const result = JSON.parse(readFileSync(join(projectRoot, ".vos", "runs", evidence.run_id, "artifacts", "run", "write-smoke", "result.json"), "utf8"));
    expect(result.oracle.success_matched).toBe(true);
    expect(result.oracle.required_artifacts_present).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "runs", evidence.run_id, "artifacts", "qemu.log"))).toBe(false);
    expect(existsSync(join(projectRoot, ".vos", "runs", evidence.run_id, "smoke-result.json"))).toBe(false);
    expect("smokeResultPath" in run).toBe(false);
  });

  test("parses QMP greeting responses and events", () => {
    const messages = parseQmpMessages([
      JSON.stringify({ QMP: { version: { qemu: { major: 9, minor: 0, micro: 0 } }, capabilities: [] } }),
      JSON.stringify({ return: {} }),
      JSON.stringify({ event: "SHUTDOWN", timestamp: { seconds: 1, microseconds: 2 }, data: { guest: true } }),
      "",
    ].join("\r\n"));

    expect(messages[0].QMP).toBeTruthy();
    expect(messages.map((message) => message.event).filter(Boolean)).toEqual(["SHUTDOWN"]);
  });

  test("writes adapter contract when qemu profile enables QMP HMP and GDB", async () => {
    const projectRoot = makeXv6Fixture();
    const fakeQemu = join(projectRoot, "fake-qmp-qemu.mjs");
    mkdirSync(join(projectRoot, "build"), { recursive: true });
    writeFileSync(join(projectRoot, "build", "kernel.bin"), "fake kernel\n");
    writeFileSync(fakeQemu, "process.stdout.write('boot ok\\n');\n");
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      runProfiles: [{
          id: "debug",
          command: process.execPath,
          args: [fakeQemu],
          artifacts: ["build/kernel.bin"],
          qmp: { enabled: true, port: 26001 },
          hmp: { enabled: true },
          gdb: { enabled: true, port: 26000 },
        }],
      runCases: [{ id: "shutdown", profile: "debug", success_regex: "boot ok" }],
    }), null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["qmp-case"],
      args: [],
    });

    const run = await runQemuCommand({
      projectRoot,
      evidence,
      profileId: "debug",
      caseId: "shutdown",
      dryRun: true,
    });

    expect(run.status).toBe("ok");
    const adapter = JSON.parse(readFileSync(join(projectRoot, ".vos", "runs", evidence.run_id, "artifacts", "run", "shutdown", "adapter-contract.json"), "utf8"));
    expect(adapter.qmp_endpoint).toBe("tcp:127.0.0.1:26001");
    expect(adapter.hmp_endpoint).toBeTruthy();
    expect(adapter.gdb_endpoint).toBe("tcp:127.0.0.1:26000");
    expect(adapter.qemu_args.join(" ")).toContain("-qmp");
  });

  test("honors object build command cwd and timeout metadata", async () => {
    const projectRoot = makeXv6Fixture();
    mkdirSync(join(projectRoot, "subdir"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      buildCommands: [{
          name: "record-cwd",
          command: writeCwdCommand(),
          cwd: "subdir",
          timeout_ms: 1000,
        }],
    }), null, 2));
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
    expect(readFileSync(join(projectRoot, "subdir", "cwd.txt"), "utf8").trim().replace(/\\/g, "/").endsWith("/subdir"))
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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);

  test("spec patch apply writes cache, projections, applied state, and runs verification", async () => {
    const { projectRoot, patchRef } = await makePatchVerifyFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["spec", "patch", "apply", patchRef],
      args: [],
    });

    const result = await executeCommand({
      kind: "spec_patch_apply",
      patchPath: patchRef,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("passed");
    expect(existsSync(join(projectRoot, ".vos", "cache", "normalized", "bundle.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "patch-001", "impact.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "patch-001", "verification-plan.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "patch-001", "status.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "applied.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "projections", "student.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "projections", "agent.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "cache", "projections", "staff.json"))).toBe(true);
    expect(readFileSync(join(projectRoot, "test.log"), "utf8")).toContain("kalloc_alignment");
  }, 20_000);

  test("spec patch apply rejects incomplete impact metadata without writing applied state", async () => {
    const { projectRoot, patchRef } = await makePatchVerifyFixture({ omitImpactMetadata: true });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["spec", "patch", "apply", patchRef],
      args: [],
    });

    const result = await executeCommand({
      kind: "spec_patch_apply",
      patchPath: patchRef,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("validation_failed");
    expect(JSON.stringify(result.details)).toContain("patch.impact_unlisted_module");
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "applied.json"))).toBe(false);
  }, 20_000);

  test("spec patch lint does not write applied state", async () => {
    const { projectRoot, patchRef } = await makePatchVerifyFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["spec", "patch", "lint", patchRef],
      args: [],
    });

    const result = await executeCommand({
      kind: "spec_patch_lint",
      patchPath: patchRef,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("passed");
    expect(existsSync(join(projectRoot, ".vos", "cache", "patches", "applied.json"))).toBe(false);
  }, 20_000);

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
    const staffPolicy = join(tmpdir(), `vos-staff-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
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
    let projectRoot = makeVerifyMappingFixture({ visibility: "staff-only" });
    let evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full-missing-staff"],
      args: [],
    });

    let verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      visibilityScope: "staff-only",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "staff-policy-required", status: "validation_failed" }));

    projectRoot = makeVerifyMappingFixture({ invariantMapping: false, visibility: "staff-only" });
    const staffPolicyForFull = join(tmpdir(), `vos-staff-missing-map-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    tmpRoots.push(staffPolicyForFull);
    writeFileSync(staffPolicyForFull, JSON.stringify({ verify: { full: ["staff_full"] } }));
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full-missing-mapping"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      staffPolicy: staffPolicyForFull,
      visibilityScope: "staff-only",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.steps).toContainEqual(expect.objectContaining({ name: "invariant", status: "validation_failed" }));
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "freelist", status: "validation_failed" }));

    projectRoot = makeVerifyMappingFixture({ generatedObligations: false, visibility: "staff-only" });
    const staffPolicyForObligations = join(tmpdir(), `vos-staff-no-obligation-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    tmpRoots.push(staffPolicyForObligations);
    writeFileSync(staffPolicyForObligations, JSON.stringify({ verify: { full: ["staff_full"] } }));
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-full-missing-obligations"],
      args: [],
    });

    verify = await runVerifyCommand({
      projectRoot,
      evidence,
      scope: "full",
      dryRun: false,
      staffPolicy: staffPolicyForObligations,
      visibilityScope: "staff-only",
      behaviorTestRunner: fakeBehaviorTestRunner(),
    });

    expect(verify.status).toBe("validation_failed");
    expect(verify.steps).toContainEqual(expect.objectContaining({ name: "generated", status: "validation_failed" }));
    expect(verify.requiredChecks).toContainEqual(expect.objectContaining({ id: "generated-obligations-required", status: "validation_failed" }));

    projectRoot = makeVerifyMappingFixture({ invariantMapping: false });
    evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify-invariant-missing"],
      args: [],
    });

    verify = await runVerifyCommand({
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

    const externalPolicy = join(tmpdir(), `vos-staff-denied-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
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
  }, 20_000);

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

  test("doctor fails when toolchain manifest is missing", async () => {
    const projectRoot = makeXv6Fixture({ toolchainManifest: false });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["doctor"],
      args: [],
    });

    const result = await executeCommand({ kind: "doctor" }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("failed");
    expect(result.details.missing).toContain("toolchain-manifest");
    expect(result.details.suggested_next_commands).toContain("vos build generate");
  });

  test("doctor allows architecture-seed projects before a toolchain manifest exists", async () => {
    const projectRoot = makeXv6Fixture({ toolchainManifest: false });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: xv6-offline",
      "spec_root: spec",
      "current_stage: architecture-seed",
      "",
    ].join("\n"));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["doctor"],
      args: [],
    });

    const result = await executeCommand({ kind: "doctor" }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("passed");
    expect(result.details.missing).not.toContain("toolchain-manifest");
  });

  test("doctor reports missing required manifest tools", async () => {
    const projectRoot = makeXv6Fixture();
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify({
      ...manifestV2(),
      environment: {
        required_tools: [{
          name: "missing-tool",
          command: "vos-doctor-missing-tool",
          version_args: ["--version"],
          version_constraint: ">=0",
          kind: "utility",
        }],
      },
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["doctor"],
      args: [],
    });

    const result = await executeCommand({ kind: "doctor" }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("failed");
    expect(result.details.missing).toContain("missing-tool");
    expect(JSON.stringify(result.details.checks)).toContain("vos-doctor-missing-tool");
  });

  test("doctor checks manifest command entrypoints without failing on optional tools", async () => {
    const projectRoot = makeXv6Fixture();
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      buildCommands: [{ name: "noop", command: okCommand() }],
      suites: [{ name: "static", kind: "command", command: okCommand() }],
      runProfiles: [{
        id: "default",
        command: process.execPath,
        args: ["-e", ""],
        artifacts: [],
        timeout_ms: 1000,
      }],
    }), null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["doctor"],
      args: [],
    });

    const result = await executeCommand({ kind: "doctor" }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });
    const checks = result.details.checks as Array<{ name: string; category: string; required: boolean; ok: boolean }>;

    expect(result.status).toBe("passed");
    expect(checks).toContainEqual(expect.objectContaining({
      name: process.execPath,
      category: "toolchain-command",
      required: true,
      ok: true,
    }));
    expect(checks.filter((check) => check.category === "optional-tools").every((check) => check.required === false)).toBe(true);
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
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
      captured = options;
      const submitted = {
        task: "generate syscall build entrypoint",
        patch: makeAgentGeneratePatch(),
        bound_clauses: ["spec/stages/syscall.yaml"],
        changed_paths: ["Makefile", ".vos/toolchain.json"],
        changed_code_files: ["Makefile"],
        output_kind: "unified_diff",
        self_reported_risks: [],
      };
      return {
        content: "ignored",
        events: acceptedSubmitEvents("spec_compiler_output.v1", submitted),
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
    expect(captured?.task).toContain("syscall");
    expect(JSON.stringify(captured?.context)).toContain('"current_stage":"syscall"');
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("spec: syscall");
    expect(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8")).toContain("offline-build");
    expect(result.details.applyStatus).toBe("ok");
    expect(result.details.buildRequested).toBe(true);
    expect(result.details.runStatus).toBe("ok");
  });
});

function makeXv6Fixture(options: {
  publicMatrix?: boolean;
  publicTestSuites?: boolean;
  publicArtifacts?: boolean;
  failingPublicSuite?: string;
  toolchainManifest?: boolean;
  buildEntrypoint?: boolean;
} = {}): string {
  const root = join(tmpdir(), `vos-cli-xv6-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
      "    required_tests:",
      "      - bootstrap_banner_not_null",
      "    required_artifacts:",
      "      - build/qemu_boot.log",
      "  - id: verify-sys-write",
      "    required_tests:",
      "      - sys_write_basic",
      "    required_artifacts:",
      "      - build/kernel.elf",
      "",
    ].join("\n"));
  }
  if (options.publicArtifacts !== false) {
    mkdirSync(join(root, "build"), { recursive: true });
    writeFileSync(join(root, "build", "qemu_boot.log"), "XV6_BOOT_OK\n");
    writeFileSync(join(root, "build", "kernel.elf"), "fake elf\n");
  }
  if (options.toolchainManifest !== false) {
    const publicSuites = options.publicTestSuites === false
      ? []
      : ["bootstrap_banner_not_null", "sys_write_basic"].map((name) => ({
        name,
        kind: "command",
        command: options.failingPublicSuite === name ? failCommand() : okCommand(),
        related_specs: name === "sys_write_basic" ? ["kernel/syscall"] : ["kernel/boot"],
      }));
    writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
      buildCommands: [{ name: "build", command: writeBuildCommand() }],
      buildArtifacts: ["build/kernel.bin"],
      suites: publicSuites,
      runProfiles: [{
        id: "default",
        command: process.execPath,
        args: ["-e", "process.stdout.write('XV6_BOOT_OK')", "-machine", "virt", "-kernel", "build/kernel.bin"],
        artifacts: ["build/kernel.bin"],
        timeout_ms: 1000,
      }],
      runCases: [{ id: "smoke", profile: "default", success_regex: "XV6_BOOT_OK", timeout_ms: 1000 }],
    }), null, 2));
  }

  return root;
}

function makeVerifyMappingFixture(options: {
  invariantMapping?: boolean;
  generatedObligations?: boolean;
  visibility?: "public" | "agent-only" | "staff-only";
} = {}): string {
  const root = join(tmpdir(), `vos-cli-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
    `  generated: ${options.generatedObligations === false ? "[]" : "[kalloc_zeroed]"}`,
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
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
    buildCommands: [{ name: "noop", command: okCommand() }],
    suites: [
      { name: "bootstrap_banner_not_null", kind: "command", command: appendLogCommand("bootstrap_banner_not_null"), related_specs: ["kernel/memory"] },
      { name: "kalloc_alignment", kind: "command", command: appendLogCommand("kalloc_alignment"), related_specs: ["kernel/memory"] },
      { name: "kalloc_zeroed", kind: "command", command: appendLogCommand("kalloc_zeroed"), related_specs: ["kernel/memory"] },
      { name: "grind", kind: "command", command: appendLogCommand("grind"), related_specs: ["kernel/memory"] },
      { name: "staff_full", kind: "command", command: appendLogCommand("staff_full"), related_specs: ["kernel/memory"] },
    ],
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
  }), null, 2));

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
        command: jsCommand("process.stdout.write('BEHAVIOR_OK')"),
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
  const root = join(tmpdir(), `vos-cli-patch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify(manifestV2({
    buildCommands: [{ name: "build", command: writeBuildCommand() }],
    buildArtifacts: ["build/kernel.bin"],
    suites: [
      { name: "build_kernel", kind: "command", command: appendLogCommand("build_kernel"), related_specs: ["kernel/memory"] },
      { name: "kalloc_alignment", kind: "command", command: appendLogCommand("kalloc_alignment"), related_specs: ["kernel/memory"] },
    ],
  }), null, 2));

  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  const parent = git(root, ["rev-parse", "HEAD"]).trim();

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
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "patch\n\nSpec-Patch-ID: patch-001"]);
  const patchRef = git(root, ["rev-parse", "HEAD"]).trim();

  writeFileSync(join(root, "spec", "evolution", "patch-001.yaml"), [
    "id: patch-001",
    "stage: memory",
    "title: Patch 001",
    "reason: test",
    "kind: operation_change",
    `commit_sha: ${patchRef}`,
    `parent_sha: ${parent}`,
    "affected_specs:",
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
  return { projectRoot: root, patchRef };
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
  const bunPath = JSON.stringify(process.execPath);
  const buildCode = JSON.stringify("const { mkdirSync, writeFileSync } = await import('node:fs'); mkdirSync('build', { recursive: true }); writeFileSync('build/kernel.bin', 'kernel');");
  const runCode = JSON.stringify("process.stdout.write('XV6_BOOT_OK')");
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
    "@@ -0,0 +1,34 @@",
    "+{",
    "+  \"manifest_version\": 2,",
    "+  \"files\": [\"Makefile\"],",
    "+  \"environment\": {",
    `+    \"required_tools\": [{ \"name\": \"bun\", \"command\": ${bunPath}, \"version_args\": [\"--version\"], \"version_constraint\": \">=0\", \"kind\": \"runtime\" }]`,
    "+  },",
    "+  \"build\": {",
    "+    \"variants\": [{",
    "+      \"id\": \"baseline\",",
    "+      \"commands\": [{",
    "+        \"name\": \"offline-build\",",
    `+        \"command\": [${bunPath}, \"-e\", ${buildCode}]`,
    "+      }],",
    "+      \"artifacts\": [\"build/kernel.bin\"]",
    "+    }]",
    "+  },",
    "+  \"run\": {",
    "+    \"profiles\": [{",
    "+      \"id\": \"default\",",
    `+      \"command\": ${bunPath},`,
    `+      \"args\": [\"-e\", ${runCode}],`,
    "+      \"artifacts\": [\"Makefile\"],",
    "+      \"timeout_ms\": 1000",
    "+    }],",
    "+    \"cases\": [{",
    "+      \"id\": \"smoke\",",
    "+      \"profile\": \"default\",",
    "+      \"success_regex\": \"XV6_BOOT_OK\",",
    "+      \"timeout_ms\": 1000",
    "+    }]",
    "+  },",
    "+  \"test\": { \"suites\": [] }",
    "+}",
    "",
  ].join("\n");
}

function acceptedSubmitEvents(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    {
      type: "tool.call",
      name: "mcp__vos-progress__submit_result",
      id: "call_submit",
      arguments: JSON.stringify({ schema_id: schemaId, result }),
    },
    {
      type: "tool.result",
      name: "mcp__vos-progress__submit_result",
      id: "call_submit",
      content: JSON.stringify({
        type: "vos-result-submission",
        schema_id: schemaId,
        accepted: true,
      }),
    },
  ];
}
