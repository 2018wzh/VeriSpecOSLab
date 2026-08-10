import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "../src/cli.ts";

describe("student CLI contract", () => {
  test("parses the complete public command surface", () => {
    expect(parseArgs(["bun", "vos", "init"]).command).toEqual({ kind: "init" });
    expect(parseArgs(["bun", "vos", "doctor"]).command).toEqual({ kind: "doctor" });
    expect(parseArgs(["bun", "vos", "spec", "lint"]).command).toEqual({ kind: "spec_lint", target: undefined });
    expect(parseArgs(["bun", "vos", "spec", "lint", "kernel/memory"]).command).toEqual({ kind: "spec_lint", target: "kernel/memory" });
    expect(parseArgs(["bun", "vos", "build"]).command).toEqual({ kind: "build", dryRun: false });
    expect(parseArgs(["bun", "vos", "run", "qemu"]).command).toEqual({ kind: "run_qemu", dryRun: false });
    expect(parseArgs(["bun", "vos", "run", "hardware"]).command).toEqual({ kind: "run_hardware", dryRun: false });
    expect(parseArgs(["bun", "vos", "verify"]).command).toEqual({
      kind: "verify",
      scope: "public",
      target: undefined,
      dryRun: false,
      staffPolicy: undefined,
    });
    expect(parseArgs(["bun", "vos", "verify", "--hidden"]).command).toEqual({
      kind: "verify",
      scope: "public",
      target: undefined,
      dryRun: false,
      staffPolicy: undefined,
      hidden: true,
    });
    expect(parseArgs(["bun", "vos", "report"]).command).toEqual({ kind: "report_generate", final: false });
    expect(parseArgs(["bun", "vos", "submit"]).command).toEqual({ kind: "submit_pack" });
  });

  test("parses public Agent roles", () => {
    expect(parseArgs(["bun", "vos", "agent", "implement", "kernel/memory"]).command)
      .toEqual({ kind: "agent_implement", module: "kernel/memory" });
    expect(parseArgs(["bun", "vos", "agent", "debug"]).command)
      .toEqual({ kind: "agent_debug", keepWorktree: false });
    expect(parseArgs(["bun", "vos", "agent", "verify"]).command)
      .toEqual({ kind: "agent_verify" });
    expect(parseArgs(["bun", "vos", "agent", "ask", "What is Sv39?"]).command)
      .toEqual({ kind: "agent_ask", question: "What is Sv39?", interactive: false });
    expect(parseArgs(["bun", "vos", "agent", "ask"]).command)
      .toEqual({ kind: "agent_ask", question: undefined, interactive: true });
    expect(parseArgs(["bun", "vos", "agent", "review", "design", "-i"]).command)
      .toEqual({ kind: "agent_review", target: "design", display: true });
  });

  test("parses Agent provider configuration without reading secrets", () => {
    expect(parseArgs([
      "bun", "vos", "agent", "config",
      "--provider", "openai-compatible",
      "--model", "course-model",
      "--base-url", "https://provider.example/v1",
      "--auth-env", "COURSE_API_KEY",
      "--without-embedding",
    ]).command).toEqual({
      kind: "agent_config",
      provider: "openai-compatible",
      model: "course-model",
      baseUrl: "https://provider.example/v1",
      authEnv: "COURSE_API_KEY",
      embeddingProvider: undefined,
      embeddingModel: undefined,
      embeddingBaseUrl: undefined,
      embeddingAuthEnv: undefined,
      configureEmbedding: false,
      show: false,
      reset: false,
      check: false,
    });
    expect(() => parseArgs(["bun", "vos", "agent", "config", "--with-embedding", "--without-embedding"]))
      .toThrow("cannot combine");
  });

  test("parses command-managed knowledge sources", () => {
    expect(parseArgs([
      "bun", "vos", "kb", "add", "docs/reference",
      "--source-kind", "course",
      "--title", "Course Reference",
      "--recursive",
      "--manifest", "kb-manifest.json",
    ]).command).toEqual({
      kind: "kb_add",
      source: "docs/reference",
      sourceKind: "course",
      stage: undefined,
      title: "Course Reference",
      recursive: true,
      manifestPath: "kb-manifest.json",
    });
    expect(parseArgs(["bun", "vos", "kb", "list"]).command).toEqual({ kind: "kb_list" });
    expect(parseArgs(["bun", "vos", "kb", "search", "allocator invariant"]).command)
      .toEqual({ kind: "kb_search", query: "allocator invariant" });
    expect(parseArgs(["bun", "vos", "kb", "remove", "kb-123"]).command)
      .toEqual({ kind: "kb_remove", id: "kb-123" });
    expect(parseArgs(["bun", "vos", "kb", "clear"]).command).toEqual({ kind: "kb_clear" });
    expect(parseArgs(["bun", "vos", "kb", "export-manifest", "--out", "manifest.json"]).command)
      .toEqual({ kind: "kb_export_manifest", outPath: "manifest.json" });
    expect(parseArgs(["bun", "vos", "kb", "import-manifest", "manifest.json"]).command)
      .toEqual({ kind: "kb_import_manifest", manifestPath: "manifest.json" });
  });

  test("accepts only the documented global options", () => {
    const parsed = parseArgs([
      "bun", "vos", "--project-root", "examples/xv6-spec", "--json", "--verbose",
      "--progress", "never", "doctor",
    ]);
    expect(parsed.global).toMatchObject({
      projectRoot: "examples/xv6-spec",
      json: true,
      verbose: true,
      progress: "never",
    });
    expect(() => parseArgs(["bun", "vos", "--progress", "loud", "doctor"]))
      .toThrow("--progress must be one of");
    for (const flag of ["--agent-session", "--report", "--evidence-dir"]) {
      expect(() => parseArgs(["bun", "vos", flag, "value", "doctor"]))
        .toThrow("was removed from the student CLI");
    }
  });

  test("rejects retired top-level commands", () => {
    for (const command of [
      "login", "logout", "whoami", "pipeline", "project", "serve", "stage",
      "toolchain", "arch", "test", "trace", "debug", "ledger", "seed",
    ]) {
      expect(() => parseArgs(["bun", "vos", command])).toThrow(`${command} was removed`);
    }
  });

  test("rejects retired nested commands without aliases", () => {
    for (const command of ["normalize", "check-consistency", "patch"]) {
      expect(() => parseArgs(["bun", "vos", "spec", command])).toThrow(`spec ${command} was removed`);
    }
    expect(() => parseArgs(["bun", "vos", "spec", "check"]))
      .toThrow("spec check was removed");
    for (const command of ["design", "spec", "review-spec", "serve", "context", "plan", "generate", "apply-patch", "validate-generated", "log"]) {
      expect(() => parseArgs(["bun", "vos", "agent", command])).toThrow("was removed");
    }
    expect(() => parseArgs(["bun", "vos", "build", "generate"]))
      .toThrow("build generate was removed");
    expect(() => parseArgs(["bun", "vos", "report", "generate"]))
      .toThrow("report generate was removed");
    expect(() => parseArgs(["bun", "vos", "submit", "pack"]))
      .toThrow("submit pack was removed");
  });

  test("rejects legacy command-specific execution flags", () => {
    expect(() => parseArgs(["bun", "vos", "build", "--toolchain", "legacy.yaml"]))
      .toThrow("accepts no command-specific options");
    expect(() => parseArgs(["bun", "vos", "run", "qemu", "--profile", "syscall"]))
      .toThrow("accepts no command-specific options");
    expect(() => parseArgs(["bun", "vos", "run", "hardware", "--timeout", "1000"]))
      .toThrow("accepts no command-specific options");
    expect(() => parseArgs(["bun", "vos", "verify", "public"]))
      .toThrow("accepts only --hidden");
    expect(() => parseArgs(["bun", "vos", "agent", "implement", "memory", "-i"]))
      .toThrow("accepts exactly one module");
    expect(() => parseArgs(["bun", "vos", "agent", "debug", "--run", "run-1"]))
      .toThrow("accepts no command-specific options");
  });

  test("help lists only the student surface", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "src/main.ts", "--help"],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    for (const command of ["spec lint", "agent ask", "agent review", "agent implement", "run hardware", "verify", "submit"]) {
      expect(output).toContain(command);
    }
    for (const retired of ["agent design", "agent spec", "agent serve", "pipeline", "toolchain", "spec check", "build generate", "submit pack"]) {
      expect(output).not.toContain(retired);
    }
  }, 15_000);

  test("prints focused public help and rejects retired help topics", () => {
    expect(parseArgs(["bun", "vos", "agent", "implement", "--help"]).command)
      .toEqual({ kind: "help", topic: "agent implement" });
    const publicHelp = Bun.spawnSync({
      cmd: ["bun", "run", "src/main.ts", "agent", "implement", "--help"],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(publicHelp.exitCode).toBe(0);
    expect(publicHelp.stdout.toString()).toContain("Usage: vos agent implement <module>");

    const retiredHelp = Bun.spawnSync({
      cmd: ["bun", "run", "src/main.ts", "help", "agent", "generate"],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(retiredHelp.exitCode).toBe(1);
    expect(retiredHelp.stderr.toString()).toContain("unknown help topic: agent generate");
  }, 15_000);
});
