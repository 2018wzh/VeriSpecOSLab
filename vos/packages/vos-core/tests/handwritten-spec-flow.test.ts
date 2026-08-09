import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCliInvocation } from "../src/main.ts";
import type { HeadlessAgentTaskRunner } from "../src/agent/runner.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("handwritten Spec teaching flow", () => {
  test("lints all Specs or one ID/path/design target while retaining whole-project references", async () => {
    const root = await initializedProject();
    writeFileSync(join(root, "spec", "modules", "memory.yaml"), [
      "id: kernel/memory",
      "module: kernel/memory",
      "level: 1",
      "purpose: Define allocator ownership.",
      "owns: [src/memory.c, tests/memory]",
      "interface: [allocate]",
      "properties: [allocated pages are aligned]",
      "errors: [out_of_memory]",
      "",
    ].join("\n"));

    expect((await invoke(root, "spec", "lint")).status).toBe("passed");
    expect((await invoke(root, "spec", "lint", "all")).status).toBe("passed");
    expect((await invoke(root, "spec", "lint", "design")).status).toBe("passed");
    expect((await invoke(root, "spec", "lint", "kernel/memory")).status).toBe("passed");
    expect((await invoke(root, "spec", "lint", "spec/modules/memory.yaml")).status).toBe("passed");
    expect((await invoke(root, "spec", "lint", "unknown/spec")).status).toBe("validation_failed");
  }, 30_000);

  test("returns blocker findings without modifying a handwritten Spec and detects read-only violations", async () => {
    const root = await initializedProject();
    const blocker = await invokeWithAgent(root, ["agent", "review", "design"], async () => ({
      content: "review",
      events: submitted("spec_review.v1", {
        findings: [{ severity: "blocker", message: "Design goal is contradictory.", related_specs: ["design"], suggested_actions: ["Resolve the contradiction by hand."] }],
        summary: "blocked",
      }),
    }));
    expect(blocker.status).toBe("validation_failed");

    const original = readFileSync(join(root, "spec", "design.yaml"), "utf8");
    const violation = await invokeWithAgent(root, ["agent", "review", "design"], async () => {
      writeFileSync(join(root, "spec", "design.yaml"), `${original}\n# unauthorized\n`);
      return { content: "review", events: submitted("spec_review.v1", { findings: [], summary: "changed" }) };
    });
    expect(violation.status).toBe("policy_blocked");

    let initialTask = "";
    const interactive = await executeCliInvocation(["bun", "vos", "--project-root", root, "--json", "agent", "review", "design", "-i"], {
      print: false,
      interactiveAgentRunner: async (options) => {
        initialTask = options.initialTask ?? "";
      },
      readonlyDisplayStarter: () => ({
        command() {},
        error() {},
        progress() {},
        onSessionEvent() {},
        close() {},
      }),
    });
    expect(interactive.status).toBe("passed");
    expect(initialTask).toContain("complete, evidence-grounded review");
  }, 30_000);

  test("doctor binds every inferred tool to Bash evidence and separates required from optional failures", async () => {
    const root = await initializedProject();
    const required = await invokeWithAgent(root, ["doctor"], async (options) => {
      expect(await options.toolPolicy?.canExecute?.({ name: "Bash", argumentsJson: JSON.stringify({ command: "apt install gcc" }) })).toEqual({
        allowed: false,
        reason: "vos doctor may advise installation but may not install or download tools",
      });
      return doctorEvents({ required: true, status: "missing" });
    });
    expect(required.status).toBe("validation_failed");
    expect(required.details?.missing).toContain("agent-tool:riscv64-unknown-elf-gcc");

    const optional = await invokeWithAgent(root, ["doctor"], async () => doctorEvents({ required: false, status: "missing" }));
    expect(optional.status).toBe("passed");
    expect(optional.details?.warnings).toContain("agent-tool:riscv64-unknown-elf-gcc");
  }, 30_000);

  test("doctor degrades provider failures to warnings but rejects project writes", async () => {
    const unavailableRoot = await initializedProject();
    const unavailable = await invokeWithAgent(unavailableRoot, ["doctor"], async () => {
      throw new Error("provider network unavailable");
    });
    expect(unavailable.status).toBe("passed");
    expect(unavailable.details?.warnings).toContain("agent-tool-diagnosis");

    const modifiedRoot = await initializedProject();
    const original = readFileSync(join(modifiedRoot, "spec", "design.yaml"), "utf8");
    const modified = await invokeWithAgent(modifiedRoot, ["doctor"], async () => {
      writeFileSync(join(modifiedRoot, "spec", "design.yaml"), `${original}\n# unauthorized doctor write\n`);
      return doctorEvents({ required: false, status: "installed" });
    });
    expect(modified.status).toBe("validation_failed");
    expect(modified.details?.missing).toContain("doctor-readonly");
  }, 30_000);
});

async function initializedProject(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "vos-handwritten-"));
  roots.push(root);
  const old = {
    authorName: process.env.GIT_AUTHOR_NAME,
    authorEmail: process.env.GIT_AUTHOR_EMAIL,
    committerName: process.env.GIT_COMMITTER_NAME,
    committerEmail: process.env.GIT_COMMITTER_EMAIL,
  };
  process.env.GIT_AUTHOR_NAME = "VOS Test";
  process.env.GIT_AUTHOR_EMAIL = "vos@example.invalid";
  process.env.GIT_COMMITTER_NAME = "VOS Test";
  process.env.GIT_COMMITTER_EMAIL = "vos@example.invalid";
  try {
    expect((await invoke(root, "init")).status).toBe("passed");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
    writeFileSync(join(root, ".vos", "config.toml"), [
      "[agent]",
      'provider = "openai"',
      'model = "gpt-5"',
      "[agent.auth]",
      'env = "OPENAI_API_KEY"',
      "",
    ].join("\n"));
  } finally {
    restore("GIT_AUTHOR_NAME", old.authorName);
    restore("GIT_AUTHOR_EMAIL", old.authorEmail);
    restore("GIT_COMMITTER_NAME", old.committerName);
    restore("GIT_COMMITTER_EMAIL", old.committerEmail);
  }
  return root;
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function invoke(root: string, ...args: string[]) {
  return executeCliInvocation(["bun", "vos", "--project-root", root, "--json", ...args], { print: false });
}

async function invokeWithAgent(root: string, args: string[], agentRunner: HeadlessAgentTaskRunner) {
  return executeCliInvocation(["bun", "vos", "--project-root", root, "--json", ...args], { print: false, agentRunner });
}

function submitted(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    { type: "tool.call", name: "mcp__vos-progress__submit_result", id: "submit", arguments: JSON.stringify({ schema_id: schemaId, result }) },
    { type: "tool.result", name: "mcp__vos-progress__submit_result", id: "submit", content: JSON.stringify({ type: "vos-result-submission", accepted: true, schema_id: schemaId }) },
  ];
}

function doctorEvents(tool: { required: boolean; status: "installed" | "missing" | "failed" }) {
  return {
    content: "doctor",
    events: [
      { type: "tool.result", toolCallId: "probe-1", name: "Bash", content: "command not found" },
      ...submitted("doctor_diagnosis.v1", {
        summary: "tool probe complete",
        tools: [{
          program: "riscv64-unknown-elf-gcc",
          purpose: "Compile the ISA target declared by design",
          required: tool.required,
          status: tool.status,
          spec_refs: ["design"],
          probe_ids: ["probe-1"],
          suggestions: ["Install the cross compiler using the platform documentation."],
        }],
        limitations: [],
      }),
    ],
  };
}
