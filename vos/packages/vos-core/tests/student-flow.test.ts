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
    expect(parseArgs(["bun", "vos", "spec", "lint", "design"]).command).toEqual({ kind: "spec_lint", target: "design" });
    expect(() => parseArgs(["bun", "vos", "spec", "check"])).toThrow("spec check was removed");
    expect(parseArgs(["bun", "vos", "run", "hardware", "--timeout", "42"]).command).toEqual({ kind: "run_hardware", dryRun: false, timeoutMs: 42 });
    expect(() => parseArgs(["bun", "vos", "agent", "spec", "memory"])).toThrow("agent spec was removed");
    expect(() => parseArgs(["bun", "vos", "agent", "design"])).toThrow("agent design was removed");
    expect(() => parseArgs(["bun", "vos", "agent", "review-spec"])).toThrow("review-spec was removed");
    expect(parseArgs(["bun", "vos", "agent", "review", "memory", "-i"]).command).toEqual({ kind: "agent_review", target: "memory", display: true });
    expect(parseArgs(["bun", "vos", "agent", "config", "--provider", "openai", "--model", "gpt-5", "--auth-env", "OPENAI_API_KEY"]).command).toEqual({
      kind: "agent_config",
      provider: "openai",
      model: "gpt-5",
      baseUrl: undefined,
      authEnv: "OPENAI_API_KEY",
      embeddingProvider: undefined,
      embeddingModel: undefined,
      embeddingBaseUrl: undefined,
      embeddingAuthEnv: undefined,
      configureEmbedding: undefined,
      show: false,
      reset: false,
      check: false,
    });
    expect(() => parseArgs(["bun", "vos", "agent", "config", "--with-embedding", "--without-embedding"])).toThrow("cannot combine");
    expect(parseArgs(["bun", "vos", "agent", "ask", "What is Sv39?"]).command).toEqual({
      kind: "agent_ask",
      question: "What is Sv39?",
      interactive: false,
    });
    expect(() => parseArgs(["bun", "vos", "agent", "kb", "What is Sv39?"])).toThrow("unknown agent subcommand: kb");
    expect(parseArgs(["bun", "vos", "kb", "list"]).command).toEqual({ kind: "kb_list" });
    expect(parseArgs(["bun", "vos", "verify", "--hidden"]).command).toEqual({ kind: "verify", scope: "public", target: undefined, dryRun: false, staffPolicy: undefined, hidden: true });
  });

  test("initializes an empty student project without legacy project or policy files", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      const result = await invoke(root, "init");
      expect(result.status).toBe("passed");
      const unconfigured = await invoke(root, "doctor");
      expect(unconfigured.status).toBe("passed");
      expect(unconfigured.details?.warnings).toContain("agent-tool-diagnosis");
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
      const configured = await invoke(root, "agent", "config", "--provider", "openai", "--model", "gpt-5", "--auth-env", "OPENAI_API_KEY");
      expect(configured.status).toBe("passed");
      expect((await invoke(root, "doctor")).status).toBe("passed");
      expect((await invoke(root, "kb", "list")).status).toBe("passed");
    });
    expect(existsSync(join(root, "vos.yaml"))).toBe(true);
    expect(existsSync(join(root, "spec", "design.yaml"))).toBe(true);
    expect(readFileSync(join(root, "vos.yaml"), "utf8")).not.toContain("knowledge:");
    expect(existsSync(join(root, "spec", "modules", "toolchain.yaml"))).toBe(true);
    expect(existsSync(join(root, ".vos", "project.yaml"))).toBe(false);
    expect(existsSync(join(root, ".vos", "policy.yaml"))).toBe(false);
    expect(readFileSync(join(root, "vos.yaml"), "utf8")).toContain("program: bun");
  });

  test("runs agent ask without an embedding provider when no KB sources are configured", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      writeFileSync(join(root, ".vos", "config.toml"), [
        "[agent]",
        'provider = "openai"',
        'model = "gpt-5"',
        "[agent.auth]",
        'env = "OPENAI_API_KEY"',
        "",
      ].join("\n"));
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
      const result = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "ask", "What is Sv39?",
      ], {
        print: false,
        agentRunner: async (options) => {
          expect(options.extraMcpServers?.map((server) => server.name)).not.toContain("vos-kb");
          return {
            content: "ignored",
            events: acceptedSubmitEvents("knowledgebase_answer.v1", {
              answer: "Sv39 is the RISC-V 39-bit virtual-memory scheme.",
              stage_key: "student-kb",
              design_goal_alignment: [],
              citations: [],
              suggested_next_steps: [],
              allowed_snippets: [],
            }),
          };
        },
      });
      expect(result.status).toBe("passed");
      expect(result.details?.scope).toBe("student-kb");
    });
  }, 30_000);

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
      expect(submit.status).toBe("policy_blocked");
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

  test("lints and reviews a handwritten DesignSpec without modifying it", async () => {
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
      writeFileSync(join(root, "spec", "design.yaml"), design);
      const lint = await invoke(root, "spec", "lint", "design");
      expect(lint.status).toBe("passed");
      const before = readFileSync(join(root, "spec", "design.yaml"), "utf8");
      const result = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "review", "design",
      ], {
        print: false,
        agentRunner: async () => ({ content: "reviewed", events: acceptedSubmitEvents("spec_review.v1", { findings: [], summary: "ready" }) }),
      });
      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "spec", "design.yaml"), "utf8")).toBe(before);
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
        "owns: [src/memory.ts, tests/memory]",
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
        "",
      ].join("\n"));
      git(root, ["add", "vos.yaml", "spec/modules/memory.yaml"]);
      git(root, ["commit", "-m", "add memory module spec"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record memory module spec", changedTargets: ["vos.yaml", "spec/modules/memory.yaml"] });

      const reviewResult = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "review", "memory",
      ], {
        print: false,
        agentRunner: async (options) => {
          expect(options.context).toMatchObject({
            counts: { operations: 1, public_requirements: 2 },
            inventory: {
              operations: ["memory.allocate"],
              public_requirements: [
                { id: "contract-memory", verifies: ["memory"] },
                { id: "public-memory", verifies: ["memory"] },
              ],
            },
          });
          return { content: "reviewed", events: acceptedSubmitEvents("spec_review.v1", { findings: [], summary: "ready" }) };
        },
      });
      expect(reviewResult.status).toBe("passed");

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          expect(options.task).toContain("Existing test target IDs are immutable and MUST NOT be proposed again:");
          expect(options.task).toContain('"contract-memory"');
          expect(options.task).toContain('"public-memory"');
          expect(options.task).toContain("Choose new module-prefixed IDs");
          expect(options.task).toContain("hard 50-iteration limit");
          expect(options.task).toContain("write the implementation and every non-hidden test by iteration 24");
          expect(options.task).toContain("call submit_result no later than iteration 45");
          expect(options.task).toContain("Never spend more than five iterations debugging one failed command");
          expect(options.task).toContain("batch independent Read/Write/Bash calls");
          expect(options.task).toContain("Do not inspect parent or sibling directories");
          expect(options.task).toContain("Do not perform repo-wide schema searches");
          expect(options.task).toContain("Each hidden_tests entry is");
          expect(options.task).toContain('use env: ["PATH"] for every target');
          expect(options.task).toContain("hidden tests that resolve host tools also require PATH in env");
          expect(options.task).toContain("This is an implementation task, not a planning task");
          expect(options.task).toContain("write the owned files, run validation, and call submit_result");
          expect(options.task).toContain("Reuse helpers under tests/public");
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          return {
            content: "implemented",
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()),
          };
        },
      });

      expect(result).toMatchObject({ status: "passed" });
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("allocate");
      expect(git(root, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][agent] Implement memory");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
      expect((await invoke(root, "verify", "--hidden")).status).toBe("passed");
      expect((await invoke(root, "submit")).status).toBe("passed");
      writeFileSync(join(root, "student-note.md"), "new committed state\n");
      git(root, ["add", "student-note.md"]);
      git(root, ["commit", "-m", "change commit after hidden verification"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "change commit after hidden verification", changedTargets: ["student-note.md"] });
      expect((await invoke(root, "submit")).status).toBe("policy_blocked");
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
          return { content: "bad", events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()) };
        },
      });

      expect(result.status).toBe("policy_blocked");
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
      expect(existsSync(join(root, "outside.txt"))).toBe(false);
    });
  }, 30_000);

  test("does not project invalid test targets or land code when structured validation fails", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const beforeHead = git(root, ["rev-parse", "HEAD"]).trim();
      const beforeManifest = readFileSync(join(root, "vos.yaml"), "utf8");
      const proposal = implementationResult();
      delete (proposal.test_targets.find((target) => target.kind === "fuzz") as { seed?: number }).seed;

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          return { content: "invalid fuzz target", events: acceptedSubmitEvents("student_implementation_result.v1", proposal) };
        },
      });

      expect(result.status).toBe("validation_failed");
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(beforeHead);
      expect(readFileSync(join(root, "vos.yaml"), "utf8")).toBe(beforeManifest);
      expect(existsSync(join(root, "src", "memory.ts"))).toBe(false);
    });
  }, 30_000);

  test("preserves a partial implementation submission and Agent events in local evidence", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const proposal = implementationResult();
      proposal.status = "partial";
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async () => ({
          content: "partial implementation",
          events: acceptedSubmitEvents("student_implementation_result.v1", proposal),
        }),
      });

      expect(result.status).toBe("validation_failed");
      const artifact = result.artifacts.find((item) => item.summary === "student implement evidence");
      expect(artifact).toBeDefined();
      const recorded = JSON.parse(readFileSync(join(root, artifact!.path), "utf8")) as Record<string, unknown>;
      expect(recorded).toMatchObject({
        validation: { agent_result: { status: "partial" } },
      });
      expect(Array.isArray(recorded.agent_events)).toBe(true);
      expect((recorded.agent_events as unknown[]).length).toBeGreaterThan(0);
    });
  }, 30_000);

  test("preserves streamed Agent events when the implementation runtime throws", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          await options.onEvent?.({ type: "tool.call", name: "Bash", arguments: "bun test" });
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const partial = true;\n");
          throw new Error("agent loop exhausted");
        },
      });

      expect(result.status).toBe("validation_failed");
      expect(result.details?.patch_available).toBe(true);
      const artifact = result.artifacts.find((item) => item.summary === "student implement evidence");
      const recorded = JSON.parse(readFileSync(join(root, artifact!.path), "utf8")) as {
        agent_events: Array<Record<string, unknown>>;
        patch: string;
        validation: { changed_paths: string[] };
      };
      expect(recorded.agent_events).toEqual([
        { type: "tool.call", name: "Bash", arguments: "bun test" },
      ]);
      expect(recorded.validation.changed_paths).toEqual(["src/memory.ts"]);
      expect(recorded.patch).toContain("export const partial = true");
      expect(existsSync(join(root, "src", "memory.ts"))).toBe(false);
    });
  }, 30_000);

  test("does not land code, tests, or manifest targets when a proposed regression fails", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const beforeHead = git(root, ["rev-parse", "HEAD"]).trim();
      const beforeManifest = readFileSync(join(root, "vos.yaml"), "utf8");
      const proposal = implementationResult();
      proposal.test_targets[0]!.args = ["-e", "process.exit(1)"];

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          return { content: "failing regression", events: acceptedSubmitEvents("student_implementation_result.v1", proposal) };
        },
      });

      expect(result.status).toBe("validation_failed");
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(beforeHead);
      expect(readFileSync(join(root, "vos.yaml"), "utf8")).toBe(beforeManifest);
      expect(existsSync(join(root, "src", "memory.ts"))).toBe(false);
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
        "owns: [src/shared.ts, tests/generated/shared]",
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
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()),
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
    "owns: [src/memory.ts, tests/memory]",
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

function implementationResult() {
  const base = {
    program: "bun",
    args: ["--version"],
    cwd: ".",
    env: [] as string[],
    timeout: 30_000,
    verifies: ["memory"],
    artifacts: [] as string[],
  };
  return {
    status: "passed",
    changed_paths: ["src/memory.ts"],
    validations: ["build"],
    test_targets: [
      { ...base, id: "generated-public-memory", kind: "public" },
      { ...base, id: "generated-contract-memory", kind: "contract" },
      { ...base, id: "generated-fuzz-memory", kind: "fuzz", seed: 7, cases: 32, reproduction_artifact: ".vos/fuzz/memory-min.txt" },
      { ...base, id: "generated-trace-memory", kind: "trace", workload: "allocator-smoke", oracle: "all allocations remain aligned", artifacts: [".vos/trace/memory.json"] },
    ],
    hidden_tests: [{
      id: "hidden-memory",
      path: "memory.hidden.ts",
      content: "if (1 + 1 !== 2) process.exit(1);\n",
      program: "bun",
      args: ["{hidden_test}"],
      cwd: ".",
      env: [] as string[],
      timeout: 30_000,
      verifies: ["memory"],
      seed: 11,
    }],
  };
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
