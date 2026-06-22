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

  test("verify patch does not require a public matrix", async () => {
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

    expect(verify.status).toBe("ok");
    expect(verify.steps).toEqual([{ name: "build", status: "ok" }]);
    expect(verify.requiredChecks).toBeUndefined();
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
