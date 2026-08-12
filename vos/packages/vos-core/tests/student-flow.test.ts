import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { executeCliInvocation } from "../src/main.ts";
import { parseArgs } from "../src/cli.ts";
import { appendAuditEvent, verifyAuditChain } from "../src/audit/chain.ts";
import { ensureHeadLedgerEntry } from "../src/repro/ledger.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("student v2 workflow", () => {
  test("exposes the reduced command grammar and structured runner argv", () => {
    expect(parseArgs(["bun", "vos", "spec", "lint", "design"]).command).toEqual({ kind: "spec_lint", target: "design" });
    expect(() => parseArgs(["bun", "vos", "spec", "check"])).toThrow("spec check was removed");
    expect(parseArgs(["bun", "vos", "run", "hardware"]).command).toEqual({ kind: "run_hardware", dryRun: false });
    expect(() => parseArgs(["bun", "vos", "run", "hardware", "--timeout", "42"])).toThrow("accepts no command-specific options");
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
      expect(result).toMatchObject({ status: "passed" });
      const unconfigured = await invoke(root, "doctor");
      expect(unconfigured.status).toBe("passed");
      expect(unconfigured.details?.warnings).toContain("agent-tool-diagnosis");
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
      const configured = await invoke(root, "agent", "config", "--provider", "openai", "--model", "gpt-5", "--auth-env", "OPENAI_API_KEY");
      expect(configured.status).toBe("passed");
      const configuredDoctor = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "doctor",
      ], {
        print: false,
        agentRunner: async () => {
          throw new Error("provider network unavailable");
        },
      });
      expect(configuredDoctor.status).toBe("passed");
      expect((await invoke(root, "kb", "list")).status).toBe("passed");
    });
    expect(existsSync(join(root, "vos.yaml"))).toBe(true);
    expect(existsSync(join(root, "spec", "design.yaml"))).toBe(true);
    expect(readFileSync(join(root, "vos.yaml"), "utf8")).not.toContain("knowledge:");
    expect(existsSync(join(root, "spec", "modules", "toolchain.yaml"))).toBe(true);
    expect(existsSync(join(root, ".vos", "project.yaml"))).toBe(false);
    expect(existsSync(join(root, ".vos", "policy.yaml"))).toBe(false);
    expect(readFileSync(join(root, "vos.yaml"), "utf8")).toContain("program: bun");
  }, 30_000);

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
      expect(result).toMatchObject({ status: "passed" });
      expect(result.details?.scope).toBe("student-kb");
      const events = readFileSync(join(root, ".vos", "runs", result.run_id, "events.jsonl"), "utf8");
      expect(events).toContain('"kind":"kb_query"');
      expect(events).toContain('"query":"What is Sv39?"');
      expect(events).toContain('"visible_hits":[]');
    });
  }, 30_000);

  test("uses the configured Debug Agent for the latest student failure without modifying the project", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const failedRoot = join(root, ".vos", "runs", "failed-qemu");
      mkdirSync(join(failedRoot, "artifacts"), { recursive: true });
      writeFileSync(join(failedRoot, "artifacts", "student-qemu.json"), JSON.stringify({
        status: "failed",
        oracle: { outcome: "missing", pattern: "CTF_BAREMETAL_OK" },
        stdout: "qemu: completion marker observed",
      }));
      writeFileSync(join(failedRoot, "manifest.json"), JSON.stringify({
        run_id: "failed-qemu",
        status: "failed",
        artifacts: [{ kind: "qemu", path: ".vos/runs/failed-qemu/artifacts/student-qemu.json" }],
      }));

      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "debug"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          expect(options.taskKind).toBe("student_debug");
          expect(JSON.stringify(options.context)).toContain("CTF_BAREMETAL_OK");
          if (turn === 2) {
            expect(options.threadId).toBe("student-debug-repair");
            expect(options.task).toContain("visualization_html must be a complete HTML document");
          }
          return {
            content: "diagnosed",
            threadId: "student-debug-repair",
            events: acceptedSubmitEvents("debug_output.v1", {
              failure_class: "verification_failure",
              summary: "The runner cannot observe the completion marker.",
              suspected_clauses: ["toolchain.run_qemu"],
              related_specs: ["toolchain"],
              suspected_concepts: ["serial oracle projection"],
              evidence_chain: [{ label: "qemu evidence", artifact: ".vos/runs/failed-qemu/artifacts/student-qemu.json", observation: "marker absent from captured stdout" }],
              visualization_steps: [{ phase: "capture", description: "Runner checks captured stdout." }],
              visualization_html: turn === 1
                ? "<main>incomplete</main>"
                : "<!doctype html><html><body><main data-agent-generated=\"true\"><section>capture</section><input id=\"scrubber\" type=\"range\"><script>const states=[];</script></main></body></html>",
              trace_summary: "No additional trace was required.",
              gdb_summary: "GDB was not required.",
              next_diagnostic_commands: ["vos run qemu"],
              student_visible_limitations: ["Diagnosis is limited to captured evidence."],
            }),
          };
        },
      });

      expect(turn).toBe(2);
      expect(result).toMatchObject({ status: "passed", details: { role: "debug", model_used: true, worktree_read_only: true } });
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
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

      const result = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "verify",
      ], {
        print: false,
        agentRunner: async (options) => {
          expect(options.taskKind).toBe("student_verify");
          expect(options.agentProfile?.outputSchema).toBe("student_verification_review.v1");
          expect(options.context).toMatchObject({ deterministic_status: "passed" });
          return {
            content: "reviewed",
            events: acceptedSubmitEvents("student_verification_review.v1", {
              deterministic_status: "passed",
              summary: "public verification and stable Spec ID coverage reviewed",
              findings: [],
              coverage_gaps: [],
            }),
          };
        },
      });

      expect(result).toMatchObject({ status: "passed" });
      expect(result.details?.model_used).toBe(true);
      expect(result.details?.review).toMatchObject({ deterministic_status: "passed" });
      expect(existsSync(join(root, "build-output.txt"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");

      const modified = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "verify",
      ], {
        print: false,
        agentRunner: async (options) => {
          writeFileSync(join(options.projectRoot, "spec", "design.yaml"), "modified by readonly verifier\n");
          return {
            content: "invalid readonly review",
            events: acceptedSubmitEvents("student_verification_review.v1", {
              deterministic_status: "passed",
              summary: "invalid readonly mutation",
              findings: [],
              coverage_gaps: [],
            }),
          };
        },
      });
      expect(modified.status).toBe("policy_blocked");
      expect(modified.details?.reason).toBe("readonly_agent_modified_project");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("lints and reviews a handwritten DesignSpec without modifying it", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(root, "init")).status).toBe("passed");
      const design = [
        "system: { name: student-os, language: rust, isa: riscv64 }",
        "machine: { qemu: { machine: virt }, hardware: { board: virt-board } }",
        "kernel: { organization: monolithic, execution: preemptive, protection: paging, communication: ipc, resource_model: ownership }",
        "required_mechanisms: [syscall]",
        "composition_invariants: [all syscalls validate pointers]",
        "non_goals: []",
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
        "build: { program: bun, args: [-e, \"require('node:fs').mkdirSync('build', { recursive: true }); require('node:fs').writeFileSync('build/hidden-prerequisite.txt', 'built')\"], cwd: ., env: [], timeout: 30000, artifacts: [build/hidden-prerequisite.txt] }",
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
            counts: { operations: 1, mapped_checks: 2 },
            inventory: {
              operations: ["memory.allocate"],
              mapped_checks: [
                { id: "contract-memory", verifies: ["memory"] },
                { id: "public-memory", verifies: ["memory"] },
              ],
            },
          });
          expect(options.task).toContain("strict ModuleSpec schema has no such field");
          return { content: "reviewed", events: acceptedSubmitEvents("spec_review.v1", { findings: [], summary: "ready" }) };
        },
      });
      expect(reviewResult.status).toBe("passed");

      writeFileSync(join(root, ".env"), "STUDENT_AGENT_TOKEN=test-only-token\n");
      writeFileSync(join(root, ".vos", "config.toml"), [
        "[agent]",
        'provider = "openai-compatible"',
        'model = "configured-course-model"',
        'base_url = "https://provider.example.invalid/v1"',
        "[agent.auth]",
        'env = "STUDENT_AGENT_TOKEN"',
        "",
      ].join("\n"));

      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          await options.onEvent?.({
            type: "assistant.message",
            iteration: 1,
            message: { role: "assistant", content: "working in the disposable worktree" },
          });
          expect(options.projectRoot).not.toBe(root);
          expect(existsSync(join(options.projectRoot, ".env"))).toBe(false);
          expect(existsSync(join(options.projectRoot, ".vos", "config.toml"))).toBe(false);
          expect(options.model).toBe("configured-course-model");
          expect(options.env?.OPENAI_COMPATIBLE_API_KEY).toBe("test-only-token");
          expect(options.env?.OPENAI_COMPATIBLE_BASE_URL).toBe("https://provider.example.invalid/v1");
          expect(options.task).toContain("Existing test target IDs are immutable and MUST NOT be proposed again:");
          expect(options.task).toContain('"contract-memory"');
          expect(options.task).toContain('"public-memory"');
          expect(options.task).toContain("Choose new module-prefixed IDs");
          expect(options.task).toContain("hard 1000-iteration maxIterations guard");
          expect(options.task).toContain("Finish discovery by iteration 30");
          expect(options.task).toContain("all four non-hidden test kinds by iteration 90");
          expect(options.task).toContain("local build plus proposed commands by iteration 115");
          expect(options.task).toContain("iteration-121 checkpoint");
          expect(options.task).toContain("verify that every proposed command path exists");
          expect(options.task).toContain("timeout is an integer number of milliseconds");
          expect(options.completionReserveIterations).toBe(880);
          expect(options.task).toContain("Do not call submit_result with failed, partial, or blocked status");
          expect(options.task).toContain("Batch independent Read/Write/Bash calls");
          expect(options.task).toContain("Do not inspect parent or sibling directories");
          expect(options.task).toContain("Do not perform repo-wide schema searches");
          expect(options.task).toContain("Hidden-test content must be self-contained");
          expect(options.task).toContain("Each hidden_tests entry is");
          expect(options.task).toContain('use env: ["PATH"] for every target');
          expect(options.task).toContain("hidden tests that resolve host tools also require PATH in env");
          expect(options.task).toContain("This is an implementation task, not a planning task");
          expect(options.task).toContain("Do not add adjacent later-stage operations");
          expect(options.task).toContain("Do not implement another newly declared ModuleSpec");
          expect(options.task).toContain("never to a sibling module that has not landed yet");
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
      const runEvents = readFileSync(join(root, ".vos", "runs", result.run_id, "events.jsonl"), "utf8");
      expect(runEvents).toContain('"kind":"agent_event"');
      expect(runEvents).toContain("working in the disposable worktree");
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("allocate");
      expect(git(root, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][agent] Implement memory");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
      const hiddenVerification = await invoke(root, "verify", "--hidden");
      expect(hiddenVerification).toMatchObject({ status: "passed" });
      expect(existsSync(join(root, "memory.hidden.output"))).toBe(false);
      writeFileSync(join(root, "untracked.txt"), "must not enter the submission\n");
      expect((await invoke(root, "submit")).status).toBe("policy_blocked");
      rmSync(join(root, "untracked.txt"));
      await appendAuditEvent(root, {
        type: "redaction-regression",
        authorization: "Bearer should-not-leak",
        token: "tok_submission_secret_123456",
        ANTHROPIC_AUTH_TOKEN: "opaque-provider-credential",
        command: "probe --root C:\\Users\\student\\repo\\",
      });
      const firstSubmit = await invoke(root, "submit");
      expect(firstSubmit).toMatchObject({
        status: "passed",
        details: {
          version: "vos.submit.v2",
          kind: "student-submission",
          reproducible: true,
          hardware_status: "pending_human_review",
        },
      });
      const archive = join(root, String(firstSubmit.details?.pack_path));
      const entries = await tarEntries(archive);
      expect(entries).toContain("repo/vos.yaml");
      expect(entries).toContain("report/report.json");
      expect(entries).toContain("hidden-tests/manifest.json");
      expect(entries).toContain("hidden-tests/last-verification.json");
      expect(entries).toContain("submit-manifest.json");
      expect(entries.some((entry) => entry.startsWith("repo/build/"))).toBe(false);
      expect(entries.some((entry) => entry.endsWith("/.env") || entry === "repo/.env")).toBe(false);
      expect(entries.some((entry) => entry.endsWith("fs.img"))).toBe(false);
      const extracted = join(root, ".vos", "submit-test-extracted");
      mkdirSync(extracted, { recursive: true });
      await tar.x({ file: archive, cwd: extracted });
      const exportedAudit = readFileSync(join(extracted, "audit", "chain.jsonl"), "utf8");
      for (const line of exportedAudit.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
      expect(exportedAudit).not.toContain("should-not-leak");
      expect(exportedAudit).not.toContain("tok_submission_secret_123456");
      expect(exportedAudit).not.toContain("opaque-provider-credential");
      expect(exportedAudit).not.toContain("C:\\Users\\student");
      writeFileSync(join(root, "student-note.md"), "new committed state\n");
      git(root, ["add", "student-note.md"]);
      git(root, ["commit", "-m", "change commit after hidden verification"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "change commit after hidden verification", changedTargets: ["student-note.md"] });
      expect((await invoke(root, "submit")).status).toBe("policy_blocked");
      expect((await invoke(root, "verify", "--hidden")).status).toBe("passed");
      expect((await invoke(root, "submit")).status).toBe("passed");
    });
  }, 120_000);

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

  test("returns owns violations to the same Agent thread for repair", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const originalIgnore = readFileSync(join(root, ".gitignore"), "utf8");
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          if (turn === 1) {
            writeFileSync(join(options.projectRoot, ".gitignore"), `${originalIgnore}agent-output\n`);
          } else {
            expect(options.threadId).toBe("owns-repair-thread");
            expect(options.task).toContain("owns_violation");
            expect(options.task).toContain(".gitignore");
            writeFileSync(join(options.projectRoot, ".gitignore"), originalIgnore);
          }
          return {
            content: "submitted",
            threadId: "owns-repair-thread",
            events: [
              { type: "model.usage", thread_id: "owns-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", implementationResult()).map((event) => ({
                ...event,
                thread_id: "owns-repair-thread",
                iteration: turn === 1 ? 45 : 2,
              })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status, JSON.stringify(result.details)).toBe("passed");
      expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(originalIgnore);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("returns tracked hidden-test files to the same Agent thread for removal", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          mkdirSync(join(options.projectRoot, "tests", "memory"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const hiddenDriver = join(options.projectRoot, "tests", "memory", "hidden_driver.sh");
          if (turn === 1) {
            writeFileSync(hiddenDriver, "#!/bin/sh\nexit 0\n");
          } else {
            expect(options.threadId).toBe("hidden-repair-thread");
            expect(options.task).toContain("hidden_test_git_violation");
            expect(options.task).toContain("tests/memory/hidden_driver.sh");
            rmSync(hiddenDriver);
          }
          return {
            content: "submitted",
            threadId: "hidden-repair-thread",
            events: [
              { type: "model.usage", thread_id: "hidden-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", implementationResult()).map((event) => ({
                ...event,
                thread_id: "hidden-repair-thread",
                iteration: turn === 1 ? 45 : 2,
              })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status, JSON.stringify(result.details)).toBe("passed");
      expect(existsSync(join(root, "tests", "memory", "hidden_driver.sh"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("accumulates hidden tests from multiple modules under one Spec hash", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      writeFileSync(join(root, "spec", "modules", "scheduler.yaml"), [
        "id: scheduler",
        "module: scheduler",
        "level: 1",
        "purpose: Own the scheduler implementation.",
        "owns: [src/scheduler.ts, tests/scheduler]",
        "interface: [schedule]",
        "properties: [runnable work is selected]",
        "errors: [no_runnable_work]",
        "",
      ].join("\n"));
      git(root, ["add", "spec/modules/scheduler.yaml"]);
      git(root, ["commit", "-m", "add scheduler module spec"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record scheduler module spec", changedTargets: ["spec/modules/scheduler.yaml"] });

      for (const moduleId of ["memory", "scheduler"]) {
        const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", moduleId], {
          print: false,
          agentRunner: async (options) => {
            mkdirSync(join(options.projectRoot, "src"), { recursive: true });
            writeFileSync(join(options.projectRoot, "src", `${moduleId}.ts`), `export const ${moduleId} = true;\n`);
            return {
              content: `implemented ${moduleId}`,
              events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult(moduleId)),
            };
          },
        });
        expect(result.status).toBe("passed");
      }

      const hiddenRoots = [...new Bun.Glob("*/manifest.json").scanSync({ cwd: join(root, ".vos", "hidden-tests"), absolute: true })];
      expect(hiddenRoots).toHaveLength(1);
      const manifest = JSON.parse(readFileSync(hiddenRoots[0]!, "utf8")) as { tests: Array<Record<string, unknown>> };
      expect(manifest.tests.map((test) => test.module_id).sort()).toEqual(["memory", "scheduler"]);
      expect(manifest.tests.map((test) => test.generation_run_id).every((value) => typeof value === "string")).toBe(true);
      expect(manifest.tests.every((test) => Array.isArray(test.args) && test.args[0] === "test" && test.args[1] === test.path)).toBe(true);
      expect((await invoke(root, "verify", "--hidden")).status).toBe("passed");
    });
  }, 60_000);

  test("retains hidden tests for an unchanged module across an unrelated Spec hash change", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);

      const implement = async (moduleId: string) => executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", moduleId], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", `${moduleId}.ts`), `export const ${moduleId} = true;\n`);
          return {
            content: `implemented ${moduleId}`,
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult(moduleId)),
          };
        },
      });

      expect((await implement("memory")).status).toBe("passed");
      const firstManifestPath = [...new Bun.Glob("*/manifest.json").scanSync({ cwd: join(root, ".vos", "hidden-tests"), absolute: true })][0]!;
      const legacyManifest = JSON.parse(readFileSync(firstManifestPath, "utf8")) as { tests: Array<Record<string, unknown>> };
      for (const test of legacyManifest.tests) delete test.binding_hash;
      writeFileSync(firstManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
      writeFileSync(join(root, "spec", "modules", "scheduler.yaml"), [
        "id: scheduler",
        "module: scheduler",
        "level: 1",
        "purpose: Own the scheduler implementation.",
        "owns: [src/scheduler.ts, tests/scheduler]",
        "interface: [schedule]",
        "properties: [runnable work is selected]",
        "errors: [no_runnable_work]",
        "",
      ].join("\n"));
      git(root, ["add", "spec/modules/scheduler.yaml"]);
      git(root, ["commit", "-m", "add unrelated scheduler module spec"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record scheduler module spec", changedTargets: ["spec/modules/scheduler.yaml"] });

      expect((await implement("scheduler")).status).toBe("passed");
      const hiddenRoots = [...new Bun.Glob("*/manifest.json").scanSync({ cwd: join(root, ".vos", "hidden-tests"), absolute: true })];
      expect(hiddenRoots).toHaveLength(2);
      const manifests = hiddenRoots.map((file) => JSON.parse(readFileSync(file, "utf8")) as { spec_hash: string; tests: Array<Record<string, unknown>> });
      const latest = manifests.find((manifest) => manifest.tests.some((test) => test.module_id === "scheduler"));
      expect(latest?.tests.map((test) => test.module_id).sort()).toEqual(["memory", "scheduler"]);
      expect(latest?.tests.every((test) => typeof test.binding_hash === "string")).toBe(true);
      expect((await invoke(root, "verify", "--hidden")).status).toBe("passed");
    });
  }, 60_000);

  test("hydrates unchanged legacy hidden tests for the current Spec hash before verification", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const implemented = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const memory = true;\n");
          return { content: "implemented memory", events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult("memory")) };
        },
      });
      expect(implemented.status).toBe("passed");
      const oldManifestPath = [...new Bun.Glob("*/manifest.json").scanSync({ cwd: join(root, ".vos", "hidden-tests"), absolute: true })][0]!;
      const oldManifest = JSON.parse(readFileSync(oldManifestPath, "utf8")) as { tests: Array<Record<string, unknown>> };
      for (const test of oldManifest.tests) delete test.binding_hash;
      writeFileSync(oldManifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`);

      writeFileSync(join(root, "spec", "modules", "scheduler.yaml"), [
        "id: scheduler",
        "module: scheduler",
        "level: 1",
        "purpose: Own the scheduler implementation.",
        "owns: [src/scheduler.ts, tests/scheduler]",
        "interface: [schedule]",
        "properties: [runnable work is selected]",
        "errors: [no_runnable_work]",
        "",
      ].join("\n"));
      git(root, ["add", "spec/modules/scheduler.yaml"]);
      git(root, ["commit", "-m", "add unrelated scheduler module spec"]);
      await ensureHeadLedgerEntry({ projectRoot: root, actor: "human", intent: "record scheduler module spec", changedTargets: ["spec/modules/scheduler.yaml"] });

      expect((await invoke(root, "verify", "--hidden")).status).toBe("passed");
      const manifests = [...new Bun.Glob("*/manifest.json").scanSync({ cwd: join(root, ".vos", "hidden-tests"), absolute: true })]
        .map((file) => JSON.parse(readFileSync(file, "utf8")) as { spec_hash: string; tests: Array<Record<string, unknown>> });
      expect(manifests).toHaveLength(2);
      expect(manifests.some((manifest) => manifest.tests.some((test) => test.module_id === "memory" && typeof test.binding_hash === "string"))).toBe(true);
    });
  }, 60_000);

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
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const partial = true;\n");
          return {
            content: "partial implementation",
            events: acceptedSubmitEvents("student_implementation_result.v1", proposal),
          };
        },
      });

      expect(result.status).toBe("validation_failed");
      expect(result.details?.patch_available).toBe(true);
      const artifact = result.artifacts.find((item) => item.summary === "student implement evidence");
      expect(artifact).toBeDefined();
      const recorded = JSON.parse(readFileSync(join(root, artifact!.path), "utf8")) as Record<string, unknown>;
      expect(recorded).toMatchObject({
        validation: { agent_result: { status: "partial" }, changed_paths: ["src/memory.ts"] },
      });
      expect(String(recorded.patch)).toContain("export const partial = true");
      expect(existsSync(join(root, "src", "memory.ts"))).toBe(false);
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
      expect(result.message).toBe("agent loop exhausted");
      expect(result.details?.message).toBe("agent loop exhausted");
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

  test("feeds authoritative failures back into the same bounded Agent thread", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          if (turn === 1) {
            mkdirSync(join(options.projectRoot, "tests", "memory"), { recursive: true });
            writeFileSync(join(options.projectRoot, "tests", "memory", "transient.ts"), "export const transient = true;\n");
            proposal.test_targets[0]!.args = ["-e", "process.exit(1)"];
            expect(options.maxIterations).toBe(1000);
            expect(options.completionReserveIterations).toBe(880);
          } else {
            rmSync(join(options.projectRoot, "tests", "memory", "transient.ts"));
            expect(options.threadId).toBe("repair-thread");
            expect(options.maxIterations).toBe(1000);
            expect(options.completionReserveIterations).toBe(880);
            expect(options.task).toContain("authoritative validation rejected");
            expect(options.task).toContain("Do not merely describe a known fix");
            expect(options.task).toContain("generated-public-memory");
          }
          return {
            content: "submitted",
            threadId: "repair-thread",
            events: [
              { type: "model.usage", thread_id: "repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({ ...event, thread_id: "repair-thread", iteration: turn === 1 ? 45 : 2 })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.details?.reason).toBeUndefined();
      expect((result.details?.validation as { status?: string } | undefined)?.status).toBe("passed");
      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("allocate");
      expect(existsSync(join(root, "tests", "memory", "transient.ts"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 120_000);

  test("returns authoritative gate owns violations to the same Agent thread", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          if (turn === 1) {
            proposal.test_targets[0]!.args = ["-e", "require('node:fs').writeFileSync('outside.txt', 'gate side effect')"];
          } else {
            expect(options.threadId).toBe("gate-owns-repair-thread");
            expect(options.task).toContain("authoritative validation rejected");
            expect(options.task).toContain("outside.txt");
            rmSync(join(options.projectRoot, "outside.txt"));
          }
          return {
            content: "submitted",
            threadId: "gate-owns-repair-thread",
            events: [
              { type: "model.usage", thread_id: "gate-owns-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({ ...event, thread_id: "gate-owns-repair-thread", iteration: turn === 1 ? 45 : 2 })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status).toBe("passed");
      expect(existsSync(join(root, "outside.txt"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 120_000);

  test("returns authoritative gate hidden-test writes to the same Agent thread", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          mkdirSync(join(options.projectRoot, "tests", "memory"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          if (turn === 1) {
            proposal.test_targets[0]!.args = ["-e", "require('node:fs').writeFileSync('tests/memory/hidden-output.ts', 'hidden gate side effect')"];
          } else {
            expect(options.threadId).toBe("gate-hidden-repair-thread");
            expect(options.task).toContain("authoritative validation rejected");
            expect(options.task).toContain("hidden-output.ts");
            rmSync(join(options.projectRoot, "tests", "memory", "hidden-output.ts"));
          }
          return {
            content: "submitted",
            threadId: "gate-hidden-repair-thread",
            events: [
              { type: "model.usage", thread_id: "gate-hidden-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({ ...event, thread_id: "gate-hidden-repair-thread", iteration: turn === 1 ? 45 : 2 })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status).toBe("passed");
      expect(existsSync(join(root, "tests", "memory", "hidden-output.ts"))).toBe(false);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 120_000);

  test("feeds malformed structured test targets back into the same Agent thread", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          if (turn === 1) {
            proposal.test_targets.find((target) => target.kind === "trace")!.artifacts = [];
          } else {
            expect(options.threadId).toBe("structured-repair-thread");
            expect(options.task).toContain("rejected the structured implementation result");
            expect(options.task).toContain("requires workload, oracle, timeout, and artifacts");
          }
          return {
            content: "submitted",
            threadId: "structured-repair-thread",
            events: [
              { type: "model.usage", thread_id: "structured-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({ ...event, thread_id: "structured-repair-thread", iteration: turn === 1 ? 45 : 2 })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status).toBe("passed");
    });
  }, 30_000);

  test("rejects missing proposed command inputs before running authoritative gates", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn++;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          proposal.test_targets[0]!.program = "bun";
          proposal.test_targets[0]!.args = ["tests/memory/public.ts"];
          if (turn === 2) {
            expect(options.task).toContain("proposed test command inputs do not exist");
            expect(options.task).toContain("tests/memory/public.ts");
            expect(options.task).toContain("missing implementation or test file is not an external blocker");
            mkdirSync(join(options.projectRoot, "tests", "memory"), { recursive: true });
            writeFileSync(join(options.projectRoot, "tests", "memory", "public.ts"), "if (1 + 1 !== 2) process.exit(1);\n");
          }
          return {
            content: "submitted",
            threadId: "missing-input-repair-thread",
            events: [
              { type: "model.usage", thread_id: "missing-input-repair-thread", iteration: turn === 1 ? 45 : 2 },
              ...acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({ ...event, thread_id: "missing-input-repair-thread", iteration: turn === 1 ? 45 : 2 })),
            ],
          };
        },
      });

      expect(turn).toBe(2);
      expect(result).toMatchObject({ status: "passed" });
    });
  }, 30_000);

  test("returns omitted ModuleSpec stable target IDs to the same Agent thread", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const modulePath = join(root, "spec", "modules", "memory.yaml");
      writeFileSync(modulePath, readFileSync(modulePath, "utf8").replace(
        "properties: [allocated blocks are aligned]",
        "properties: [memory_leak_contract observes that allocated blocks are aligned]",
      ));
      git(root, ["add", "spec/modules/memory.yaml"]);
      git(root, ["commit", "-m", "declare stable memory target"]);

      let turn = 0;
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          turn += 1;
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          const proposal = implementationResult();
          if (turn === 1) {
            expect(options.task).toContain("memory_leak_contract");
          } else {
            expect(options.task).toContain("omitted declared stable target IDs");
            proposal.test_targets.push({
              ...proposal.test_targets[1]!,
              id: "memory_leak_contract",
            });
          }
          return {
            content: "submitted declared targets",
            threadId: "declared-target-repair-thread",
            events: acceptedSubmitEvents("student_implementation_result.v1", proposal).map((event) => ({
              ...event,
              thread_id: "declared-target-repair-thread",
              iteration: turn === 1 ? 45 : 2,
            })),
          };
        },
      });

      expect(turn).toBe(2);
      expect(result.status).toBe("passed");
      expect(readFileSync(join(root, "vos.yaml"), "utf8")).toContain("memory_leak_contract:");
    });
  }, 120_000);

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

      const sharedResult = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "shared"], {
        print: false,
        agentRunner: async (options) => {
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const memoryValue = 2;\n");
          return {
            content: "implemented remaining affected module",
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult("shared")),
          };
        },
      });

      expect(sharedResult.status).toBe("passed");
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("memoryValue = 2");

      const committedHead = git(root, ["rev-parse", "HEAD"]).trim();
      const replay = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          writeFileSync(join(options.projectRoot, "src", "shared.ts"), "export const sharedValue = 2;\n");
          return {
            content: "attempted to reuse consumed shared ownership",
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()),
          };
        },
      });

      expect(replay.status).toBe("policy_blocked");
      expect(replay.details?.validation).toMatchObject({
        status: "owns_violation",
        violations: ["src/shared.ts"],
      });
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(committedHead);
      expect(readFileSync(join(root, "src", "shared.ts"), "utf8")).toContain("sharedValue = 1");
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 30_000);

  test("restores Agent manifest edits and projects structured targets exactly once", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 0;\n");
          writeFileSync(join(options.projectRoot, "vos.yaml"), `${readFileSync(join(options.projectRoot, "vos.yaml"), "utf8")}  generated-public-memory: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, verifies: [memory] }\n`);
          return {
            content: "implemented with an unauthorized manifest edit",
            events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()),
          };
        },
      });

      expect(result.status).toBe("passed");
      expect(result.details?.validation.policy_corrections).toEqual([
        expect.objectContaining({ policy: "manifest_projection_owned_by_vos", action: "restored_vos_yaml" }),
      ]);
      const manifest = readFileSync(join(root, "vos.yaml"), "utf8");
      expect(manifest.match(/generated-public-memory:/g)).toHaveLength(1);
      expect(git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
    });
  }, 120_000);

  test("squashes temporary Agent commits into one VOS implementation commit", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const before = git(root, ["rev-parse", "HEAD"]).trim();
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          mkdirSync(join(options.projectRoot, "src"), { recursive: true });
          writeFileSync(join(options.projectRoot, "src", "memory.ts"), "export const allocate = () => 1;\n");
          git(options.projectRoot, ["add", "src/memory.ts"]);
          git(options.projectRoot, ["commit", "-m", "agent-created temporary commit"]);
          return { content: "implemented", events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()) };
        },
      });

      expect(result.status).toBe("passed");
      expect(git(root, ["rev-list", "--count", `${before}..HEAD`]).trim()).toBe("1");
      expect(git(root, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][agent] Implement memory");
      expect(git(root, ["log", "--format=%s", `${before}..HEAD`])).not.toContain("agent-created temporary commit");
      expect(readFileSync(join(root, "src", "memory.ts"), "utf8")).toContain("allocate");
    });
  }, 120_000);

  test("rejects an owns violation hidden inside an Agent commit", async () => {
    const root = makeRoot();
    await withGitIdentity(async () => {
      await prepareModuleProject(root);
      const before = git(root, ["rev-parse", "HEAD"]).trim();
      const result = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "implement", "memory"], {
        print: false,
        agentRunner: async (options) => {
          writeFileSync(join(options.projectRoot, "outside.txt"), "committed outside owns\n");
          git(options.projectRoot, ["add", "outside.txt"]);
          git(options.projectRoot, ["commit", "-m", "hide owns violation in commit"]);
          return { content: "implemented", events: acceptedSubmitEvents("student_implementation_result.v1", implementationResult()) };
        },
      });

      expect(result.status).toBe("policy_blocked");
      expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
      expect(existsSync(join(root, "outside.txt"))).toBe(false);
    });
  }, 120_000);
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
    "build: { program: bun, args: [-e, \"require('node:fs').mkdirSync('build', { recursive: true }); require('node:fs').writeFileSync('build/hidden-prerequisite.txt', 'built')\"], cwd: ., env: [], timeout: 30000, artifacts: [build/hidden-prerequisite.txt] }",
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

async function tarEntries(file: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({
    file,
    onentry: (entry) => entries.push(entry.path),
  });
  return entries;
}

function acceptedSubmitEvents(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    { type: "tool.call", name: "mcp__vos-progress__submit_result", id: "submit", arguments: JSON.stringify({ schema_id: schemaId, result }) },
    { type: "tool.result", name: "mcp__vos-progress__submit_result", id: "submit", content: JSON.stringify({ type: "vos-result-submission", schema_id: schemaId, accepted: true }) },
  ];
}

function implementationResult(moduleId = "memory") {
  const base = {
    program: "bun",
    args: ["--version"],
    cwd: ".",
    env: [] as string[],
    timeout: 30_000,
    verifies: [moduleId],
    artifacts: [] as string[],
  };
  return {
    status: "passed",
    changed_paths: [`src/${moduleId}.ts`],
    validations: ["build"],
    test_targets: [
      { ...base, id: `generated-public-${moduleId}`, kind: "public" },
      { ...base, id: `generated-contract-${moduleId}`, kind: "contract" },
      { ...base, id: `generated-fuzz-${moduleId}`, kind: "fuzz", seed: 7, cases: 32, reproduction_artifact: `.vos/fuzz/${moduleId}-min.txt` },
      { ...base, id: `generated-trace-${moduleId}`, kind: "trace", workload: `${moduleId}-smoke`, oracle: `${moduleId} behavior is preserved`, artifacts: [`.vos/trace/${moduleId}.json`] },
    ],
    hidden_tests: [{
      id: `hidden-${moduleId}`,
      path: `${moduleId}.hidden.ts`,
      content: "import { existsSync } from 'node:fs'; import { expect, test } from 'bun:test'; test('hidden worktree is built before verification', () => expect(existsSync('build/hidden-prerequisite.txt')).toBe(true));\n",
      program: "bun",
      args: ["test", "{hidden_test}"],
      cwd: ".",
      env: [] as string[],
      timeout: 30_000,
      verifies: [moduleId],
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
