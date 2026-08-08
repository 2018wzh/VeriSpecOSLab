import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCliInvocation } from "../src/main.ts";
import { parseArgs } from "../src/cli.ts";
import { verifyAuditChain } from "../src/audit/chain.ts";
import { ensureHeadLedgerEntry } from "../src/repro/ledger.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("student v2 workflow", () => {
  test("exposes the reduced command grammar and structured runner argv", () => {
    expect(parseArgs(["bun", "vos", "spec", "check"]).command).toEqual({ kind: "spec_check" });
    expect(parseArgs(["bun", "vos", "run", "hardware", "--timeout", "42"]).command).toEqual({ kind: "run_hardware", dryRun: false, timeoutMs: 42 });
    expect(parseArgs(["bun", "vos", "agent", "spec", "memory", "--confirm"]).command).toEqual({ kind: "agent_spec", module: "memory", confirm: true });
    expect(parseArgs(["bun", "vos", "verify"]).command).toEqual({ kind: "verify", scope: "public", target: undefined, dryRun: false, staffPolicy: undefined });
  });

  test("initializes an empty student project without legacy project or policy files", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      const result = await invoke(root, "init");
      expect(result.status).toBe("passed");
    });
    expect(existsSync(join(root, "vos.yaml"))).toBe(true);
    expect(existsSync(join(root, "spec", "design.yaml"))).toBe(true);
    expect(existsSync(join(root, "spec", "modules", "toolchain.yaml"))).toBe(true);
    expect(existsSync(join(root, ".vos", "project.yaml"))).toBe(false);
    expect(existsSync(join(root, ".vos", "policy.yaml"))).toBe(false);
    expect(readFileSync(join(root, "vos.yaml"), "utf8")).toContain("program: bun");
  });

  test("allows dirty development build but requires clean HEAD for verify and hardware evidence", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      writeFileSync(join(root, "draft.c"), "draft\n");
      const build = await invoke(root, "build");
      expect(build.status).toBe("passed");
      expect((build.details?.evidence as { submittable?: boolean })?.submittable).toBe(false);

      const dirtyVerify = await invoke(root, "verify");
      expect(dirtyVerify.status).toBe("policy_blocked");

      rmSync(join(root, "draft.c"));
      const verify = await invoke(root, "verify");
      expect(verify.status).toBe("passed");
      const hardware = await invoke(root, "run", "hardware");
      expect(hardware.status).toBe("passed");
      expect(hardware.details?.human_review).toBe("pending_human_review");
      const report = await invoke(root, "report");
      expect(report.status).toBe("passed");
      expect(report.details?.submittable).toBe(true);
      const submit = await invoke(root, "submit");
      expect(submit.status).toBe("passed");
      expect(String(submit.details?.pack_path)).toContain(".vos/submit/");
      expect(verifyAuditChain(root).ok).toBe(true);
    });
  }, 30_000);

  test("runs agent verify in a disposable worktree without changing the student tree", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      writeFileSync(join(root, "vos.yaml"), [
        "version: vos.project.v1",
        "build: { program: bun, args: [-e, \"require('node:fs').writeFileSync('build-output.txt', 'generated')\"], cwd: ., env: [], timeout: 30000, artifacts: [] }",
        "runners: {}",
        "checks:",
        "  public-toolchain: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [toolchain] }",
        "knowledge: { sources: [] }",
        "",
      ].join("\n"));
      writeFileSync(join(root, ".gitignore"), ".vos/\n.env\nbuild-output.txt\n");
      git(root, ["add", "vos.yaml", ".gitignore"]);
      git(root, ["commit", "-m", "configure verify worktree test"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record verify configuration", changedTargets: ["vos.yaml", ".gitignore"] });

      const result = await invoke(root, "agent", "verify");

      expect(result.status).toBe("passed");
      expect(existsSync(join(root, "build-output.txt"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("applies a confirmed DesignSpec proposal atomically and leaves a commit", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      const design = [
        "system: { name: student-os, language: rust, isa: riscv64 }",
        "machine: { qemu: { machine: virt }, hardware: {} }",
        "kernel: { organization: monolithic, execution: preemptive, protection: paging, communication: ipc, resource_model: ownership }",
        "required_mechanisms: [syscall]",
        "composition_invariants: [all syscalls validate pointers]",
        "hardware_port: { board: virt-board, boot: serial, console: uart, interrupt: plic }",
        "",
      ].join("\n");
      const result = await invokeWithAgent(root, ["agent", "design", "--confirm"], "student_design_proposal.v1", { files: [{ path: "spec/design.yaml", content: design }] });
      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "spec", "design.yaml"), "utf8")).toContain("language: rust");
      expect(readFileSync(join(root, ".git", "HEAD"), "utf8")).toBeTruthy();
    });
  }, 30_000);

  test("implements a committed ModuleSpec in a detached worktree and commits only owned files", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "spec", "modules", "memory.yaml"), [
        "id: memory",
        "module: memory",
        "level: 1",
        "purpose: Own the memory allocator implementation.",
        "owns: [src/memory.ts]",
        "interface: [allocate]",
        "properties: [allocated blocks are aligned]",
        "errors: [out_of_memory]",
        "",
      ].join("\n"));
      writeFileSync(join(root, "vos.yaml"), [
        "version: vos.project.v1",
        "build: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, artifacts: [] }",
        "runners: {}",
        "checks:",
        "  public-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [memory] }",
        "  contract-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [memory] }",
        "knowledge: { sources: [] }",
        "",
      ].join("\n"));
      git(root, ["add", "vos.yaml", "spec/modules/memory.yaml"]);
      git(root, ["commit", "-m", "add memory module spec"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record memory module spec", changedTargets: ["vos.yaml", "spec/modules/memory.yaml"] });

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          return {
            content: "implemented",
            events: acceptedSubmitEvents("student_implementation_result.v1", {
              status: "passed",
              changed_paths: ["src/memory.ts"],
              validations: ["build", "public-memory", "contract-memory"],
            }),
          };
        },
      });

      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("allocate");
      expect(git(root, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][agent] Implement memory");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("does not land an implementation that crosses ModuleSpec owns", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const before = git(root, ["rev-parse", "HEAD"]).trim();
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          writeFileSync(join(options.projectRoot, "outside.txt"), "must not land\n");
          return { content: "bad", events: acceptedSubmitEvents("student_implementation_result.v1", { status: "passed" }) };
        },
      });

      expect(result.status).toBe("policy_blocked");
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
      expect(existsSync(join(root, "outside.txt"))).toBe(false);
    });
  }, 30_000);

  test("extends implementation owns through a committed v2 SpecPatch", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "spec", "patches"), { recursive: true });
      writeFileSync(join(root, "spec", "modules", "shared.yaml"), [
        "id: shared",
        "module: shared",
        "level: 1",
        "purpose: Own shared implementation files.",
        "owns: [src/shared.ts]",
        "interface: [shared_value]",
        "properties: [shared state is deterministic]",
        "errors: []",
        "",
      ].join("\n"));
      writeFileSync(join(root, "spec", "patches", "memory-shared.yaml"), [
        "id: memory-shared",
        "reason: share ownership between memory and shared modules",
        "changes: [memory, shared]",
        "new_invariants: [shared state remains deterministic]",
        "",
      ].join("\n"));
      git(root, ["add", "spec/modules/shared.yaml", "spec/patches/memory-shared.yaml"]);
      git(root, ["commit", "-m", "add committed memory shared patch"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record committed SpecPatch", changedTargets: ["spec/modules/shared.yaml", "spec/patches/memory-shared.yaml"] });

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "shared.ts"), "export const sharedValue = 1;\n");
          return {
            content: "implemented shared ownership",
            events: acceptedSubmitEvents("student_implementation_result.v1", {
              status: "passed",
              changed_paths: ["src/shared.ts"],
              validations: ["build", "public-memory", "contract-memory"],
            }),
          };
        },
      });

      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "src", "shared.ts"), "utf8")).toContain("sharedValue");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-student-v2-"));
  roots.push(root);
  return root;
}

async function invoke(root: string, ...args: string[]) {
  return executeCliInvocation(["bun", "vos", "--project-root", root, "--json", ...args], { print: false });
}

async function invokeWithAgent(root: string, args: string[], schemaId: string, result: unknown) {
  return executeCliInvocation(["bun", "vos", "--project-root", root, "--json", ...args], {
    print: false,
    agentRunner: async () => ({
      content: "proposal",
      events: [
        { name: "mcp__vos-progress__submit_result", type: "tool.call", id: "1", arguments: JSON.stringify({ schema_id: schemaId, result }) },
        { name: "mcp__vos-progress__submit_result", type: "tool.result", id: "1", content: JSON.stringify({ type: "vos-result-submission", schema_id: schemaId, accepted: true }) },
      ],
    }),
  });
}

async function prepareModuleProject(root: string): Promise<void> {
  expect((await invoke(root, "init")).status).toBe("passed");
  writeFileSync(join(root, "spec", "modules", "memory.yaml"), [
    "id: memory",
    "module: memory",
    "level: 1",
    "purpose: Own the memory allocator implementation.",
    "owns: [src/memory.ts]",
    "interface: [allocate]",
    "properties: [allocated blocks are aligned]",
    "errors: [out_of_memory]",
    "",
  ].join("\n"));
  writeFileSync(join(root, "vos.yaml"), [
    "version: vos.project.v1",
    "build: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, artifacts: [] }",
    "runners: {}",
    "checks:",
    "  public-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [memory] }",
    "  contract-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [memory] }",
    "knowledge: { sources: [] }",
    "",
  ].join("\n"));
  git(root, ["add", "vos.yaml", "spec/modules/memory.yaml"]);
  git(root, ["commit", "-m", "add memory module spec"]);
  await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record memory module spec", changedTargets: ["vos.yaml", "spec/modules/memory.yaml"] });
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

function acceptedSubmitEvents(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    { type: "tool.call", name: "mcp__vos-progress__submit_result", id: "submit", arguments: JSON.stringify({ schema_id: schemaId, result }) },
    { type: "tool.result", name: "mcp__vos-progress__submit_result", id: "submit", content: JSON.stringify({ type: "vos-result-submission", schema_id: schemaId, accepted: true }) },
  ];
}

async function withGitIdentity<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
  const old = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_AUTHOR_NAME = "VOS Student Test";
  process.env.GIT_AUTHOR_EMAIL = "student@example.invalid";
  process.env.GIT_COMMITTER_NAME = "VOS Student Test";
  process.env.GIT_COMMITTER_EMAIL = "student@example.invalid";
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = old.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
