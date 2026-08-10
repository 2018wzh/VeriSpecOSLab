import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QemuRunner } from "../src/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("student QEMU runner", () => {
  test("the xv6 reference uses only the student v2 execution projection", () => {
    const repositoryRoot = join(import.meta.dir, "../../../..");
    const xv6Root = join(repositoryRoot, "examples", "xv6-spec");
    const manifest = readFileSync(join(xv6Root, "vos.yaml"), "utf8");
    const design = readFileSync(join(xv6Root, "spec", "design.yaml"), "utf8");
    const gitignore = readFileSync(join(xv6Root, ".gitignore"), "utf8");
    expect(manifest).toContain("version: vos.project.v1");
    expect(manifest).not.toContain("knowledge:");
    expect(design).toContain("system:");
    expect(design).toContain("composition_invariants:");
    for (const relativePath of [
      "spec/modules/toolchain.yaml",
      "spec/interfaces/kernel-console.yaml",
      "spec/goals/xv6-core.yaml",
      "spec/patches/lab5-process-syscall.yaml",
    ]) {
      expect(existsSync(join(xv6Root, relativePath))).toBe(true);
    }
    for (const ignoredPath of [".vos/", ".env", "build/", "fs.img"]) {
      expect(gitignore).toContain(ignoredPath);
    }
  });

  test("accepts a serial success marker and stops the guest", async () => {
    const root = makeProject({
      script: "process.stdout.write('BOOT_OK\\n'); await Bun.sleep(10_000);",
      successPattern: "BOOT_OK",
      failurePattern: "panic",
      timeout: 2_000,
    });
    const result = await new QemuRunner(root).run();
    expect(result.status).toBe("passed");
    expect(result.stdout).toContain("BOOT_OK");
    expect(result.oracle).toEqual({ outcome: "success", pattern: "BOOT_OK" });
    expect(result.durationMs).toBeLessThan(2_000);
  });

  test("fails immediately when serial output matches the panic oracle", async () => {
    const root = makeProject({
      script: "process.stdout.write('panic: boot failed\\n'); await Bun.sleep(10_000);",
      successPattern: "BOOT_OK",
      failurePattern: "panic(?:[: ]|$)",
      timeout: 2_000,
    });
    const result = await new QemuRunner(root).run();
    expect(result.status).toBe("failed");
    expect(result.oracle).toEqual({ outcome: "failure", pattern: "panic(?:[: ]|$)" });
    expect(result.durationMs).toBeLessThan(2_000);
  });

  test("reports a timeout when no serial oracle completes", async () => {
    const root = makeProject({
      script: "await Bun.sleep(10_000);",
      successPattern: "BOOT_OK",
      failurePattern: "panic",
      timeout: 50,
    });
    const result = await new QemuRunner(root).run();
    expect(result.status).toBe("timed_out");
    expect(result.oracle).toEqual({ outcome: "missing", pattern: "BOOT_OK" });
  });
});

function makeProject(params: {
  script: string;
  successPattern: string;
  failurePattern: string;
  timeout: number;
}): string {
  const root = mkdtempSync(join(tmpdir(), "vos-student-qemu-"));
  roots.push(root);
  writeFileSync(join(root, "vos.yaml"), [
    "version: vos.project.v1",
    `build: { program: ${JSON.stringify(process.execPath)}, args: [--version], cwd: ., env: [], timeout: 1000, artifacts: [] }`,
    "runners:",
    "  qemu:",
    `    program: ${JSON.stringify(process.execPath)}`,
    `    args: [-e, ${JSON.stringify(params.script)}]`,
    "    cwd: .",
    "    env: []",
    `    timeout: ${params.timeout}`,
    "    artifacts: []",
    `    success_pattern: ${JSON.stringify(params.successPattern)}`,
    `    failure_pattern: ${JSON.stringify(params.failurePattern)}`,
    "checks: {}",
    "",
  ].join("\n"));
  git(root, ["init"]);
  git(root, ["add", "vos.yaml"]);
  git(root, ["-c", "user.name=VOS Runner Test", "-c", "user.email=runner@example.invalid", "commit", "-m", "fixture"]);
  return root;
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
}
